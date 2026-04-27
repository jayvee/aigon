'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
    GLOBAL_CONFIG_PATH,
    saveGlobalConfig,
    loadGlobalConfig,
} = require('../config');
const {
    getAppId,
    getDevProxyUrl,
    buildCaddyHostname,
    parseCaddyRoutes,
    isPortInUseSync,
} = require('../proxy');
const { resolveFeatureWorktreePath } = require('../dashboard-status-helpers');
const { readJsonBody } = require('./util');

module.exports = [
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
        method: 'GET',
        path: '/api/workflows',
        handler(req, res, ctx) {
            try {
                const reqUrl = new URL(req.url || '/api/workflows', 'http://localhost');
                const repoQuery = reqUrl.searchParams.get('repo');
                const workflowDefs = require('../workflow-definitions');
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
                    const workflowDefs = require('../workflow-definitions');
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
                const workflowDefs = require('../workflow-definitions');
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
        path: '/api/agent-matrix',
        handler(req, res, ctx) {
            const agentMatrix = require('../agent-matrix');
            const rows = agentMatrix.buildMatrix();
            ctx.sendJson(200, { rows, operations: agentMatrix.OPERATIONS, operationLabels: agentMatrix.OPERATION_LABELS });
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
