'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const featureSpecResolver = require('../feature-spec-resolver');
const agentRegistry = require('../agent-registry');
const { validateFeatureAutonomousPayload, buildFeatureAutonomousCliArgv } = require('../feature-autonomous-payload');
const { getDefaultAgent } = require('../config');
const { runTmux } = require('../worktree');

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
                        safeTmuxSessionExists: ctx.routes.safeTmuxSessionExists,
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
                    Promise.resolve(ctx.routes.handleLaunchSpecReview(launchCtx, {
                        commandName: isResearch
                            ? (isRevision ? 'research-spec-revise' : 'research-spec-review')
                            : (isRevision ? 'feature-spec-revise' : 'feature-spec-review'),
                        role: isRevision ? 'spec-revise' : 'spec-review',
                        taskType: isRevision ? 'spec-revise' : 'spec-review',
                    })).then((result) => {
                        ctx.sendJson(200, result);
                    }).catch((e) => {
                        ctx.sendJson(500, { error: `Failed to open spec review session: ${e.message}` });
                    });
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
                    const hint = /Unknown agent|Unknown eval|Unknown review/.test(validated.error)
                        ? { availableAgents: [...agentRegistry.getLaunchableAgentIds()].sort((a, b) => a.localeCompare(b)) }
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
                    const result = await ctx.routes.handleDashboardNudge({
                        entityType: 'feature',
                        entityId: featureId,
                        repoPath,
                        message,
                        agentId,
                        role,
                    });
                    ctx.sendJson(result.status || (result.ok ? 200 : 422), result.ok ? result.payload : { error: result.error, ...(result.payload || {}) });
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
        path: /^\/api\/research\/([^/]+)\/nudge$/,
        handler(req, res, ctx, match) {
            ctx.readJsonBody().then(async payload => {
                const researchId = String(match[1] || '').trim();
                const repoPath = String(payload.repoPath || '').trim() || process.cwd();
                const message = String(payload.message || '');
                const agentId = String(payload.agentId || '').trim() || null;
                const role = String(payload.role || 'do').trim() || 'do';
                if (!researchId || !message.trim()) {
                    ctx.sendJson(400, { error: 'researchId and message are required' });
                    return;
                }
                try {
                    const result = await ctx.routes.handleDashboardNudge({
                        entityType: 'research',
                        entityId: researchId,
                        repoPath,
                        message,
                        agentId,
                        role,
                    });
                    ctx.sendJson(result.status || (result.ok ? 200 : 422), result.ok ? result.payload : { error: result.error, ...(result.payload || {}) });
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
        path: '/api/agent-flag-action',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(async payload => {
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, payload.repoPath);
                if (!repoPath) return;

                try {
                    const result = await ctx.routes.handleDashboardAgentControl({ ...payload, repoPath });
                    if (result.refreshStatus) ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                    ctx.sendJson(result.status || (result.ok ? 200 : 500), result.ok ? result.payload : { error: result.error, ...(result.payload || {}) });
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
                try {
                    const result = await ctx.routes.handleDashboardMarkComplete({ entityType, entityId, agentId, signal, repoPath });
                    if (result.ok) ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                    ctx.sendJson(result.status || (result.ok ? 200 : 500), result.ok ? result.payload : { error: result.error });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
];
