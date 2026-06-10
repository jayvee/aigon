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

    // F544: the whole run used an isolated tmux server under ctx.tmuxTmpDir, so a
    // single kill-server scoped to that socket reaps every background session the
    // run created — and, crucially, never touches the developer's default server.
    if (ctx.tmuxTmpDir) {
        try {
            execSync('tmux kill-server 2>/dev/null || true', {
                stdio: 'ignore',
                env: { ...process.env, TMUX_TMPDIR: ctx.tmuxTmpDir },
            });
        } catch (_) { /* isolated server already gone */ }
    }

    try { fs.rmSync(ctx.tmpDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(ctx.worktreeBase, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(ctx.tempHome, { recursive: true, force: true }); } catch (_) {}
    try { fs.unlinkSync(CTX_FILE); } catch (_) {}
};
