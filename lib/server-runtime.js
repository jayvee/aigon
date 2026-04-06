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
        DASHBOARD_DEFAULT_PORT,
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
        return DASHBOARD_DEFAULT_PORT;
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
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    try { process.kill(n, 0); } catch (_) { break; } // gone
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

module.exports = {
    buildDashboardServerOptions,
    resolveDashboardPort,
    reconcileProxyRoutesSafely,
    stopDashboardProcess,
    launchDashboardServer,
};
