#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { test, report } = require('../_helpers');

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
    const isoEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir, HOME: tmuxTmpDir };
    delete isoEnv.TMUX;

    try {
        const created = tmux(['new-session', '-d', '-s', sentinel, 'sleep 120']);
        assert.strictEqual(created.status, 0, `default sentinel create failed: ${created.stderr}`);
        const inheritedTmux = execSync('tmux display-message -p "#{socket_path},#{pid},0"', { encoding: 'utf8' }).trim();

        const isoCreated = tmux(['new-session', '-d', '-s', 'isolated-sentinel', 'sleep 120'], { env: isoEnv });
        assert.strictEqual(isoCreated.status, 0, `isolated sentinel create failed: ${isoCreated.stderr}`);

        test('isolated tmux kill-server ignores inherited default TMUX socket', () => {
            const teardownEnv = { ...process.env, TMUX: inheritedTmux, TMUX_TMPDIR: tmuxTmpDir };
            delete teardownEnv.TMUX;
            const killed = tmux(['kill-server'], { env: teardownEnv });
            assert.strictEqual(killed.status, 0, `isolated kill-server failed: ${killed.stderr}`);

            const stillThere = tmux(['has-session', '-t', sentinel]);
            assert.strictEqual(stillThere.status, 0, 'default tmux server/session was killed');
        });
    } finally {
        tmux(['kill-session', '-t', sentinel]);
        fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
    }

    report();
}
