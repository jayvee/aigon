'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DRIFT_SEP = '─'.repeat(49);
const DASHBOARD_RUNTIME_FILE = path.join(os.homedir(), '.aigon', 'dashboard-runtime.json');

/**
 * Compute the full version status across all three drift layers.
 * All reads are synchronous; network calls are skipped (cached-only).
 * @param {string} [repoPath] - Repo root (defaults to cwd)
 * @returns {{ appliedVersion, appliedDigest, installedCli, installedDigest,
 *             dashboardProcess, npmLatest, contentDelta, isWorktree }}
 */
function getRepoVersionStatus(repoPath) {
    repoPath = repoPath || process.cwd();

    const { getAigonVersion, getInstalledVersion } = require('./version');
    const { readAppliedDigest, computeAppliedDigestDetailed, buildDriftSummary } = require('./profile-placeholders');
    const { getCachedUpdateCheck } = require('./npm-update-check');

    const installedCli = process.env.AIGON_TEST_INSTALLED_VERSION || getAigonVersion();

    // Skip repo-level drift checks inside worktrees — no applied-digest is written there.
    const isWorktree = fs.existsSync(path.join(repoPath, '.aigon', 'worktree.json'));

    let appliedVersion = null;
    let appliedDigest = null;
    let installedDigest = null;
    let contentDelta = null;

    if (!isWorktree) {
        appliedVersion = getInstalledVersion();
        try {
            appliedDigest = readAppliedDigest(repoPath);
            installedDigest = computeAppliedDigestDetailed(repoPath);
            if (appliedDigest && installedDigest) {
                contentDelta = buildDriftSummary(appliedDigest, installedDigest);
            }
        } catch (_) {}
    }

    // Layer 3: dashboard runtime version (global, any worktree can read this).
    let dashboardProcess = null;
    try {
        if (fs.existsSync(DASHBOARD_RUNTIME_FILE)) {
            const rt = JSON.parse(fs.readFileSync(DASHBOARD_RUNTIME_FILE, 'utf8'));
            if (rt.pid) {
                try {
                    process.kill(rt.pid, 0); // check pid alive (throws if not)
                    dashboardProcess = rt.version || null;
                } catch (_) { /* stale pid — treat as not running */ }
            } else {
                dashboardProcess = rt.version || null;
            }
        }
    } catch (_) {}

    // Layer 2: npm update (cached only — no network call at session start).
    let npmLatest = null;
    try {
        const result = getCachedUpdateCheck();
        if (result && result.state === 'update-available') {
            npmLatest = result.latestStable || result.latestNext;
        } else if (result && result.state === 'prerelease-available') {
            npmLatest = result.latestNext || result.latestStable;
        }
    } catch (_) {}

    return {
        appliedVersion,
        appliedDigest,
        installedCli,
        installedDigest,
        dashboardProcess,
        npmLatest,
        contentDelta,
        isWorktree,
    };
}

/**
 * Format the drift notice block. Returns empty string when everything is current.
 * @param {object} status - Result from getRepoVersionStatus()
 * @returns {string}
 */
function formatDriftNotice(status) {
    const {
        appliedVersion,
        appliedDigest,
        installedCli,
        installedDigest,
        dashboardProcess,
        npmLatest,
        isWorktree,
    } = status;

    const lines = [];

    // Layer 1: repo-to-CLI drift (skip in worktrees — no digest written there).
    if (!isWorktree && installedCli && appliedVersion !== null) {
        const digestMismatch = appliedDigest && installedDigest &&
            appliedDigest.digest !== installedDigest.digest;
        const versionMismatch = appliedVersion !== installedCli;
        const noDigest = !appliedDigest;

        if (digestMismatch || versionMismatch || noDigest) {
            const applied = `v${appliedVersion}`;
            lines.push(`ℹ  aigon: this repo applied ${applied}, installed v${installedCli}.`);
            lines.push(`   Re-apply with:  aigon apply`);
            lines.push('');
        }
    }

    // Layer 2: CLI-to-npm drift.
    if (npmLatest && installedCli) {
        lines.push(`ℹ  aigon CLI v${npmLatest} available on npm (you have v${installedCli}).`);
        lines.push(`   Upgrade with:   npm update -g @senlabsai/aigon`);
        lines.push('');
    }

    // Layer 3: dashboard drift.
    if (dashboardProcess && installedCli && dashboardProcess !== installedCli) {
        lines.push(`ℹ  Dashboard server still running v${dashboardProcess} code (CLI is v${installedCli}).`);
        lines.push(`   Restart with:   aigon server restart`);
        lines.push('');
    }

    if (lines.length === 0) return '';

    while (lines[lines.length - 1] === '') lines.pop();

    return `${DRIFT_SEP}\n${lines.join('\n')}\n${DRIFT_SEP}\n`;
}

// True when the running CLI is a local source checkout of aigon itself —
// i.e. the maintainer running from `~/src/aigon`, not a normal user who
// installed via `npm i -g`. Used to swap the dashboard pill into "dev mode"
// where templates can change between version bumps so version-only staleness
// is the wrong signal. Tests override via AIGON_DEV_MODE=1|0.
function isAigonDevMode() {
    if (process.env.AIGON_DEV_MODE === '1') return true;
    if (process.env.AIGON_DEV_MODE === '0') return false;
    try {
        const { ROOT_DIR } = require('./config');
        if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) return false;
        const pkgPath = path.join(ROOT_DIR, 'package.json');
        if (!fs.existsSync(pkgPath)) return false;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.name === '@senlabsai/aigon';
    } catch (_) {
        return false;
    }
}

module.exports = { getRepoVersionStatus, formatDriftNotice, isAigonDevMode, DASHBOARD_RUNTIME_FILE };
