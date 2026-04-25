'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync, spawn } = require('child_process');
const git = require('./git');
const workflowEngine = require('./workflow-core/engine');
const featureSpecResolver = require('./feature-spec-resolver');
const agentRegistry = require('./agent-registry');
const { validateFeatureAutonomousPayload, buildFeatureAutonomousCliArgv } = require('./feature-autonomous-payload');
const {
    GLOBAL_CONFIG_PATH,
    saveGlobalConfig,
    loadGlobalConfig,
    getDefaultAgent,
    getAgentCliConfig,
} = require('./config');
const {
    getAppId,
    getDevProxyUrl,
    buildCaddyHostname,
    parseCaddyRoutes,
    isPortInUseSync,
} = require('./proxy');
const {
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId,
    tmuxSessionExists,
    createDetachedTmuxSession,
    getEnrichedSessions,
    runTmux,
    openTerminalAppWithCommand,
    shellQuote,
    buildAgentCommand,
    buildResearchAgentCommand,
    tileITerm2Windows,
    toUnpaddedId,
} = require('./worktree');
const {
    findFirstTmuxSessionByPrefix,
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
} = require('./dashboard-status-helpers');
const { sendNudge } = require('./nudge');
const budgetPoller = require('./budget-poller');
const { mintPtyToken } = require('./pty-session-handler');

function normalizeMethod(method) {
    return method ? String(method).toUpperCase() : null;
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString('utf8'); });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, payload, extraHeaders) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...(extraHeaders || {})
    });
    res.end(JSON.stringify(payload));
}

function matchesPath(routePath, reqPath) {
    if (typeof routePath === 'string') {
        return routePath === reqPath ? [] : null;
    }
    if (routePath instanceof RegExp) {
        return reqPath.match(routePath);
    }
    if (typeof routePath === 'function') {
        return routePath(reqPath);
    }
    return null;
}

function buildRouteContext(req, res, serverCtx) {
    return {
        req,
        res,
        state: serverCtx.state,
        helpers: serverCtx.helpers,
        routes: serverCtx.routes,
        options: serverCtx.options || {},
        readJsonBody: () => readJsonBody(req),
        sendJson: (status, payload, headers) => sendJson(res, status, payload, headers),
        sendJsonBody(status, payload, headers) {
            sendJson(res, status, payload, headers);
        },
        getLatestStatus: () => serverCtx.state.getLatestStatus(),
        setLatestStatus: (next) => serverCtx.state.setLatestStatus(next),
        getGlobalConfig: () => serverCtx.state.getGlobalConfig(),
        setGlobalConfig: next => serverCtx.state.setGlobalConfig(next),
        getNotificationUnreadCount: () => serverCtx.state.getNotificationUnreadCount(),
        setNotificationUnreadCount: next => serverCtx.state.setNotificationUnreadCount(next),
    };
}

