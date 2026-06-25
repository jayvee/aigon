'use strict';

const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

// F590: log /api/status serialization cost + uncompressed payload size. Always
// log when the body is large; otherwise sample 1-in-10 to keep the log quiet.
const STATUS_LOG_BYTE_THRESHOLD = 512 * 1024;
let _statusReqCount = 0;
function logStatusRequest(ctx, serializeMs, bytes) {
    _statusReqCount += 1;
    const over = bytes > STATUS_LOG_BYTE_THRESHOLD;
    if (!over && _statusReqCount % 10 !== 0) return;
    const kb = Math.round(bytes / 1024);
    const logFn = ctx.helpers && typeof ctx.helpers.log === 'function' ? ctx.helpers.log : null;
    if (logFn) logFn(`[perf] /api/status serialize=${serializeMs}ms bytes=${bytes} (${kb}KB)${over ? ' ⚠️ large' : ''}`);
}

function probePort(port, timeoutMs) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        const done = (result) => { sock.destroy(); resolve(result); };
        sock.setTimeout(timeoutMs);
        sock.on('connect', () => done(true));
        sock.on('error', () => done(false));
        sock.on('timeout', () => done(false));
        sock.connect(port, '127.0.0.1');
    });
}
const {
    openTerminalAppWithCommand,
    tileITerm2Windows,
} = require('../worktree');

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

module.exports = [
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
    // /api/profile/status, /api/settings-sync/status, /api/backup/status,
    // /api/backup/schedule, and /api/sync/status moved to @aigon/pro with
    // feature 236. Pro registers them via lib/pro-bridge.js.
    {
        method: 'POST',
        path: '/api/refresh',
        async handler(req, res, ctx) {
            // F471: await the async pollStatus so the response carries the
            // FRESH snapshot, not the stale pre-action one. The async
            // collector yields between repos, so other requests are not
            // blocked during the ~750ms scan. The route dispatcher
            // (lib/dashboard-routes.js) does not await handlers, so we
            // catch our own errors here to avoid unhandled rejections.
            try {
                await ctx.helpers.pollStatus();
                ctx.sendJson(200, ctx.getLatestStatus());
            } catch (e) {
                ctx.sendJson(500, { error: e && e.message ? e.message : 'refresh failed' });
            }
        }
    },
    {
        method: 'POST',
        path: '/api/action',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(async (payload) => {
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
                const actionId = payload.actionId || null;
                ctx.state.inflightActions.set(dedupeKey, { startedAt: new Date().toISOString(), action: payload.action, actionId });

                const actionStartTime = Date.now();
                let result;
                try {
                    result = await ctx.routes.runDashboardInteractiveAction({
                        ...payload,
                        registeredRepos: ctx.routes.readConductorReposFromGlobalConfig(),
                        defaultRepoPath: process.cwd(),
                        actionId,
                        activeActionLogs: ctx.state.activeActionLogs,
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
                    const close = require('../feature-close');
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
        method: 'GET',
        path: /^\/api\/action-log\/([^/]+)$/,
        handler(req, res, ctx, match) {
            const actionId = match && match[1] ? decodeURIComponent(match[1]) : '';
            if (!actionId) {
                ctx.sendJson(400, { error: 'actionId is required' });
                return;
            }
            const entry = ctx.state.activeActionLogs && ctx.state.activeActionLogs.get(actionId);
            if (!entry) {
                // Entry not yet created (POST still in flight) — return done:false so
                // the client keeps polling instead of stopping prematurely.
                ctx.sendJson(200, { lines: [], done: false });
                return;
            }
            ctx.sendJson(200, { lines: entry.lines.slice(), done: entry.done });
        }
    },
    {
        path: '/api/status',
        handler(req, res, ctx) {
            const payload = ctx.getLatestStatus();
            // F590: measure serialize cost + uncompressed bytes, then send the
            // pre-serialized body (gzip negotiated in sendJsonSerialized).
            const t = performance.now();
            const body = JSON.stringify(payload);
            const serializeMs = Math.round((performance.now() - t) * 100) / 100;
            const bytes = ctx.sendJsonSerialized(200, body);
            logStatusRequest(ctx, serializeMs, bytes);
        }
    },
    {
        // F590: full uncapped lean feature list for one repo, fetched on demand
        // by the All Items / Logs view (kept off the hot /api/status poll path).
        method: 'GET',
        path: '/api/repos/all-features',
        handler(req, res, ctx) {
            try {
                const url = new URL(req.url, 'http://localhost');
                const requested = url.searchParams.get('repoPath') || '';
                const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, requested);
                if (!repoPath) return;
                const features = ctx.routes.collectAllFeaturesLean(repoPath);
                ctx.sendJson(200, { repoPath, features });
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
        method: 'GET',
        path: '/api/docs-url',
        async handler(req, res, ctx) {
            const up = await probePort(3600, 500);
            ctx.sendJson(200, { url: up ? 'http://localhost:3600' : 'https://www.aigon.build/docs' });
        }
    },
];
