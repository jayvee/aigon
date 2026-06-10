#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { test, testAsync, report } = require('../_helpers');

function tmuxAvailable() {
    const r = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

function tmux(args, opts = {}) {
    return spawnSync('tmux', args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

if (!tmuxAvailable()) {
    test('tmux socket isolation (skipped: tmux unavailable)', () => assert.ok(true));
    report();
} else {
    const sentinel = `aigon-e2e-default-sentinel-${Date.now()}`;
    const tmuxTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-e2e-tmux-'));
    const ctxFile = path.join(os.tmpdir(), 'aigon-dashboard-e2e-ctx.json');
    const teardown = require('../dashboard-e2e/teardown');
    const isoEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir };
    delete isoEnv.TMUX;
    const previousTmux = process.env.TMUX;
    const previousTmuxTmpDir = process.env.TMUX_TMPDIR;

    (async () => {
        const created = tmux(['new-session', '-d', '-s', sentinel, 'sleep 120']);
        assert.strictEqual(created.status, 0, `default sentinel create failed: ${created.stderr}`);
        const inheritedTmux = execSync('tmux display-message -p "#{socket_path},#{pid},0"', { encoding: 'utf8' }).trim();

        const isoCreated = tmux(['new-session', '-d', '-s', 'isolated-sentinel', 'sleep 120'], { env: isoEnv });
        assert.strictEqual(isoCreated.status, 0, `isolated sentinel create failed: ${isoCreated.stderr}`);

        testAsync('dashboard e2e teardown ignores inherited default TMUX socket', async () => {
            fs.writeFileSync(ctxFile, JSON.stringify({
                tmuxTmpDir,
                tmpDir: path.join(tmuxTmpDir, 'missing-tmp'),
                worktreeBase: path.join(tmuxTmpDir, 'missing-worktrees'),
                tempHome: path.join(tmuxTmpDir, 'missing-home'),
            }));
            process.env.TMUX = inheritedTmux;
            process.env.TMUX_TMPDIR = tmuxTmpDir;

            await teardown();

            const stillThere = tmux(['has-session', '-t', sentinel]);
            assert.strictEqual(stillThere.status, 0, 'default tmux server/session was killed');

            const isolatedGone = tmux(['has-session', '-t', 'isolated-sentinel'], { env: isoEnv });
            assert.notStrictEqual(isolatedGone.status, 0, 'isolated tmux server/session was not cleaned up');
        });

        await report();
    })().finally(() => {
        tmux(['kill-session', '-t', sentinel]);
        if (previousTmux === undefined) delete process.env.TMUX;
        else process.env.TMUX = previousTmux;
        if (previousTmuxTmpDir === undefined) delete process.env.TMUX_TMPDIR;
        else process.env.TMUX_TMPDIR = previousTmuxTmpDir;
        try { fs.unlinkSync(ctxFile); } catch (_) {}
        fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
    }).catch((err) => {
        console.error(err.stack || err.message);
        process.exit(1);
    });
}
