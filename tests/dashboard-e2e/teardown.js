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
const { PORT_FILE } = require('./fixture-port');

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

    if (ctx.tmuxTmpDir) {
        try {
            const tmuxEnv = { ...process.env, TMUX_TMPDIR: ctx.tmuxTmpDir };
            // If tests run inside an Aigon tmux pane, inherited TMUX points at
            // the real/default server and overrides TMUX_TMPDIR. Never keep it.
            delete tmuxEnv.TMUX;
            execSync('tmux kill-server 2>/dev/null || true', {
                stdio: 'ignore',
                env: tmuxEnv,
            });
        } catch (_) { /* isolated server already gone */ }
    }

    try { fs.rmSync(ctx.tmpDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(ctx.worktreeBase, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(ctx.tempHome, { recursive: true, force: true }); } catch (_) {}
    try { fs.unlinkSync(CTX_FILE); } catch (_) {}
    try { fs.unlinkSync(PORT_FILE); } catch (_) {}
};
