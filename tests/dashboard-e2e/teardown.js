// @ts-check
'use strict';

/**
 * Playwright globalTeardown for dashboard e2e tests.
 * Kills the dashboard server and cleans up temp dirs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CTX_FILE = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');

module.exports = async function globalTeardown() {
    let ctx;
    try {
        ctx = JSON.parse(fs.readFileSync(CTX_FILE, 'utf8'));
    } catch (_) {
        return; // Nothing to clean up
    }

    if (ctx.dashPid) {
        try { process.kill(ctx.dashPid, 'SIGTERM'); } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
        try { process.kill(ctx.dashPid, 'SIGKILL'); } catch (_) {}
    }

    // Kill any background tmux sessions created by AIGON_TEST_MODE during the run.
    // Sessions are named `<repoName>-f<id>-<role>-<agent>-<desc>`, where repoName
    // is the basename of the fixture tmpDir (e.g. `aigon-e2e-dashboard-XXXXXX`).
    try {
        const repoName = path.basename(ctx.tmpDir);
        const sessions = execSync('tmux ls 2>/dev/null || true', { encoding: 'utf8' })
            .split('\n')
            .map(line => line.split(':')[0].trim())
            .filter(name => name.startsWith(repoName + '-'));
        for (const name of sessions) {
            try { execSync(`tmux kill-session -t ${JSON.stringify(name)}`, { stdio: 'ignore' }); } catch (_) {}
        }
    } catch (_) { /* no tmux, nothing to clean */ }

    try { fs.rmSync(ctx.tmpDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(ctx.worktreeBase, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(ctx.tempHome, { recursive: true, force: true }); } catch (_) {}
    try { fs.unlinkSync(CTX_FILE); } catch (_) {}
};
