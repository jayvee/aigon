'use strict';

/**
 * Paths that are noisy in feature-close logs but never meaningful merge/stash
 * blockers — Aigon session sidecars, telemetry, macOS junk, etc.
 */

function isEphemeralWorkingTreePath(relPath) {
    const p = String(relPath || '').replace(/\\/g, '/').trim();
    if (!p) return false;
    if (p === '.DS_Store' || p.endsWith('/.DS_Store')) return true;
    if (p.startsWith('.aigon/sessions/')) return true;
    if (p.startsWith('.aigon/telemetry/')) return true;
    if (p.startsWith('.aigon/state/')) return true;
    if (p === '.aigon/sessions/events.jsonl') return true;
    return false;
}

function filterEphemeralWorkingTreePaths(paths) {
    return (paths || []).filter((p) => !isEphemeralWorkingTreePath(p));
}

module.exports = {
    isEphemeralWorkingTreePath,
    filterEphemeralWorkingTreePaths,
};
