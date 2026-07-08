'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const { getDevProxyUrl, buildCaddyHostname, isPortInUseSync } = require('../proxy');
const probeTtlCache = require('../probe-ttl-cache');
const { PROBE_TTLS_MS } = require('./constants');

function detectGitHubRemote(repoPath) {
    try {
        const originUrl = execSync('git remote get-url origin', {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: 'pipe'
        }).trim();
        return /github\.com[:/]/i.test(originUrl);
    } catch (_) {
        return false;
    }
}

function applyPendingScheduleMetadata(entity, hit, fallbackKind = null) {
    if (!entity || !hit) return;
    entity.scheduledRunAt = hit.runAt || hit.run_at || null;
    entity.scheduledKind = hit.kind || fallbackKind;
    entity.scheduledJobId = hit.jobId || hit.id || null;
    entity.scheduledState = hit.state || hit.status || null;
    const agents = hit.agents || hit.agentIds || hit.agent_ids || null;
    if (Array.isArray(agents)) entity.scheduledAgents = agents.map(String);
    if (hit.reviewAgent || hit.reviewAgentId || hit.review_agent) {
        entity.scheduledReviewAgent = hit.reviewAgent || hit.reviewAgentId || hit.review_agent;
    }
}

function applySpecReviewFromSnapshots(_repoPath, _items) {
    // F344: no-op shim. specReview sidecar reads removed; stateRenderMeta
    // is now attached per feature row from the engine snapshot.currentSpecState.
}

function isDevServerPokeEligible(status, flags, tmuxRunning) {
    const normalized = String(status || '').toLowerCase();
    const ended = Boolean(flags && flags.sessionEnded);
    if (normalized === 'idle') return true;
    if (ended) return true;
    if (normalized === 'implementing' && !tmuxRunning) return true;
    return false;
}

function getDevServerState(caddyRoutes, repoAppId, serverId) {
    const hostname = buildCaddyHostname(repoAppId, serverId || null);
    const route = caddyRoutes.find(r => r.hostname === hostname);
    const devServerAlive = route
        ? Boolean(probeTtlCache.getOrCompute(`dev-server-port:${route.port}`, PROBE_TTLS_MS.devServer, () => isPortInUseSync(route.port)))
        : false;
    return {
        running: devServerAlive,
        url: devServerAlive ? getDevProxyUrl(repoAppId, serverId) : null
    };
}

module.exports = {
    detectGitHubRemote,
    applyPendingScheduleMetadata,
    applySpecReviewFromSnapshots,
    isDevServerPokeEligible,
    getDevServerState,
};
