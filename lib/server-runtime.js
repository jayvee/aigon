'use strict';

function buildDashboardServerOptions(options = {}) {
    const { isPreview, repoRoot, appId, _isRestart } = options;
    const { startSupervisorLoop, getSupervisorStatus } = require('./supervisor');
    return {
        ...(isPreview ? { templateRoot: repoRoot } : {}),
        ...(appId ? { appId } : {}),
        ...(_isRestart ? { _isRestart: true } : {}),
        startSupervisorLoop,
        getSupervisorStatus,
    };
}

async function resolveDashboardPort(dashCtx, instanceName, deps) {
    const {
        DASHBOARD_DYNAMIC_PORT_START,
        hashBranchToPort,
        isPortAvailable,
        allocatePort,
    } = deps;
    if (process.env.DASHBOARD_PORT) {
        return parseInt(process.env.DASHBOARD_PORT, 10);
    }
    if (process.env.PORT) {
        return parseInt(process.env.PORT, 10);
    }
    if (!dashCtx.isWorktree) {
        // Main server: single source of truth lives in config.
        const { getConfiguredServerPort } = require('./config');
        return getConfiguredServerPort();
    }
    const preferred = hashBranchToPort(instanceName);
    return (await isPortAvailable(preferred)) ? preferred : await allocatePort(DASHBOARD_DYNAMIC_PORT_START);
}

/**
 * Ensure the dashboard route exists in the Caddyfile.
 * Writes the route and reloads Caddy so .localhost URLs work.
 * No-op if Caddy is not installed.
 */
function ensureDashboardCaddyRoute(port, deps) {
    const { addCaddyRoute, getAigonServerAppId, buildCaddyHostname } = deps;
    if (!addCaddyRoute) return;
    try {
        const appId = getAigonServerAppId();
        const hostname = buildCaddyHostname(appId, null);
        addCaddyRoute(hostname, port, 'Dashboard');
    } catch (_) { /* non-fatal */ }
}

async function stopDashboardProcess(existing, label, deps) {
    const { isProcessAlive } = deps;
    if (!(existing && existing.pid && isProcessAlive(existing.pid))) {
        return false;
    }
    try {
        process.kill(existing.pid, 'SIGTERM');
        for (let i = 0; i < 30; i++) {
            if (!isProcessAlive(existing.pid)) break;
            await new Promise(r => setTimeout(r, 100));
        }
        if (label) console.log(`🔄 Stopped ${label} (PID ${existing.pid})`);
        return true;
    } catch (e) {
        console.error(`⚠️  Could not stop PID ${existing.pid}: ${e.message}`);
        return false;
    }
}

async function killPortHolder(port) {
    // Kill any process holding the target port that wasn't caught by the registry lookup.
    // This handles stale `aigon server` processes that live in a different registry
    // than `aigon server`, which would otherwise cause EADDRINUSE on the new server.
    const { execSync } = require('child_process');
    try {
        const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
        if (!pids) return;
        for (const pid of pids.split('\n').filter(Boolean)) {
            const n = parseInt(pid, 10);
            if (!n || n === process.pid) continue;
            try {
                console.log(`[server] SIGTERM port ${port} holder PID ${n} from PID ${process.pid} (${process.argv.slice(1).join(' ')})`);
                process.kill(n, 'SIGTERM');
                // Give it up to 1s to exit
                let stillAlive = true;
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    try { process.kill(n, 0); } catch (_) { stillAlive = false; break; } // gone
                }
                // SIGKILL fallback if SIGTERM didn't take effect.
                // Re-check the existence guard so we never escalate against ourselves.
                if (stillAlive && n !== process.pid) {
                    console.log(`[server] force-killing stale port holder PID ${n}`);
                    try { process.kill(n, 'SIGKILL'); } catch (_) { /* already gone */ }
                    // Up to 500ms more for the kernel to reap it
                    for (let i = 0; i < 5; i++) {
                        await new Promise(r => setTimeout(r, 100));
                        try { process.kill(n, 0); } catch (_) { break; }
                    }
                    // If it's STILL alive (zombie / uninterruptible), fall through —
                    // the subsequent server.listen() will fail with its own EADDRINUSE
                    // and the existing error handler takes over.
                }
            } catch (_) { /* already dead */ }
        }
    } catch (_) { /* lsof not available or port free */ }
}

async function launchDashboardServer(params, deps) {
    const {
        dashCtx,
        instanceName,
        serverId,
        isPreview,
        repoRoot,
        appId,
        proxyAvailable,
    } = params;
    const { runDashboardServer } = deps;
    const port = await resolveDashboardPort(dashCtx, instanceName, deps);
    // Clear any stale process holding the port before binding
    await killPortHolder(port);
    // Write the dashboard route to the Caddyfile so .localhost URLs work.
    // With Caddy, the route is persistent — no reconciliation needed.
    if (proxyAvailable) {
        ensureDashboardCaddyRoute(port, deps);
    }
    runDashboardServer(port, instanceName, serverId, buildDashboardServerOptions({ isPreview, repoRoot, appId, _isRestart: params._isRestart }));
}

/**
 * Poll the dashboard server until it responds, or until the timeout elapses.
 * Used by `aigon update` to verify that a launchd/systemd or manual respawn
 * actually produced a serving process. Non-fatal: callers treat the boolean
 * result as informational only.
 *
 * Tries `/api/health` first so startup only succeeds once the collector can
 * serve a real status request. Falls back to `/api/supervisor/status`, then `/`
 * for compatibility with older processes during restart windows.
 *
 * @param {number} port
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<boolean>} true if any probe succeeded before the deadline
 */
async function waitForServerHealthy(port, timeoutMs = 5000) {
    const http = require('http');
    const probe = (path, isHealthyStatus) => new Promise(resolve => {
        let settled = false;
        const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
        try {
            const req = http.get({ host: '127.0.0.1', port, path, timeout: 500 }, (res) => {
                res.resume();
                done(isHealthyStatus(res.statusCode));
            });
            req.on('error', () => done(false));
            req.on('timeout', () => { try { req.destroy(); } catch (_) {} done(false); });
        } catch (_) {
            done(false);
        }
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probe('/api/health', statusCode => statusCode === 200)) return true;
        if (await probe('/api/supervisor/status', statusCode => statusCode === 200)) return true;
        if (await probe('/', statusCode => statusCode >= 200 && statusCode < 400)) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

module.exports = {
    buildDashboardServerOptions,
    resolveDashboardPort,
    ensureDashboardCaddyRoute,
    stopDashboardProcess,
    launchDashboardServer,
    killPortHolder,
    waitForServerHealthy,
};
