'use strict';

const fs = require('fs');
const {
    restartMarkerPath,
    peekRestartMarker,
    consumeRestartMarker,
    isRestartMarkerStale,
    normalizeMarkerRepoPath,
    RESTART_MARKER_TTL_MS,
} = require('./feature-close');
const { scheduleDashboardSelfRestart } = require('./dashboard-self-restart');

/**
 * feature 652: poll-loop consumer for `.aigon/server/restart-needed.json` so
 * restarts are not lost when /api/action skips marker consumption.
 */
function createRestartBackstop(deps) {
    const {
        getRegisteredRepos,
        getServerCwd,
        hasInflightActions,
        broadcastServerRestarting,
        log,
        warn,
        cliEntryPath,
    } = deps;
    let restartScheduled = false;

    function collectRepoPaths() {
        const seen = new Set();
        const out = [];
        const add = (raw) => {
            if (!raw) return;
            const norm = normalizeMarkerRepoPath(raw);
            if (seen.has(norm)) return;
            seen.add(norm);
            out.push(norm);
        };
        add(getServerCwd());
        for (const repo of (typeof getRegisteredRepos === 'function' ? getRegisteredRepos() : [])) {
            add(typeof repo === 'string' ? repo : repo && repo.path);
        }
        return out;
    }

    function tick() {
        if (restartScheduled) return;
        if (typeof hasInflightActions === 'function' && hasInflightActions()) return;

        for (const repoPath of collectRepoPaths()) {
            const markerFile = restartMarkerPath(repoPath);
            if (!fs.existsSync(markerFile)) continue;

            const peeked = peekRestartMarker(repoPath);
            if (!peeked) {
                consumeRestartMarker(repoPath);
                if (typeof warn === 'function') {
                    warn(`⚠️  Cleared unreadable restart marker at ${markerFile}`);
                }
                continue;
            }

            if (isRestartMarkerStale(peeked) && typeof warn === 'function') {
                warn(
                    `⚠️  Restart marker at ${markerFile} is older than ${Math.round(RESTART_MARKER_TTL_MS / 1000)}s — backstop will restart now`
                );
            }

            const marker = consumeRestartMarker(repoPath);
            if (!marker) continue;

            restartScheduled = true;
            const fileCount = Array.isArray(marker.files) ? marker.files.length : 0;
            if (typeof log === 'function') {
                log(`🔄 Backstop: consumed restart marker (${fileCount} lib file(s), reason=${marker.reason || 'unknown'})`);
            }
            scheduleDashboardSelfRestart({
                broadcast: broadcastServerRestarting,
                log,
                warn,
                cliEntryPath,
            });
            return;
        }
    }

    return { tick };
}

module.exports = {
    createRestartBackstop,
};
