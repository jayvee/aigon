'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const workflowEngine = require('../workflow-core/engine');
const featureSpecResolver = require('../feature-spec-resolver');
const agentRegistry = require('../agent-registry');
const { validateFeatureAutonomousPayload, buildFeatureAutonomousCliArgv } = require('../feature-autonomous-payload');
const { getDefaultAgent, getAgentCliConfig } = require('../config');
const {
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    createDetachedTmuxSession,
    runTmux,
    openTerminalAppWithCommand,
    buildAgentCommand,
    buildResearchAgentCommand,
} = require('../worktree');
const {
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
} = require('../dashboard-status-helpers');
const { sendNudge } = require('../nudge');
const autoNudge = require('../auto-nudge');

module.exports = [
    {
        method: 'POST',
        path: '/api/feature-open',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const featureId = String(payload.featureId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = String(payload.repoPath || '').trim();
                const pipelineType = String(payload.pipelineType || 'features').trim();
                const mode = String(payload.mode || 'do').trim();
                const launcherModel = (() => {
                    const s = String(payload.model || '').trim();
                    return s || null;
                })();
                const launcherEffort = (() => {
                    const s = String(payload.effort || '').trim();
                    return s || null;
                })();
                const isResearch = pipelineType === 'research';
                const worktreePrefix = isResearch ? 'research' : 'feature';
                // For close-resolve, agentId may be absent (autonomous plan doesn't pass it).
                // Infer from the worktree directory names in the worktrees folder.
                let resolvedAgentId = agentId;
                if (!resolvedAgentId && mode === 'close-resolve' && featureId) {
                    try {
                        const absRepoInfer = repoPath ? path.resolve(repoPath) : process.cwd();
                        const wtBaseInfer = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(absRepoInfer));
                        if (fs.existsSync(wtBaseInfer)) {
                            const wtPat = new RegExp(`^feature-(${featureId})-([a-z]{2})-.+$`);
                            const found = fs.readdirSync(wtBaseInfer).map(d => d.match(wtPat)).find(m => m);
                            if (found) resolvedAgentId = found[2];
                        }
                        // Fallback: check live status data
                        if (!resolvedAgentId) {
                            const latestForInfer = ctx.getLatestStatus();
                            if (latestForInfer && latestForInfer.repos) {
                                outer: for (const repo of latestForInfer.repos) {
                                    for (const f of (repo.features || [])) {
                                        if (String(f.id) === featureId && f.agents && f.agents.length > 0) {
                                            resolvedAgentId = f.agents[0].id;
                                            break outer;
                                        }
                                    }
                                }
                            }
                        }
                        if (!resolvedAgentId) {
                            resolvedAgentId = getDefaultAgent(absRepoInfer);
                        }
                    } catch (_) { /* ignore inference errors */ }
                }
                if (!featureId || !resolvedAgentId || resolvedAgentId === 'solo') {
                    ctx.sendJson(400, { error: 'featureId and non-solo agentId are required' });
                    return;
                }
                const effectiveAgentId = resolvedAgentId;

                try {
                    const absRepo = repoPath ? path.resolve(repoPath) : process.cwd();
                    const worktreeBase = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(absRepo));
                    let worktreePath = absRepo;
                    if (fs.existsSync(worktreeBase)) {
                        const wtPattern = new RegExp(`^${worktreePrefix}-(\\d+)-([a-z]{2})-.+$`);
                        const entries = fs.readdirSync(worktreeBase).filter(d => {
                            const m = d.match(wtPattern);
                            // For review mode the agentId is the reviewer, not the implementer.
                            // Match by featureId only so we find the implementer's worktree.
                            return m && m[1] === featureId && (mode === 'review' || m[2] === effectiveAgentId);
                        });
                        if (entries.length > 0) {
                            worktreePath = path.join(worktreeBase, entries[0]);
                        }
                    }
                    const wtDirName = path.basename(worktreePath);
                    const wtDescMatch = wtDirName.match(new RegExp(`^${worktreePrefix}-\\d+-[a-z]{2}-(.+)$`));
                    const desc = wtDescMatch ? wtDescMatch[1] : undefined;
                    const repoName = path.basename(absRepo);
                    let lastCloseFailure = null;
                    if (mode === 'close-resolve') {
                        try {
                            const wfAdapter = require('../workflow-snapshot-adapter');
                            const snap = wfAdapter.readWorkflowSnapshotSync(absRepo, 'feature', featureId);
                            lastCloseFailure = (snap && snap.lastCloseFailure) || null;
                        } catch (_) { /* best-effort */ }
                    }
                    const launchCtx = {
                        absRepo,
                        worktreePath,
                        featureId,
                        agentId: effectiveAgentId,
                        desc,
                        isResearch,
                        worktreePrefix,
                        repoName,
                        latestStatus: ctx.getLatestStatus(),
                        launcherModel,
                        launcherEffort,
                        lastCloseFailure,
                    };

                    const handler = mode === 'review' ? ctx.routes.handleLaunchReview
                        : mode === 'eval' ? ctx.routes.handleLaunchEval
                        : mode === 'close-resolve' ? ctx.routes.handleLaunchCloseResolve
                        : ctx.routes.handleLaunchImplementation;
                    Promise.resolve(handler(launchCtx)).then((result) => {
                        ctx.sendJson(200, result);
                    }).catch((e) => {
                        ctx.sendJson(500, { error: `Failed to open worktree: ${e.message}` });
                    });
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to open worktree: ${e.message}` });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: /^\/api\/(feature|research)-spec-(review|revise)$/,
        handler(req, res, ctx, match) {
            ctx.readJsonBody().then(payload => {
                const isResearch = match[1] === 'research';
                const isRevision = match[2] === 'revise';
                const entityId = String(payload.entityId || payload.featureId || payload.researchId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = String(payload.repoPath || '').trim();
                const launcherModel = (() => {
                    const s = String(payload.model || '').trim();
                    return s || null;
                })();
                const launcherEffort = (() => {
                    const s = String(payload.effort || '').trim();
                    return s || null;
                })();
                if (!entityId || !agentId || agentId === 'solo') {
                    ctx.sendJson(400, { error: 'entityId and non-solo agentId are required' });
                    return;
                }

                try {
                    const absRepo = repoPath ? path.resolve(repoPath) : process.cwd();
                    const resolvedSpec = isResearch
                        ? featureSpecResolver.resolveResearchSpec(absRepo, entityId)
                        : featureSpecResolver.resolveFeatureSpec(absRepo, entityId);
                    if (!resolvedSpec || !resolvedSpec.path) {
                        ctx.sendJson(404, { error: `Could not resolve ${isResearch ? 'research' : 'feature'} spec ${entityId}` });
                        return;
                    }
                    const repoName = path.basename(absRepo);
                    const parsed = isResearch
                        ? (path.basename(resolvedSpec.path).match(/^research-(?:(\d+)-)?(.+)\.md$/) || [])
                        : ctx.routes.parseFeatureSpecFileName(path.basename(resolvedSpec.path));
                    const desc = isResearch
                        ? (parsed[2] || parsed[1] || undefined)
                        : (parsed && parsed.name) || undefined;
                    const launchCtx = {
                        absRepo,
                        featureId: entityId,
                        agentId,
                        desc,
                        isResearch,
                        repoName,
                        launcherModel,
                        launcherEffort,
                    };
                    const result = ctx.routes.handleLaunchSpecReview(launchCtx, {
                        commandName: isResearch
                            ? (isRevision ? 'research-spec-revise' : 'research-spec-review')
                            : (isRevision ? 'feature-spec-revise' : 'feature-spec-review'),
                        role: isRevision ? 'spec-revise' : 'spec-review',
                        taskType: isRevision ? 'spec-revise' : 'spec-review',
                    });
                    ctx.sendJson(200, result);
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to open spec review session: ${e.message}` });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: '/api/spec-reconcile',
        handler(req, res, ctx) {
            ctx.routes.handleSpecReconcileApiRequest(req, res, {
                registeredRepos: ctx.routes.readConductorReposFromGlobalConfig(),
                defaultRepoPath: process.cwd(),
                logger: ctx.helpers.log,
                onComplete() {
                    ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                }
            });
        }
    },
    {
        method: 'POST',
        path: /^\/api\/features\/([^/]+)\/run$/,
        handler(req, res, ctx, match) {
            let featureId = '';
            try {
                featureId = decodeURIComponent(match[1] || '').trim();
            } catch (_) {
                ctx.sendJson(400, { error: 'Invalid feature id in path' });
                return;
            }

            ctx.readJsonBody().then(payload => {
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, payload.repoPath);
                if (!repoPath) return;
                const agents = Array.isArray(payload.agents) ? payload.agents.map(v => String(v || '').trim()).filter(Boolean) : [];
                const stopAfter = String(payload.stopAfter || 'close').trim();
                const evalAgent = String(payload.evalAgent || '').trim();
                const reviewAgent = String(payload.reviewAgent || '').trim();
                const modelsCsv = typeof payload.models === 'string' ? payload.models.trim() : '';
                const effortsCsv = typeof payload.efforts === 'string' ? payload.efforts.trim() : '';
                const reviewModel = typeof payload.reviewModel === 'string' ? payload.reviewModel.trim() : '';
                const reviewEffort = typeof payload.reviewEffort === 'string' ? payload.reviewEffort.trim() : '';
                const workflowSlug = typeof payload.workflow === 'string' ? payload.workflow.trim() : '';

                const validated = validateFeatureAutonomousPayload({
                    featureId,
                    agents,
                    stopAfter,
                    evalAgent,
                    reviewAgent,
                    models: modelsCsv,
                    efforts: effortsCsv,
                    reviewModel,
                    reviewEffort,
                    workflow: workflowSlug,
                }, agentRegistry);
                if (!validated.ok) {
                    const availableAgents = new Set(agentRegistry.getAllAgentIds());
                    const hint = /Unknown agent|Unknown eval|Unknown review/.test(validated.error)
                        ? { availableAgents: [...availableAgents].sort((a, b) => a.localeCompare(b)) }
                        : {};
                    ctx.sendJson(400, { error: validated.error, ...hint });
                    return;
                }
                const args = buildFeatureAutonomousCliArgv(validated.normalized);
                const command = `aigon ${args.join(' ')}`;

                const result = spawnSync(process.execPath, [ctx.routes.CLI_ENTRY_PATH, ...args], {
                    cwd: repoPath,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                if (result.error) {
                    ctx.sendJson(500, { error: `Failed to start autonomous run: ${result.error.message}` });
                    return;
                }

                const exitCode = typeof result.status === 'number' ? result.status : 1;
                const stdout = result.stdout || '';
                const stderr = result.stderr || '';

                if (exitCode !== 0) {
                    const stderrText = String(stderr).trim();
                    const errorLine = stderrText.split('\n').find(line => line.includes('❌') || line.includes('🔒'));
                    const errorMsg = errorLine
                        ? errorLine.replace(/^.*[❌🔒]\s*/, '').trim()
                        : (stderrText.split('\n')[0] || `Autonomous start failed with exit code ${exitCode}`);
                    ctx.sendJson(422, { error: errorMsg, command, exitCode, stdout, stderr });
                    return;
                }

                let autoSessionName = null;
                const sessionMatch = stdout.match(/AutoConductor started:\s*(\S+)/);
                if (sessionMatch) {
                    autoSessionName = sessionMatch[1];
                } else {
                    const repo = path.basename(repoPath);
                    const prefix = `${repo}-f${featureId}-auto`;
                    try {
                        const tmuxResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
                        if (!tmuxResult.error && tmuxResult.status === 0) {
                            autoSessionName = tmuxResult.stdout.split('\n').map(s => s.trim()).filter(Boolean)
                                .find(s => s.startsWith(prefix)) || null;
                        }
                    } catch (_) { /* ignore */ }
                }
                if (!autoSessionName) {
                    ctx.sendJson(422, {
                        error: 'Autonomous controller did not create an auto tmux session',
                        command,
                        exitCode,
                        stdout,
                        stderr
                    });
                    return;
                }

                ctx.sendJson(202, {
                    ok: true,
                    started: true,
                    command,
                    featureId,
                    agents,
                    stopAfter,
                    evalAgent: evalAgent || null,
                    tmuxSession: autoSessionName,
                    stdout,
                    stderr
                });
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: /^\/api\/feature\/([^/]+)\/nudge$/,
        handler(req, res, ctx, match) {
            ctx.readJsonBody().then(async payload => {
                const featureId = String(match[1] || '').trim();
                const repoPath = String(payload.repoPath || '').trim() || process.cwd();
                const message = String(payload.message || '');
                const agentId = String(payload.agentId || '').trim() || null;
                const role = String(payload.role || 'do').trim() || 'do';
                if (!featureId || !message.trim()) {
                    ctx.sendJson(400, { error: 'featureId and message are required' });
                    return;
                }
                try {
                    const result = await sendNudge(path.resolve(repoPath), featureId, message, {
                        agentId,
                        role,
                        entityType: 'feature',
                    });
                    ctx.sendJson(200, {
                        ok: true,
                        message: `Nudge delivered to ${result.sessionName}`,
                        sessionName: result.sessionName,
                        agentId: result.agentId,
                        role: result.role,
                    });
                } catch (error) {
                    ctx.sendJson(422, {
                        error: error.message,
                        paneTail: error.paneTail || '',
                    });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: /^\/api\/(feature|research)\/([^/]+)\/agents\/([^/]+)\/auto-nudge\/pause$/,
        handler(req, res, ctx, match) {
            ctx.readJsonBody().then(payload => {
                const entityType = match[1] === 'research' ? 'research' : 'feature';
                const entityId = String(match[2] || '').trim();
                const agentId = String(match[3] || '').trim();
                const repoPath = path.resolve(String(payload.repoPath || '').trim() || process.cwd());
                const sessionName = String(payload.sessionName || '').trim();
                if (!entityId || !agentId || !sessionName) {
                    ctx.sendJson(400, { error: 'entityId, agentId, and sessionName are required' });
                    return;
                }
                autoNudge.pauseAutoNudgeForSession(repoPath, {
                    entityType,
                    entityId,
                    agentId,
                    sessionName,
                });
                ctx.sendJson(200, { ok: true, message: `Auto-nudge paused for ${agentId} on ${entityType === 'research' ? 'R#' : '#'}${entityId}` });
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: '/api/agent-flag-action',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                const action = String(payload.action || '').trim();
                const entityType = String(payload.entityType || 'feature').trim();
                const id = String(payload.id || '').trim();
                const agent = String(payload.agentId || '').trim();
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, payload.repoPath);
                if (!repoPath) return;
                if (!id || !agent) {
                    ctx.sendJson(400, { error: 'id and agentId are required' });
                    return;
                }
                const worktreeBase = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(repoPath));
                const worktreePath = entityType === 'feature'
                    ? resolveFeatureWorktreePath(worktreeBase, id, agent, repoPath)
                    : repoPath;

                try {
                    if (action === 'mark-submitted') {
                        const hasEvidence = entityType === 'research'
                            ? hasResearchFindingsProgress(path.join(repoPath, 'docs', 'specs', 'research-topics', 'logs'), id, agent)
                            : worktreeHasImplementationCommits(worktreePath);
                        if (!hasEvidence) {
                            ctx.sendJson(409, { error: `Cannot mark ${agent} submitted for ${entityType} ${id} without implementation evidence.` });
                            return;
                        }
                        workflowEngine.emitSignal(repoPath, id, 'agent-ready', agent, { entityType })
                            .then(() => {
                                ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                                ctx.sendJson(200, { ok: true, message: `Marked ${agent} as submitted` });
                            })
                            .catch(err => ctx.sendJson(500, { error: err.message }));
                        return;
                    }

                    if (action === 'reopen-agent') {
                        const sessionName = entityType === 'research'
                            ? buildResearchTmuxSessionName(id, agent, { repo: path.basename(repoPath), role: 'do' })
                            : buildTmuxSessionName(id, agent, { repo: path.basename(repoPath), role: 'do' });
                        const desc = worktreePath ? (() => {
                            const m = path.basename(worktreePath).match(/^feature-\d+-[a-z]{2}-(.+)$/);
                            return m ? m[1] : undefined;
                        })() : undefined;
                        const command = entityType === 'research'
                            ? buildResearchAgentCommand(agent, id, 'do', repoPath)
                            : buildAgentCommand({ agent, featureId: id, path: worktreePath || repoPath, desc, repoPath });

                        try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                        createDetachedTmuxSession(sessionName, worktreePath || repoPath, command, {
                            repoPath,
                            entityType: entityType === 'research' ? 'r' : 'f',
                            entityId: id,
                            agent,
                            role: 'do',
                            worktreePath: worktreePath || repoPath,
                        });
                        workflowEngine.restartEntityAgent(repoPath, entityType, id, agent)
                            .then(() => {
                                ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                                ctx.sendJson(200, { ok: true, message: `Re-opened agent ${agent}` });
                            })
                            .catch(err => ctx.sendJson(500, { error: err.message }));
                        return;
                    }

                    if (action === 'switch-agent') {
                        if (entityType !== 'feature') {
                            ctx.sendJson(400, { error: 'switch-agent is only supported for features' });
                            return;
                        }
                        const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
                        const snapshotForSwitch = workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, id);
                        const agentState = snapshotForSwitch && snapshotForSwitch.agents
                            ? snapshotForSwitch.agents[agent]
                            : null;
                        if (!snapshotForSwitch || !agentState) {
                            ctx.sendJson(404, { error: `Agent ${agent} not found on feature ${id}` });
                            return;
                        }
                        if (!agentState.tokenExhausted) {
                            ctx.sendJson(409, { error: 'Switch is only allowed after token exhaustion is recorded for this agent slot' });
                            return;
                        }
                        const failover = require('../agent-failover');
                        const { getAgentFailoverConfig } = require('../config');
                        const failoverConfig = getAgentFailoverConfig(repoPath, snapshotForSwitch);
                        const runtimeAgentId = failover.getAgentRuntimeId(agentState, agent);
                        const replacementAgentId = failover.chooseNextAgent(
                            failoverConfig.chain,
                            runtimeAgentId,
                            [runtimeAgentId],
                        );
                        if (!replacementAgentId) {
                            ctx.sendJson(409, { error: `No failover candidate available for ${agent} (chain exhausted)` });
                            return;
                        }
                        const descMatch = worktreePath ? path.basename(worktreePath).match(/^feature-\d+-[a-z0-9]+-(.+)$/) : null;
                        const desc = descMatch ? descMatch[1] : undefined;
                        const { resolveAgentPromptBody } = require('../agent-prompt-resolver');
                        const basePrompt = resolveAgentPromptBody({
                            agentId: replacementAgentId,
                            verb: 'do',
                            featureId: id,
                            cliConfig: getAgentCliConfig(replacementAgentId, repoPath),
                        });
                        const lastCommit = failover.getLastReachableCommit(worktreePath);
                        const promptOverride = failover.buildFailoverPrompt(basePrompt, {
                            slotAgentId: agent,
                            previousAgentId: runtimeAgentId,
                            replacementAgentId,
                            lastCommit,
                        });
                        const sessionName = buildTmuxSessionName(id, agent, { repo: path.basename(repoPath), role: 'do', desc });
                        try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                        const command = buildAgentCommand({
                            agent: replacementAgentId,
                            slotAgentId: agent,
                            featureId: id,
                            path: worktreePath,
                            desc,
                            repoPath,
                            snapshot: snapshotForSwitch,
                            promptOverride,
                        });
                        createDetachedTmuxSession(sessionName, worktreePath, command, {
                            repoPath,
                            entityType: 'f',
                            entityId: id,
                            agent,
                            role: 'do',
                            worktreePath,
                        });
                        workflowEngine.recordAgentFailoverSwitch(repoPath, id, {
                            agentId: agent,
                            previousAgentId: runtimeAgentId,
                            replacementAgentId,
                            source: 'manual',
                            lastCommit,
                        })
                            .then(() => {
                                failover.clearTokenExhaustedFlag(repoPath, id, agent, replacementAgentId, worktreePath);
                                ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                                ctx.sendJson(200, { ok: true, message: `Switched ${agent} to ${replacementAgentId}` });
                            })
                            .catch(err => ctx.sendJson(500, { error: err.message }));
                        return;
                    }

                    if (action === 'view-work') {
                        const terminalCwd = worktreePath || repoPath;
                        const diffCmd = entityType === 'research'
                            ? 'git --no-pager status; echo; git --no-pager log --oneline -n 20'
                            : `git --no-pager status; echo; git --no-pager log --oneline -n 20; echo; git --no-pager diff --stat ${detectDefaultBranch(terminalCwd)}...HEAD`;
                        openTerminalAppWithCommand(terminalCwd, diffCmd, `view-work-${entityType}-${id}-${agent}`);
                        ctx.sendJson(200, { ok: true, message: 'Opened worktree diff in terminal' });
                        return;
                    }

                    ctx.sendJson(400, { error: `Unsupported action: ${action}` });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'POST',
        path: /^\/api\/(features|research)\/([^/]+)\/mark-complete$/,
        handler(req, res, ctx, match) {
            const entityType = match[1] === 'research' ? 'research' : 'feature';
            let entityId = '';
            try { entityId = decodeURIComponent(match[2] || '').trim(); } catch (_) {
                ctx.sendJson(400, { error: 'Invalid entity id in path' });
                return;
            }
            ctx.readJsonBody().then(async payload => {
                const signal = String(payload.signal || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, payload.repoPath);
                if (!repoPath) return;
                const ALLOWED_SIGNALS = new Set([
                    'implementation-complete', 'revision-complete', 'review-complete',
                    'spec-review-complete', 'research-complete',
                ]);
                if (!ALLOWED_SIGNALS.has(signal)) {
                    ctx.sendJson(400, { error: `Unknown signal '${signal}'. Allowed: ${[...ALLOWED_SIGNALS].join(', ')}` });
                    return;
                }
                if (!entityId || !agentId) {
                    ctx.sendJson(400, { error: 'Entity id and agentId are required' });
                    return;
                }
                try {
                    const source = 'dashboard/mark-complete';
                    const prefix = entityType === 'research' ? 'research' : 'feature';
                    const agentStatusLib = require('../agent-status');
                    agentStatusLib.writeAgentStatusAt(repoPath, entityId, agentId,
                        { status: signal, taskType: null, flags: {} }, prefix);
                    if (signal === 'implementation-complete') {
                        await workflowEngine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType: 'feature', source });
                    } else if (signal === 'research-complete') {
                        await workflowEngine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType: 'research', source });
                    } else if (signal === 'revision-complete') {
                        await workflowEngine.recordCodeRevisionCompleted(repoPath, 'feature', entityId, { revisionAgentId: agentId, source });
                        await workflowEngine.emitSignal(repoPath, entityId, 'agent-ready', agentId, { entityType: 'feature', source });
                    } else if (signal === 'review-complete') {
                        await workflowEngine.recordCodeReviewCompleted(repoPath, entityType, entityId, { reviewerId: agentId, requestRevision: true, source });
                    } else if (signal === 'spec-review-complete') {
                        await workflowEngine.recordSpecReviewCompleted(repoPath, entityType, entityId, {
                            reviewerId: agentId,
                            source,
                        });
                    }
                    ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                    ctx.sendJson(200, { ok: true, signal, entityId, agentId });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
];
