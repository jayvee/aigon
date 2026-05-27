'use strict';

// Feature 499: dashboard upgrade-flow pill endpoints.
//
// - GET /api/version-status      → repo + multi-repo drift snapshot for chrome pill.
// - GET /api/apply/preview       → file-level diff of what `aigon apply` would change.
// - POST /api/server/restart     → detached `aigon server restart`, then exits self.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { getRepoVersionStatus, isAigonDevMode } = require('../version-status');
const {
    readAppliedDigest,
    computeAppliedDigestDetailed,
    DIGEST_CATEGORY_LABELS,
} = require('../profile-placeholders');

function repoLabel(repoPath) {
    if (!repoPath) return '';
    return path.basename(repoPath);
}

// User mode: only the CLI version bump matters. A normal user installs
// aigon globally via npm; templates only change when the version changes,
// so digest drift would be a false positive.
function isRepoStaleUserMode(status) {
    if (!status) return false;
    if (status.isWorktree) return false;
    if (!status.installedCli) return false;
    if (!status.appliedVersion) return true; // never applied
    return status.appliedVersion !== status.installedCli;
}

// Dev mode: templates change between version bumps (maintainer is editing
// templates/ locally), so digest drift is the real signal. Equivalent to the
// pre-split behaviour.
function isRepoStaleDevMode(status) {
    if (!status) return false;
    if (status.isWorktree) return false;
    const versionMismatch = status.appliedVersion && status.installedCli
        && status.appliedVersion !== status.installedCli;
    const digestMismatch = status.appliedDigest && status.installedDigest
        && status.appliedDigest.digest !== status.installedDigest.digest;
    return Boolean(versionMismatch || digestMismatch || !status.appliedDigest);
}

function summarizeRepoStatus(repoPath, devMode) {
    const status = getRepoVersionStatus(repoPath);
    const stale = devMode ? isRepoStaleDevMode(status) : isRepoStaleUserMode(status);
    return {
        repoPath,
        name: repoLabel(repoPath),
        appliedVersion: status.appliedVersion,
        appliedDigest: status.appliedDigest ? status.appliedDigest.digest : null,
        installedDigest: status.installedDigest ? status.installedDigest.digest : null,
        contentDelta: status.contentDelta,
        isWorktree: status.isWorktree,
        stale,
    };
}

function classifyChange(stored, current) {
    if (!stored && current) return 'create';
    if (stored && !current) return 'remove';
    return 'update';
}

function buildPreview(repoPath) {
    const stored = readAppliedDigest(repoPath);
    const current = computeAppliedDigestDetailed(repoPath);
    const storedFiles = (stored && stored.files) || {};
    const currentFiles = current.files || {};

    const allKeys = new Set([...Object.keys(storedFiles), ...Object.keys(currentFiles)]);
    const files = [];
    for (const key of allKeys) {
        const before = storedFiles[key] || null;
        const after = currentFiles[key] || null;
        if (before === after) continue;
        const category = key.split('/')[0];
        const labels = DIGEST_CATEGORY_LABELS[category];
        files.push({
            path: key,
            change: classifyChange(before, after),
            category,
            categoryLabel: labels ? labels.one : category,
        });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    const summary = {};
    for (const f of files) {
        const k = f.category;
        summary[k] = (summary[k] || 0) + 1;
    }

    return {
        repoPath,
        name: repoLabel(repoPath),
        hasStoredDigest: Boolean(stored),
        files,
        summary,
        totalChanges: files.length,
    };
}

module.exports = [
    {
        method: 'GET',
        path: '/api/version-status',
        handler(req, res, ctx) {
            try {
                const defaultRepo = process.cwd();
                const current = getRepoVersionStatus(defaultRepo);
                const devMode = isAigonDevMode();
                const registered = (typeof ctx.routes.readConductorReposFromGlobalConfig === 'function')
                    ? ctx.routes.readConductorReposFromGlobalConfig()
                    : [];
                const repos = registered.map(r => {
                    try {
                        return summarizeRepoStatus(path.resolve(r), devMode);
                    } catch (e) {
                        return { repoPath: r, name: repoLabel(r), error: e.message, stale: false };
                    }
                });
                const currentStale = devMode ? isRepoStaleDevMode(current) : isRepoStaleUserMode(current);
                ctx.sendJson(200, {
                    current: {
                        repoPath: defaultRepo,
                        name: repoLabel(defaultRepo),
                        appliedVersion: current.appliedVersion,
                        appliedDigest: current.appliedDigest ? current.appliedDigest.digest : null,
                        installedDigest: current.installedDigest ? current.installedDigest.digest : null,
                        contentDelta: current.contentDelta,
                        isWorktree: current.isWorktree,
                        stale: currentStale,
                    },
                    installedCli: current.installedCli || null,
                    dashboardProcess: current.dashboardProcess || null,
                    npmLatest: current.npmLatest || null,
                    devMode,
                    repos,
                });
            } catch (e) {
                ctx.sendJson(500, { error: e.message || 'version-status failed' });
            }
        }
    },
    {
        method: 'GET',
        path: '/api/apply/preview',
        handler(req, res, ctx) {
            try {
                const url = new URL(req.url, 'http://localhost');
                const requested = url.searchParams.get('repoPath') || process.cwd();
                const repoPath = path.resolve(requested);
                if (!fs.existsSync(repoPath)) {
                    ctx.sendJson(400, { error: 'repoPath does not exist' });
                    return;
                }
                const registered = (typeof ctx.routes.readConductorReposFromGlobalConfig === 'function')
                    ? ctx.routes.readConductorReposFromGlobalConfig().map(r => path.resolve(r))
                    : [];
                if (registered.length > 0 && !registered.includes(repoPath) && repoPath !== path.resolve(process.cwd())) {
                    ctx.sendJson(403, { error: 'repoPath is not registered with dashboard' });
                    return;
                }
                ctx.sendJson(200, buildPreview(repoPath));
            } catch (e) {
                ctx.sendJson(500, { error: e.message || 'preview failed' });
            }
        }
    },
    {
        method: 'POST',
        path: '/api/server/restart',
        handler(req, res, ctx) {
            try {
                ctx.sendJson(200, { ok: true, restarting: true });
                ctx.helpers.log('🔄 Dashboard self-restart requested via /api/server/restart');
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
            } catch (e) {
                ctx.sendJson(500, { error: e.message || 'restart failed' });
            }
        }
    },
];
