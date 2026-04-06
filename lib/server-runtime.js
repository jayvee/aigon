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

function reconcileProxyRoutesSafely(proxyAvailable, shouldLog, deps) {
    const { reconcileProxyRoutes } = deps;
    if (!proxyAvailable) return;
    try {
        const result = reconcileProxyRoutes();
        if (!shouldLog) return;
        const parts = [];
        if (result.added > 0) parts.push(`${result.added} route${result.added === 1 ? '' : 's'} added`);
        if (result.removed > 0) parts.push(`${result.removed} orphan${result.removed === 1 ? '' : 's'} removed`);
        if (result.cleaned > 0) parts.push(`${result.cleaned} dead entr${result.cleaned === 1 ? 'y' : 'ies'} cleaned`);
        if (parts.length > 0) {
            console.log(`🔄 Proxy reconciled: ${parts.join(', ')}, ${result.unchanged} unchanged`);
        }
    } catch (e) { /* non-fatal */ }
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
        shouldLogProxyReconcile,
    } = params;
    const { runDashboardServer } = deps;
    const port = await resolveDashboardPort(dashCtx, instanceName, deps);
    // Clear any stale process holding the port before binding (handles the case
    // where `aigon server` and `aigon server` use separate registries and a
    // previous dashboard server wasn't cleaned up by the registry-based stop).
    await killPortHolder(port);
    reconcileProxyRoutesSafely(proxyAvailable, shouldLogProxyReconcile, deps);
    runDashboardServer(port, instanceName, serverId, buildDashboardServerOptions({ isPreview, repoRoot, appId, _isRestart: params._isRestart }));
}

/**
 * Poll the dashboard server until it responds, or until the timeout elapses.
 * Used by `aigon update` to verify that a launchd/systemd or manual respawn
 * actually produced a serving process. Non-fatal: callers treat the boolean
 * result as informational only.
 *
 * Tries `/api/supervisor/status` first (stronger signal — HTTP layer + supervisor
 * subsystem alive). Falls back to `/` if the status endpoint is not yet mounted
 * (e.g. an older server version still in the middle of startup).
 *
 * @param {number} port
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<boolean>} true if any probe succeeded before the deadline
 */
async function waitForServerHealthy(port, timeoutMs = 5000) {
    const http = require('http');
    const probe = (path) => new Promise(resolve => {
        let settled = false;
        const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
        try {
            const req = http.get({ host: '127.0.0.1', port, path, timeout: 500 }, (res) => {
                res.resume();
                done(res.statusCode >= 200 && res.statusCode < 500);
            });
            req.on('error', () => done(false));
            req.on('timeout', () => { try { req.destroy(); } catch (_) {} done(false); });
        } catch (_) {
            done(false);
        }
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probe('/api/supervisor/status')) return true;
        if (await probe('/')) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

module.exports = {
    buildDashboardServerOptions,
    resolveDashboardPort,
    reconcileProxyRoutesSafely,
    stopDashboardProcess,
    launchDashboardServer,
    killPortHolder,
    waitForServerHealthy,
};