function createDashboardRouteDispatcher(serverCtx) {
    const routes = [
        {
            method: 'GET',
            path: '/api/budget',
            handler(req, res, ctx) {
                try {
                    const data = budgetPoller.readCache(process.cwd());
                    let lastTokenKickoffAt = null;
                    try {
                        const kickoffPath = path.join(process.cwd(), '.aigon', 'state', 'last-token-kickoff');
                        if (fs.existsSync(kickoffPath)) {
                            lastTokenKickoffAt = fs.readFileSync(kickoffPath, 'utf8').trim() || null;
                        }
                    } catch (_) {}
                    ctx.sendJson(200, { ...(data || { cc: null, cx: null, gg: null }), lastTokenKickoffAt });
                } catch (e) {
                    ctx.sendJson(200, { cc: null, cx: null, gg: null, lastTokenKickoffAt: null });
                }
            }
        },
        {
            method: 'POST',
            path: '/api/budget/refresh',
            handler(req, res, ctx) {
                try {
                    budgetPoller.triggerRefresh({ repoPath: process.cwd() });
                    ctx.sendJson(200, { ok: true });
                } catch (e) {
                    ctx.sendJson(500, { ok: false, error: e && e.message });
                }
            }
        },
        {
            method: 'POST',
            path: '/api/attach',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const featureId = String(payload.featureId || '').trim();
                    const agentId = String(payload.agentId || '').trim();
                    const repoPath = String(payload.repoPath || '').trim();
                    const requestedSession = String(payload.tmuxSession || '').trim();
                    if (!featureId || !agentId || agentId === 'solo') {
                        ctx.sendJson(400, { error: 'featureId and non-solo agentId are required' });
                        return;
                    }

                    let tmuxInfo = null;
                    if (requestedSession) {
                        const match = matchTmuxSessionByEntityId(requestedSession, featureId);
                        if (!match || match.type !== 'f' || match.agent !== agentId) {
                            ctx.sendJson(400, { error: 'tmuxSession does not match featureId/agentId' });
                            return;
                        }
                        tmuxInfo = {
                            sessionName: requestedSession,
                            running: tmuxSessionExists(requestedSession)
                        };
                    } else {
                        tmuxInfo = ctx.routes.safeTmuxSessionExists(featureId, agentId);
                    }
                    if (!tmuxInfo || !tmuxInfo.running) {
                        ctx.sendJson(409, { error: `tmux session not running for F${featureId} ${agentId}` });
                        return;
                    }
                    const sessionName = tmuxInfo.sessionName;

                    try {
                        openTerminalAppWithCommand(repoPath || process.cwd(), `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        ctx.sendJson(200, { ok: true, message: `Attached to ${sessionName}`, command: `tmux attach -t ${sessionName}` });
                    } catch (e) {
                        ctx.sendJson(500, { error: `Failed to open terminal: ${e.message}` });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
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
                                const wfAdapter = require('./workflow-snapshot-adapter');
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
                        ctx.sendJson(200, handler(launchCtx));
                    } catch (e) {
                        ctx.sendJson(500, { error: `Failed to open worktree: ${e.message}` });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: /^\/api\/(feature|research)-spec-review(?:-(check))?$/,
            handler(req, res, ctx, match) {
                ctx.readJsonBody().then(payload => {
                    const isResearch = match[1] === 'research';
                    const isCheck = match[2] === 'check';
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
                                ? (isCheck ? 'research-spec-revise' : 'research-spec-review')
                                : (isCheck ? 'feature-spec-revise' : 'feature-spec-review'),
                            role: isCheck ? 'spec-check' : 'spec-review',
                            taskType: isCheck ? 'spec-check' : 'spec-review',
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
            path: /^\/api\/repos\/(.+)\/dev-server\/start$/,
            handler(req, res, ctx, match) {
                const repoResolution = ctx.helpers.resolveRepoFromPathParam(match[1]);
                if (!repoResolution.ok) {
                    ctx.sendJson(repoResolution.status || 400, { error: repoResolution.error || 'Invalid repo path' });
                    return;
                }

                const repoPath = repoResolution.repoPath;
                const profile = ctx.routes.getActiveProfile(repoPath);
                if (!profile.devServer.enabled) {
                    ctx.sendJson(409, { error: 'Dev server is disabled for this repo profile' });
                    return;
                }

                try {
                    const appId = getAppId(repoPath);
                    const mainHostname = buildCaddyHostname(appId, null);
                    const existingRoute = parseCaddyRoutes().find(r => r.hostname === mainHostname);
                    const alreadyRunning = Boolean(existingRoute && isPortInUseSync(existingRoute.port));
                    if (alreadyRunning) {
                        const url = getDevProxyUrl(appId, '');
                        ctx.sendJson(200, { ok: true, started: false, url, message: `Main dev server already running at ${url}` });
                        return;
                    }

                    const actionResult = ctx.routes.runDashboardInteractiveAction({
                        action: 'dev-server',
                        args: ['start'],
                        repoPath,
                        registeredRepos: ctx.routes.readConductorReposFromGlobalConfig(),
                        defaultRepoPath: process.cwd()
                    });
                    if (!actionResult.ok) {
                        ctx.sendJson(actionResult.status || 422, {
                            error: actionResult.error || 'Failed to start dev server',
                            stdout: actionResult.stdout || '',
                            stderr: actionResult.stderr || '',
                            exitCode: actionResult.exitCode
                        });
                        return;
                    }

                    const routeAfter = parseCaddyRoutes().find(r => r.hostname === mainHostname);
                    const runningNow = Boolean(routeAfter && isPortInUseSync(routeAfter.port));
                    const url = runningNow ? getDevProxyUrl(appId, '') : null;
                    ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());

                    ctx.sendJson(200, {
                        ok: true,
                        started: true,
                        url,
                        command: actionResult.command,
                        stdout: actionResult.stdout || '',
                        stderr: actionResult.stderr || '',
                        message: url ? `Started main dev server at ${url}` : 'Started main dev server'
                    });
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to start main dev server: ${e.message}` });
                }
            }
        },
        {
            method: 'POST',
            path: /^\/api\/repos\/(.+)\/features\/([^/]+)\/agents\/([^/]+)\/dev-server\/poke$/,
            handler(req, res, ctx, match) {
                const repoResolution = ctx.helpers.resolveRepoFromPathParam(match[1]);
                if (!repoResolution.ok) {
                    ctx.sendJson(repoResolution.status || 400, { error: repoResolution.error || 'Invalid repo path' });
                    return;
                }

                const repoPath = repoResolution.repoPath;
                let featureId;
                let agentId;
                try {
                    featureId = decodeURIComponent(match[2] || '');
                    agentId = decodeURIComponent(match[3] || '');
                } catch (_) {
                    ctx.sendJson(400, { error: 'Invalid feature/agent path parameter' });
                    return;
                }

                if (!featureId || !agentId || agentId === 'solo') {
                    ctx.sendJson(400, { error: 'featureId and non-solo agentId are required' });
                    return;
                }

                try {
                    ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                    const located = ctx.helpers.findFeatureAgentInStatus(repoPath, featureId, agentId);
                    if (!located) {
                        ctx.sendJson(404, { error: `Agent ${agentId} for feature ${featureId} not found in in-progress view` });
                        return;
                    }

                    const { agent } = located;
                    const sessionEnded = Boolean(agent.flags && agent.flags.sessionEnded);
                    const busyImplementing = agent.status === 'implementing' && agent.tmuxRunning && !sessionEnded;
                    if (busyImplementing) {
                        ctx.sendJson(409, { error: `Cannot poke while ${agentId} is actively implementing` });
                        return;
                    }
                    if (agent.devServerUrl) {
                        ctx.sendJson(200, { ok: true, started: false, url: agent.devServerUrl, message: 'Dev server already running' });
                        return;
                    }
                    if (!agent.devServerEligible || !agent.worktreePath) {
                        ctx.sendJson(409, { error: 'Dev server is not eligible for this agent/worktree' });
                        return;
                    }

                    const worktreePath = agent.worktreePath || resolveFeatureWorktreePath(path.join(os.homedir(), '.aigon', 'worktrees', path.basename(repoPath)), featureId, agentId, repoPath) || repoPath;
                    const cliArgs = ctx.routes.buildDashboardActionCommandArgs('dev-server', ['start']);
                    const spawnResult = spawnSync(process.execPath, cliArgs, {
                        cwd: worktreePath,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                    if (spawnResult.error || (typeof spawnResult.status === 'number' && spawnResult.status !== 0)) {
                        const errMsg = spawnResult.error ? spawnResult.error.message : (spawnResult.stderr || '').slice(0, 200);
                        ctx.sendJson(422, {
                            error: errMsg || 'Failed to start dev server',
                            stdout: spawnResult.stdout || '',
                            stderr: spawnResult.stderr || '',
                            exitCode: spawnResult.status
                        });
                        return;
                    }

                    ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                    const appId = getAppId(repoPath);
                    const agentSlot = `${agentId}-${featureId}`;
                    const agentHostname = buildCaddyHostname(appId, agentSlot || null);
                    const routeEntry = parseCaddyRoutes().find(r => r.hostname === agentHostname);
                    const runningNow = Boolean(routeEntry && isPortInUseSync(routeEntry.port));
                    const url = runningNow ? getDevProxyUrl(appId, agentSlot) : null;

                    ctx.sendJson(200, {
                        ok: true,
                        started: true,
                        url,
                        message: url ? `Dev server started at ${url}` : 'Dev server started for ' + agentId
                    });
                } catch (e) {
                    ctx.sendJson(500, { error: `Failed to poke dev server: ${e.message}` });
                }
            }
        },
        {
            method: 'GET',
            path: /^\/api\/repos\/(.+)\/features\/([^/]+)\/pr-status$/,
            handler(req, res, ctx, match) {
                const repoResolution = ctx.helpers.resolveRepoFromPathParam(match[1]);
                if (!repoResolution.ok) {
                    ctx.sendJson(repoResolution.status || 400, { error: repoResolution.error || 'Invalid repo path' });
                    return;
                }

                let featureId;
                try {
                    featureId = decodeURIComponent(match[2] || '').trim();
                } catch (_) {
                    ctx.sendJson(400, { error: 'Invalid featureId path parameter' });
                    return;
                }

                const payload = ctx.routes.getFeaturePrStatusPayload(repoResolution.repoPath, featureId);
                ctx.sendJson(200, payload);
            }
        },
        {
            method: 'POST',
            path: '/api/session/ask',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const repoPath = String(payload.repoPath || '').trim();
                    const prompt = String(payload.prompt || payload.message || '').trim();
                    if (!repoPath) {
                        ctx.sendJson(400, { error: 'repoPath is required' });
                        return;
                    }
                    try {
                        const absRepo = path.resolve(repoPath);
                        const agentId = String(payload.agentId || getDefaultAgent(absRepo)).trim();
                        const repoName = path.basename(absRepo);
                        const sessionName = `ask-${repoName}-${agentId}`;
                        const cliConfig = getAgentCliConfig(agentId, absRepo);
                        const agentBin = cliConfig.command || agentId;
                        const flags = cliConfig.implementFlag || '';
                        const promptFlagToken = agentRegistry.getPromptFlag(agentId) || '';
                        const promptArg = prompt ? ' ' + (promptFlagToken ? `${promptFlagToken} ` : '') + shellQuote(prompt) : '';
                        const agentCmd = flags ? `${agentBin} ${flags}${promptArg}` : `${agentBin}${promptArg}`;
                        if (tmuxSessionExists(sessionName)) {
                            if (prompt) {
                                runTmux(['send-keys', '-t', sessionName, '-l', prompt], { stdio: 'ignore' });
                                runTmux(['send-keys', '-t', sessionName, 'Enter'], { stdio: 'ignore' });
                            }
                            openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                            ctx.sendJson(200, { ok: true, message: `Attached to existing session ${sessionName}`, sessionName });
                        } else {
                            createDetachedTmuxSession(sessionName, absRepo, agentCmd, {
                                category: 'repo',
                                repoPath: absRepo,
                                agent: agentId,
                                worktreePath: absRepo,
                            });
                            openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                            ctx.sendJson(200, { ok: true, message: `Started ask session for ${repoName} (${agentId})`, sessionName });
                        }
                    } catch (e) {
                        ctx.sendJson(500, { error: `Failed to start ask session: ${e.message}` });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/open-terminal',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const command = String(payload.command || '').trim();
                    const cwd = String(payload.cwd || '').trim() || process.cwd();
                    if (!command) {
                        ctx.sendJson(400, { error: 'command is required' });
                        return;
                    }
                    try {
                        openTerminalAppWithCommand(cwd, command, command.split(' ').slice(0, 3).join(' '));
                        ctx.sendJson(200, { ok: true });
                    } catch (e) {
                        ctx.sendJson(500, { error: `Failed to open terminal: ${e.message}` });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/tile-windows',
            handler(req, res, ctx) {
                try {
                    tileITerm2Windows();
                    ctx.sendJson(200, { ok: true });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'POST',
            path: '/api/refresh',
            handler(req, res, ctx) {
                ctx.helpers.pollStatus();
                ctx.sendJson(200, ctx.getLatestStatus());
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
            path: '/api/action',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const dedupeRepoPath = payload.repoPath || process.cwd();
                    const dedupeKey = ctx.helpers.inflightKey(dedupeRepoPath, payload.action, payload.args || []);
                    if (ctx.state.inflightActions.has(dedupeKey)) {
                        const existing = ctx.state.inflightActions.get(dedupeKey);
                        ctx.sendJson(409, {
                            error: `Action already in flight: ${payload.action}`,
                            since: existing.startedAt,
                        });
                        return;
                    }
                    ctx.state.inflightActions.set(dedupeKey, { startedAt: new Date().toISOString(), action: payload.action });

                    const actionStartTime = Date.now();
                    let result;
                    try {
                        result = ctx.routes.runDashboardInteractiveAction({
                            ...payload,
                            registeredRepos: ctx.routes.readConductorReposFromGlobalConfig(),
                            defaultRepoPath: process.cwd()
                        });
                    } finally {
                        ctx.state.inflightActions.delete(dedupeKey);
                    }
                    const actionDuration = Date.now() - actionStartTime;

                    ctx.helpers.logToLogs({
                        type: 'action',
                        action: payload.action,
                        args: payload.args || [],
                        repoPath: result.repoPath,
                        command: result.command,
                        exitCode: result.exitCode,
                        ok: result.ok,
                        stdout: result.stdout || '',
                        stderr: result.stderr || '',
                        duration: actionDuration
                    });

                    if (!result.ok) {
                        ctx.sendJson(result.status || 400, {
                            error: result.error || 'Action failed',
                            exitCode: result.exitCode,
                            stdout: result.stdout || '',
                            stderr: result.stderr || '',
                        });
                        return;
                    }

                    if (result.stderr && /^❌/.test(String(result.stderr).trim())) {
                        const errMsg = String(result.stderr).trim().split('\n')[0].replace(/^❌\s*/, '');
                        ctx.helpers.log(`Action stderr error (exit 0): ${errMsg}`);
                        ctx.sendJson(422, { error: errMsg, details: result });
                        return;
                    }

                    let restartMarker = null;
                    try {
                        const close = require('./feature-close');
                        restartMarker = close.consumeRestartMarker(result.repoPath || dedupeRepoPath);
                    } catch (_) { /* best-effort */ }

                    const responseBody = restartMarker
                        ? { ...result, serverRestarting: true, restartReason: restartMarker.reason }
                        : result;

                    ctx.sendJson(200, responseBody);

                    if (restartMarker) {
                        ctx.helpers.log(`🔄 Lib files changed (${(restartMarker.files || []).length}) — scheduling dashboard self-restart`);
                        setTimeout(() => {
                            try {
                                const child = spawn(
                                    process.execPath,
                                    [ctx.routes.CLI_ENTRY_PATH, 'server', 'restart'],
                                    { detached: true, stdio: 'ignore', cwd: process.cwd() }
                                );
                                child.unref();
                            } catch (e) {
                                ctx.helpers.log(`Failed to spawn detached restart: ${e.message}`);
                            }
                            setTimeout(() => process.exit(0), 50);
                        }, 100);
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            path: '/api/status',
            handler(req, res, ctx) {
                ctx.sendJson(200, ctx.getLatestStatus());
            }
        },
        {
            method: 'GET',
            path: '/api/health',
            // Liveness check — must be cheap. Reads the cached status snapshot
            // populated by the poll loop (`pollStatus()` in dashboard-server.js,
            // runs once at boot and every ~10s thereafter). MUST NOT call
            // `collectDashboardStatusData()` here: at scale that path takes
            // multiple seconds and starves the event loop, which causes the
            // `aigon server status` probe (3s timeout) to false-positive
            // "Health: unavailable" and look like a crash.
            handler(req, res, ctx) {
                try {
                    const cached = ctx.getLatestStatus();
                    const hasCache = !!(cached && Array.isArray(cached.repos));
                    ctx.sendJson(200, {
                        ok: true,
                        warming: !hasCache,
                        repoCount: hasCache ? cached.repos.length : 0,
                        completedAt: new Date().toISOString(),
                    });
                } catch (error) {
                    ctx.sendJson(500, { ok: false, error: error.message });
                }
            }
        },
        {
            path: '/api/repos',
            handler(req, res, ctx) {
                ctx.sendJson(200, { repos: ctx.routes.readConductorReposFromGlobalConfig() });
            }
        },
        {
            path: '/api/analytics',
            handler(req, res, ctx) {
                const forceReload = (req.url || '').includes('force=1');
                if (forceReload) ctx.state.resetAnalyticsCache();
                const analytics = ctx.helpers.getOrRecomputeAnalytics();
                ctx.sendJson(200, analytics);
            }
        },
        {
            method: 'GET',
            path: '/api/workflows',
            handler(req, res, ctx) {
                try {
                    const reqUrl = new URL(req.url || '/api/workflows', 'http://localhost');
                    const repoQuery = reqUrl.searchParams.get('repo');
                    const workflowDefs = require('./workflow-definitions');
                    const repoPath = repoQuery ? path.resolve(repoQuery) : null;
                    const workflows = workflowDefs.loadAll(repoPath);
                    const enriched = workflows.map(def => ({
                        ...def,
                        resolved: workflowDefs.resolveAutonomousInputs(def),
                    }));
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ workflows: enriched }));
                } catch (error) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            }
        },
        {
            method: 'POST',
            path: '/api/workflows',
            handler(req, res) {
                readJsonBody(req).then(payload => {
                    try {
                        const { repo: repoPath, definition, scope } = payload;
                        if (!definition || !definition.slug) {
                            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: 'definition.slug is required' }));
                            return;
                        }
                        const workflowDefs = require('./workflow-definitions');
                        if (workflowDefs.isBuiltIn(definition.slug)) {
                            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: `"${definition.slug}" is a built-in workflow` }));
                            return;
                        }
                        const isGlobal = scope === 'global';
                        const savedPath = isGlobal
                            ? workflowDefs.saveGlobal(definition)
                            : workflowDefs.saveProject(path.resolve(repoPath || process.cwd()), definition);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: true, path: savedPath, scope: isGlobal ? 'global' : 'project' }));
                    } catch (error) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: error.message }));
                    }
                }).catch(() => {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                });
            }
        },
        {
            method: 'DELETE',
            path: /^\/api\/workflows\/.+$/,
            handler(req, res) {
                try {
                    const reqPath = (req.url || '/').split('?')[0];
                    const slug = reqPath.replace('/api/workflows/', '');
                    const reqUrl = new URL(req.url || reqPath, 'http://localhost');
                    const repoQuery = reqUrl.searchParams.get('repo');
                    const scope = reqUrl.searchParams.get('scope') || 'project';
                    const workflowDefs = require('./workflow-definitions');
                    if (workflowDefs.isBuiltIn(slug)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: `"${slug}" is a built-in workflow` }));
                        return;
                    }
                    const removed = scope === 'global'
                        ? workflowDefs.deleteGlobal(slug)
                        : workflowDefs.deleteProject(path.resolve(repoQuery || process.cwd()), slug);
                    res.writeHead(removed ? 200 : 404, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ ok: removed }));
                } catch (error) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            }
        },
        {
            path: '/api/stats-aggregate',
            handler(req, res, ctx) {
                try {
                    const reqUrl = new URL(req.url || '/api/stats-aggregate', 'http://localhost');
                    const force = reqUrl.searchParams.get('force') === '1';
                    const repoFilter = reqUrl.searchParams.get('repo');
                    const statsAggregate = require('./stats-aggregate');
                    const repos = ctx.routes.readConductorReposFromGlobalConfig();
                    const targetRepos = repoFilter
                        ? repos.filter(r => path.resolve(r) === path.resolve(repoFilter))
                        : repos;
                    const effectiveRepos = (targetRepos.length > 0 ? targetRepos : [process.cwd()]).map(r => path.resolve(r));
                    const byRepo = effectiveRepos.map(repoPath => ({
                        repoPath,
                        aggregate: statsAggregate.collectAggregateStats(repoPath, { force }),
                    }));
                    ctx.sendJson(200, { version: statsAggregate.CACHE_VERSION, repos: byRepo });
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            }
        },
        {
            method: 'GET',
            path: '/api/commits',
            handler(req, res, ctx) {
                try {
                    const reqUrl = new URL(req.url || '/api/commits', 'http://localhost');
                    const forceRefresh = reqUrl.searchParams.get('force') === '1';
                    const repoFilter = reqUrl.searchParams.get('repo');
                    const from = reqUrl.searchParams.get('from');
                    const to = reqUrl.searchParams.get('to');
                    const feature = reqUrl.searchParams.get('feature');
                    const agent = reqUrl.searchParams.get('agent');
                    const periodDays = ctx.routes.parsePeriodDays(reqUrl.searchParams.get('period') || '');
                    const limitRaw = parseInt(reqUrl.searchParams.get('limit') || '2000', 10);
                    const limit = limitRaw === 0 ? Infinity : (Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50000) : 2000);

                    const repos = ctx.routes.readConductorReposFromGlobalConfig();
                    const targetRepos = repoFilter
                        ? repos.filter(r => path.resolve(r) === path.resolve(repoFilter))
                        : repos;
                    const effectiveRepos = targetRepos.length > 0 ? targetRepos : [process.cwd()];

                    const allCommits = [];
                    effectiveRepos.forEach(repoPath => {
                        const payload = git.getCommitAnalytics({ cwd: repoPath, forceRefresh });
                        (payload.commits || []).forEach(commit => {
                            allCommits.push({ ...commit, repoPath: path.resolve(repoPath) });
                        });
                    });

                    let filtered = git.filterCommitAnalytics(allCommits, {
                        from: from || null,
                        to: to || null,
                        feature: feature || null,
                        agent: agent || null,
                        periodDays
                    });
                    filtered = filtered
                        .slice()
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                    const summary = git.buildCommitAnalyticsSummary(filtered);
                    const series = git.buildCommitSeries(filtered);
                    const commits = filtered.slice(0, limit);

                    ctx.sendJson(200, { commits, summary, series });
                } catch (error) {
                    ctx.sendJson(500, { error: error.message });
                }
            }
        },
        {
            method: 'POST',
            path: '/api/spec/create',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    try {
                        const repoPath = String(payload.repoPath || '').trim();
                        const type = String(payload.type || '').trim();
                        const name = String(payload.name || '').trim();
                        if (!repoPath || !type || !name) {
                            ctx.sendJson(400, { error: 'Missing repoPath, type, or name' });
                            return;
                        }
                        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                        if (!slug) {
                            ctx.sendJson(400, { error: 'Invalid name' });
                            return;
                        }
                        let inboxDir;
                        let fileName;
                        let template;
                        const titleName = name;
                        if (type === 'features') {
                            inboxDir = path.join(repoPath, 'docs', 'specs', 'features', '01-inbox');
                            fileName = `feature-${slug}.md`;
                            template = `# Feature: ${titleName}\n\n## Summary\n\nDescribe the feature here.\n\n## User Stories\n\n- [ ] As a user, I can ...\n\n## Acceptance Criteria\n\n- [ ] ...\n\n## Technical Approach\n\n...\n\n## Validation\n\n...\n\n## Dependencies\n\n- None\n\n## Out of Scope\n\n- ...\n`;
                        } else if (type === 'research') {
                            inboxDir = path.join(repoPath, 'docs', 'specs', 'research-topics', '01-inbox');
                            fileName = `research-${slug}.md`;
                            template = `# Research: ${titleName}\n\n## Context\n\nDescribe the research question or problem here.\n\n## Questions to Answer\n\n1. ...\n\n## Approach\n\n...\n\n## Success Criteria\n\nWhat does a good answer look like?\n`;
                        } else if (type === 'feedback') {
                            inboxDir = path.join(repoPath, 'docs', 'specs', 'feedback', '01-inbox');
                            fileName = `feedback-${slug}.md`;
                            template = `---\ntitle: "${name}"\nstatus: "inbox"\ntype: "bug"\nreporter:\n  name: ""\n  identifier: ""\nsource:\n  channel: "dashboard"\n  reference: ""\n---\n\n## Summary\n\nDescribe the feedback here.\n\n## Steps to Reproduce\n\n1. ...\n\n## Expected Behaviour\n\n...\n\n## Actual Behaviour\n\n...\n`;
                        } else {
                            ctx.sendJson(400, { error: 'Invalid type: ' + type });
                            return;
                        }
                        if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
                        const filePath = path.join(inboxDir, fileName);
                        if (fs.existsSync(filePath)) {
                            ctx.sendJson(409, { error: 'File already exists: ' + fileName });
                            return;
                        }
                        fs.writeFileSync(filePath, template, 'utf8');
                        ctx.helpers.log(`Created ${type} spec via dashboard: ${filePath}`);
                        ctx.sendJson(200, { ok: true, path: filePath, name: slug });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'GET',
            path: /^\/api\/recommendation\/(feature|research)\/(\d+)$/,
            handler(req, res, ctx, match) {
                const type = match[1];
                const id = match[2];
                const url = new URL(req.url, `http://${req.headers.host}`);
                const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
                const registered = ctx.routes.readConductorReposFromGlobalConfig();
                const resolvedRepo = ctx.routes.resolveDetailRepoPath(registered, {
                    repoPath: repoPathHint,
                    type,
                    id,
                });
                if (!resolvedRepo) {
                    ctx.sendJson(404, { error: 'Could not resolve repository' });
                    return;
                }
                try {
                    const specRec = require('./spec-recommendation');
                    const resolver = require('./feature-spec-resolver');
                    const resolved = resolver.resolveEntitySpec(resolvedRepo, type, id);
                    const recommendation = resolved && resolved.path
                        ? specRec.readSpecRecommendation(resolved.path)
                        : null;
                    ctx.sendJson(200, {
                        specPath: resolved ? resolved.path : null,
                        raw: recommendation,
                        resolved: specRec.buildRecommendationPayload(recommendation),
                    });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'GET',
            path: /^\/api\/feature-status\/(\d+)$/,
            handler(req, res, ctx, match) {
                const id = match[1];
                const url = new URL(req.url, `http://${req.headers.host}`);
                const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
                const entityType = String(url.searchParams.get('type') || 'feature').trim();
                const registered = ctx.routes.readConductorReposFromGlobalConfig();
                const resolvedRepo = ctx.routes.resolveDetailRepoPath(registered, {
                    repoPath: repoPathHint,
                    type: entityType,
                    id,
                });
                if (!resolvedRepo) {
                    ctx.sendJson(404, { error: 'Could not resolve repository' });
                    return;
                }
                try {
                    const deepStatus = ctx.routes.collectFeatureDeepStatus(resolvedRepo, id, { entityType });
                    ctx.sendJson(200, deepStatus);
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'GET',
            path: /^\/api\/detail\/(feature|research)\/(\d+)$/,
            handler(req, res, ctx, match) {
                const type = match[1];
                const id = match[2];
                const url = new URL(req.url, `http://${req.headers.host}`);
                const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
                const specPathHint = String(url.searchParams.get('specPath') || '').trim();
                const registered = ctx.routes.readConductorReposFromGlobalConfig();
                const resolvedRepo = ctx.routes.resolveDetailRepoPath(registered, {
                    repoPath: repoPathHint,
                    specPath: specPathHint,
                    type,
                    id
                });
                if (!resolvedRepo) {
                    ctx.sendJson(404, { error: 'Could not resolve repository for detail request' });
                    return;
                }
                try {
                    const payload = ctx.routes.buildDetailPayload(resolvedRepo, type, id, specPathHint);
                    ctx.sendJson(200, payload);
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'GET',
            path: reqPath => reqPath.startsWith('/api/spec') ? [reqPath] : null,
            handler(req, res, ctx) {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const filePath = url.searchParams.get('path') || '';
                if (!filePath || !filePath.endsWith('.md') || !fs.existsSync(filePath)) {
                    ctx.sendJson(400, { error: 'File not found' });
                    return;
                }
                try {
                    let content = fs.readFileSync(filePath, 'utf8');
                    content = ctx.routes.appendDependencyGraph(filePath, content);
                    ctx.sendJson(200, { content, path: filePath });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'POST',
            path: '/api/open-in-editor',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    try {
                        const filePath = String(payload.path || '').trim();
                        if (!filePath || !fs.existsSync(filePath)) {
                            ctx.sendJson(400, { error: 'File not found' });
                            return;
                        }
                        ctx.routes.platformOpen(filePath);
                        ctx.sendJson(200, { ok: true });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/open-folder',
            handler: handleOpenPath,
        },
        {
            method: 'POST',
            path: '/api/open-path',
            handler: handleOpenPath,
        },
        {
            method: 'POST',
            path: '/api/repos/add',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    try {
                        const repoPath = String(payload.path || '').trim();
                        if (!repoPath) {
                            ctx.sendJson(400, { error: 'path is required' });
                            return;
                        }
                        const expandedPath = repoPath.startsWith('~') ? repoPath.replace(/^~/, os.homedir()) : repoPath;
                        const absPath = path.resolve(expandedPath);
                        if (!fs.existsSync(absPath)) {
                            ctx.sendJson(400, { error: 'Path does not exist: ' + absPath });
                            return;
                        }
                        const repos = ctx.routes.readConductorReposFromGlobalConfig();
                        if (repos.includes(absPath)) {
                            ctx.sendJson(409, { error: 'Repo already registered' });
                            return;
                        }
                        repos.push(absPath);
                        ctx.routes.writeRepoRegistry(repos);
                        ctx.helpers.log(`Repo added via dashboard: ${absPath}`);
                        ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                        ctx.sendJson(200, { ok: true, repos });
                    } catch (e) {
                        ctx.sendJson(400, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/repos/remove',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    try {
                        const repoPath = String(payload.path || '').trim();
                        if (!repoPath) {
                            ctx.sendJson(400, { error: 'path is required' });
                            return;
                        }
                        const repos = ctx.routes.readConductorReposFromGlobalConfig();
                        const filtered = repos.filter(r => r !== repoPath);
                        if (filtered.length === repos.length) {
                            ctx.sendJson(404, { error: 'Repo not found in registry' });
                            return;
                        }
                        ctx.routes.writeRepoRegistry(filtered);
                        ctx.helpers.log(`Repo removed via dashboard: ${repoPath}`);
                        ctx.setLatestStatus(ctx.routes.collectDashboardStatusData());
                        ctx.sendJson(200, { ok: true, repos: filtered });
                    } catch (e) {
                        ctx.sendJson(400, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/doctor',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    try {
                        const repoPath = String(payload.path || '').trim();
                        const doFix = payload.fix === true;
                        if (!repoPath) {
                            ctx.sendJson(400, { error: 'path is required' });
                            return;
                        }
                        if (!fs.existsSync(repoPath)) {
                            ctx.sendJson(400, { error: 'Repo path does not exist: ' + repoPath });
                            return;
                        }
                        const args = [ctx.routes.CLI_ENTRY_PATH, 'doctor'];
                        if (doFix) args.push('--fix');
                        const result = spawnSync(process.execPath, args, {
                            cwd: repoPath,
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'pipe'],
                            env: { ...process.env, AIGON_INVOKED_BY_DASHBOARD: '1', NO_COLOR: '1' },
                        });
                        const output = ((result.stdout || '') + (result.stderr || '')).trim();
                        const issueCount = (output.match(/⚠️/g) || []).length;
                        const fixCount = (output.match(/🔧/g) || []).length;
                        ctx.sendJson(200, {
                            ok: true,
                            output,
                            issueCount,
                            fixCount,
                            exitCode: typeof result.status === 'number' ? result.status : 1,
                        });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'GET',
            path: '/api/supervisor/status',
            handler(req, res, ctx) {
                const supervisorStatus = typeof ctx.options.getSupervisorStatus === 'function'
                    ? ctx.options.getSupervisorStatus()
                    : { running: false, lastSweepAt: null, sweepCount: 0 };
                ctx.sendJson(200, supervisorStatus);
            }
        },
        {
            method: 'GET',
            path: '/api/sessions',
            handler(req, res, ctx) {
                try {
                    const enriched = getEnrichedSessions();
                    const repos = ctx.routes.readConductorReposFromGlobalConfig().map(r => path.resolve(r));
                    ctx.sendJson(200, { ...enriched, repos });
                } catch (e) {
                    ctx.sendJson(200, { sessions: [], orphanCount: 0, error: e.message });
                }
            }
        },
        {
            method: 'POST',
            path: '/api/session/run',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const command = String(payload.command || '').trim();
                    const cwd = String(payload.cwd || '').trim() || process.cwd();
                    if (!command) {
                        ctx.sendJson(400, { error: 'command is required' });
                        return;
                    }
                    try {
                        const effectiveCwd = fs.existsSync(cwd) ? cwd : process.cwd();
                        const sessionStartTime = Date.now();
                        const resolved = ctx.routes.resolveDashboardSessionCommand(command);
                        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                        const result = spawnSync(resolved.bin, resolved.args, {
                            cwd: effectiveCwd,
                            encoding: 'utf8',
                            timeout: 120000,
                            maxBuffer: 1024 * 1024,
                            env: { ...process.env, AIGON_DASHBOARD: '1' }
                        });
                        const exitCode = result.status !== null ? result.status : 1;
                        ctx.helpers.logToLogs({
                            type: 'session',
                            action: 'session/run',
                            args: [],
                            repoPath: effectiveCwd,
                            command,
                            exitCode,
                            ok: exitCode === 0,
                            stdout: result.stdout || '',
                            stderr: result.stderr || '',
                            duration: Date.now() - sessionStartTime
                        });
                        ctx.sendJson(200, { ok: exitCode === 0, stdout: result.stdout || '', stderr: result.stderr || '', exitCode });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/session/stop',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const sessionName = String(payload.sessionName || '').trim();
                    if (!sessionName) {
                        ctx.sendJson(400, { error: 'sessionName is required' });
                        return;
                    }
                    try {
                        runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
                        ctx.helpers.log(`Session killed: ${sessionName}`);
                        ctx.sendJson(200, { ok: true });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'POST',
            path: '/api/sessions/cleanup',
            handler(req, res, ctx) {
                try {
                    const { sessions } = getEnrichedSessions();
                    const orphans = sessions.filter(s => s.orphan);
                    const killed = [];
                    const failed = [];
                    for (const session of orphans) {
                        const name = session.sessionName || session.name;
                        if (!name) continue;
                        try {
                            runTmux(['kill-session', '-t', name], { stdio: 'ignore' });
                            killed.push(name);
                        } catch (e) {
                            failed.push({ name, error: e.message });
                        }
                    }
                    ctx.helpers.log(`Sessions cleanup: killed ${killed.length} orphan(s)${failed.length ? `, ${failed.length} failed` : ''}`);
                    ctx.sendJson(200, { count: killed.length, killed, failed });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'GET',
            path: '/api/session/status',
            handler(req, res, ctx) {
                const sessionParam = (req.url || '').split('?')[1] || '';
                const session = (sessionParam.match(/(?:^|&)session=([^&]*)/) || [])[1] || '';
                if (!session) {
                    ctx.sendJson(400, { error: 'session query param is required' });
                    return;
                }
                const running = tmuxSessionExists(session);
                ctx.sendJson(200, { running });
            }
        },
        {
            method: 'POST',
            path: '/api/session/view',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const sessionName = String(payload.sessionName || '').trim();
                    const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, payload.repoPath);
                    if (!repoPath) return;
                    if (!sessionName) {
                        ctx.sendJson(400, { error: 'sessionName is required' });
                        return;
                    }
                    if (!tmuxSessionExists(sessionName)) {
                        ctx.sendJson(409, { error: `Session "${sessionName}" is not running` });
                        return;
                    }
                    try {
                        openTerminalAppWithCommand(repoPath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        ctx.sendJson(200, { ok: true, message: `Viewing ${sessionName}` });
                    } catch (e) {
                        ctx.sendJson(500, { error: `Failed to open terminal: ${e.message}` });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'GET',
            path: /^\/api\/peek\/(\d+)\/([a-zA-Z0-9_-]+)$/,
            handler(req, res, ctx, match) {
                const fid = toUnpaddedId(match[1]);
                const agentId = match[2];
                const url = new URL(req.url, `http://${req.headers.host}`);
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, String(url.searchParams.get('repoPath') || '').trim());
                if (!repoPath) return;
                const rawLines = parseInt(url.searchParams.get('lines') || '20', 10);
                const linesParam = Math.min(Math.max(Number.isFinite(rawLines) && rawLines > 0 ? rawLines : 20, 1), 200);

                const repo = path.basename(repoPath);
                let sessionName = null;
                for (const typeChar of ['f', 'r']) {
                    const candidate = `${repo}-${typeChar}${fid}-${agentId}`;
                    if (tmuxSessionExists(candidate)) { sessionName = candidate; break; }
                }
                if (!sessionName) {
                    const evalPrefixF = `${repo}-f${fid}-eval`;
                    sessionName = findFirstTmuxSessionByPrefix(evalPrefixF, s => s) || null;
                }
                if (!sessionName) {
                    const evalResearch = `${repo}-r${fid}-eval-${agentId}`;
                    if (tmuxSessionExists(evalResearch)) sessionName = evalResearch;
                }
                if (!sessionName) {
                    const reviewCandidate = `${repo}-f${fid}-review-${agentId}`;
                    if (tmuxSessionExists(reviewCandidate)) sessionName = reviewCandidate;
                }
                if (!sessionName) {
                    const reviewRCandidate = `${repo}-r${fid}-review-${agentId}`;
                    if (tmuxSessionExists(reviewRCandidate)) sessionName = reviewRCandidate;
                }

                if (!sessionName) {
                    ctx.sendJson(200, { lines: [], sessionName: '', uptime: '', lastActivity: '', alive: false });
                    return;
                }

                try {
                    const snap = runTmux(['capture-pane', '-t', sessionName, '-p', '-S', '-200'], { encoding: 'utf8', stdio: 'pipe' });
                    const rawOutput = (!snap.error && snap.status === 0) ? (snap.stdout || '') : '';
                    const cleaned = rawOutput.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
                    const allLines = cleaned.split('\n');
                    const lines = allLines.slice(-Math.min(linesParam, allLines.length));
                    const { uptime, lastActivity } = ctx.routes.getTmuxSessionPeekMeta(sessionName);
                    ctx.sendJson(200, { lines, sessionName, uptime, lastActivity, alive: true });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }
        },
        {
            method: 'GET',
            path: '/api/pty-token',
            handler(req, res, ctx) {
                ctx.sendJson(200, { token: mintPtyToken() });
            }
        },
        {
            method: 'GET',
            path: '/api/session/stream',
            handler(req, res, ctx) {
                const qs = (req.url || '').split('?')[1] || '';
                const nameMatch = qs.match(/(?:^|&)name=([^&]*)/);
                const sessionName = decodeURIComponent(nameMatch ? nameMatch[1] : '').trim();

                if (!sessionName) {
                    ctx.sendJson(400, { error: 'name query param is required' });
                    return;
                }
                if (!tmuxSessionExists(sessionName)) {
                    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                    res.write(`event: end\ndata: ${JSON.stringify({ alive: false })}\n\n`);
                    res.end();
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                });
                res.write(': connected\n\n');

                let lastOutput = null;
                function poll() {
                    if (!tmuxSessionExists(sessionName)) {
                        try { res.write(`event: end\ndata: ${JSON.stringify({ alive: false })}\n\n`); res.end(); } catch (_) {}
                        clearInterval(timer);
                        return;
                    }
                    try {
                        const snap = runTmux(['capture-pane', '-t', sessionName, '-p', '-e', '-S', '-500'], { encoding: 'utf8', stdio: 'pipe' });
                        const output = (!snap.error && snap.status === 0) ? (snap.stdout || '') : '';
                        if (output !== lastOutput) {
                            lastOutput = output;
                            res.write(`data: ${JSON.stringify({ output })}\n\n`);
                        }
                    } catch (_) {}
                }

                poll();
                const timer = setInterval(poll, 600);
                req.on('close', () => clearInterval(timer));
            }
        },
        {
            method: 'POST',
            path: '/api/session/terminal-input',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const sessionName = String(payload.name || '').trim();
                    const text = String(payload.text || '');
                    const enter = payload.enter !== false;
                    if (!sessionName) {
                        ctx.sendJson(400, { error: 'name is required' });
                        return;
                    }
                    if (!tmuxSessionExists(sessionName)) {
                        ctx.sendJson(409, { error: `Session "${sessionName}" is not running` });
                        return;
                    }
                    const sanitized = text.replace(/[\x00-\x08\x0e-\x1f]/g, '');
                    try {
                        if (sanitized) runTmux(['send-keys', '-t', sessionName, '-l', sanitized], { stdio: 'ignore' });
                        if (enter) runTmux(['send-keys', '-t', sessionName, 'Enter'], { stdio: 'ignore' });
                        ctx.sendJson(200, { ok: true });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
        {
            method: 'GET',
            path: '/api/logs',
            handler(req, res, ctx) {
                ctx.sendJson(200, { events: ctx.state.logsBuffer.slice() });
            }
        },
        {
            method: 'GET',
            path: '/api/notifications',
            handler(req, res, ctx) {
                ctx.sendJson(200, { events: ctx.state.notificationBuffer.slice(), unreadCount: ctx.getNotificationUnreadCount() });
            }
        },
        {
            method: 'POST',
            path: '/api/notifications/read',
            handler(req, res, ctx) {
                ctx.state.notificationBuffer.forEach(e => { e.read = true; });
                ctx.setNotificationUnreadCount(0);
                ctx.sendJson(200, { ok: true });
            }
        },
        {
            method: 'GET',
            path: '/api/settings/notifications',
            handler(req, res, ctx) {
                ctx.sendJson(200, ctx.helpers.getNotificationConfig());
            }
        },
        {
            method: 'GET',
            path: '/api/settings',
            handler(req, res, ctx) {
                const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
                const repoPath = String(parsedUrl.searchParams.get('repoPath') || '').trim();
                const globalOnly = parsedUrl.searchParams.get('globalOnly') === '1';
                if (globalOnly) {
                    ctx.sendJson(200, ctx.routes.buildDashboardSettingsPayload(process.cwd(), { globalOnly: true }));
                    return;
                }
                const resolvedRepoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, repoPath);
                if (!resolvedRepoPath) return;
                ctx.sendJson(200, ctx.routes.buildDashboardSettingsPayload(resolvedRepoPath));
            }
        },
        {
            method: 'PUT',
            path: '/api/settings',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(payload => {
                    const scope = String(payload.scope || '').trim();
                    const key = String(payload.key || '').trim();
                    const repoPathRaw = String(payload.repoPath || '').trim();
                    if (scope !== 'global' && scope !== 'project') {
                        ctx.sendJson(400, { error: 'scope must be "global" or "project"' });
                        return;
                    }
                    const settingDef = ctx.routes.DASHBOARD_SETTINGS_SCHEMA.find(s => s.key === key);
                    if (!settingDef) {
                        ctx.sendJson(400, { error: `Unsupported setting key: ${key}` });
                        return;
                    }

                    const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, repoPathRaw);
                    if (!repoPath) return;

                    let coercedValue;
                    try {
                        coercedValue = ctx.routes.coerceDashboardSettingValue(settingDef.type, payload.value);
                        if ((settingDef.type === 'enum' || settingDef.type === 'select') && !settingDef.options.includes(coercedValue)) {
                            throw new Error(`Expected one of: ${settingDef.options.join(', ')}`);
                        }
                    } catch (e) {
                        ctx.sendJson(400, { error: e.message });
                        return;
                    }

                    try {
                        if (scope === 'global') {
                            const next = ctx.routes.readRawGlobalConfig();
                            ctx.routes.setNestedValue(next, key, coercedValue);
                            saveGlobalConfig(next);
                            ctx.setGlobalConfig(loadGlobalConfig());
                        } else {
                            const projectConfigPath = path.join(repoPath, '.aigon', 'config.json');
                            let next = {};
                            try {
                                if (fs.existsSync(projectConfigPath)) {
                                    next = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
                                }
                            } catch (_) { /* use empty config */ }
                            ctx.routes.setNestedValue(next, key, coercedValue);
                            fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
                            fs.writeFileSync(projectConfigPath, JSON.stringify(next, null, 2) + '\n');
                        }
                        ctx.sendJson(200, { ok: true, ...ctx.routes.buildDashboardSettingsPayload(repoPath) });
                    } catch (e) {
                        ctx.sendJson(500, { error: e.message });
                    }
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
                            const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
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
                            const failover = require('./agent-failover');
                            const { getAgentFailoverConfig } = require('./config');
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
                            const { resolveAgentPromptBody } = require('./agent-prompt-resolver');
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
            path: '/api/settings/notifications',
            handler(req, res, ctx) {
                ctx.readJsonBody().then(updates => {
                    try {
                        let rawConfig = {};
                        try { rawConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8')); } catch (_) {}
                        const current = rawConfig.notifications || {};
                        const merged = { ...current };
                        if (typeof updates.enabled === 'boolean') merged.enabled = updates.enabled;
                        if (updates.types && typeof updates.types === 'object') {
                            merged.types = { ...(current.types || {}), ...updates.types };
                        }
                        rawConfig.notifications = merged;
                        saveGlobalConfig(rawConfig);
                        ctx.setGlobalConfig(loadGlobalConfig());
                        ctx.helpers.log(`Notification settings updated: ${JSON.stringify(merged)}`);
                        ctx.sendJson(200, { ok: true, notifications: ctx.helpers.getNotificationConfig() });
                    } catch (e) {
                        ctx.sendJson(400, { error: e.message });
                    }
                }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
            }
        },
    ];

    return {
        dispatchOssRoute(method, reqPath, req, res) {
            const methodKey = normalizeMethod(method);
            for (const route of routes) {
                if (route.method && normalizeMethod(route.method) !== methodKey) continue;
                const match = matchesPath(route.path, reqPath);
                if (!match) continue;
                route.handler(req, res, buildRouteContext(req, res, serverCtx), match);
                return true;
            }
            return false;
        }
    };
}

function handleOpenPath(req, res, ctx) {
    ctx.readJsonBody().then(payload => {
        try {
            const folderPath = String(payload.path || '').trim();
            if (!folderPath || !fs.existsSync(folderPath)) {
                ctx.sendJson(400, {
                    ok: false,
                    error: {
                        code: 'PATH_NOT_FOUND',
                        message: 'Path does not exist',
                    }
                });
                return;
            }
            ctx.routes.platformOpen(folderPath);
            ctx.sendJson(200, { ok: true });
        } catch (e) {
            ctx.sendJson(500, {
                ok: false,
                error: {
                    code: e && e.code ? String(e.code) : 'OPEN_FAILED',
                    message: e && e.message ? e.message : 'Failed to open folder'
                }
            });
        }
    }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
}

module.exports = {
    createDashboardRouteDispatcher,
};
