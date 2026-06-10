#!/usr/bin/env node
'use strict';

// F544: proves the e2e-harness isolation mechanism — a tmux server scoped to a
// dedicated TMUX_TMPDIR must never appear on, or mutate the global env of, the
// developer's default tmux server. This is the regression guard for the
// 2026-06-10 incident where an e2e run bootstrapped the default server with a
// fake HOME and broke every subsequent real agent session.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, report } = require('../_helpers');

function tmuxAvailable() {
    const r = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

// Unique marker so we never collide with (or assert against) a real session.
const SESSION = 'aigon-f544-isolation-probe';

if (!tmuxAvailable()) {
    test('tmux socket isolation (skipped — tmux not installed)', () => {
        assert.ok(true);
    });
    report();
} else {
    const tmuxTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-f544-tmux-'));
    const isoEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir, HOME: tmuxTmpDir };
    const iso = (args, opts = {}) => spawnSync('tmux', args, { encoding: 'utf8', ...opts, env: isoEnv });
    const def = (args, opts = {}) => spawnSync('tmux', args, { encoding: 'utf8', ...opts });

    try {
        // Create a session on the ISOLATED server (this bootstraps it under TMUX_TMPDIR).
        const created = iso(['new-session', '-d', '-s', SESSION, 'tail -f /dev/null']);
        assert.strictEqual(created.status, 0, `isolated new-session failed: ${created.stderr}`);

        test('session is visible on the isolated (TMUX_TMPDIR) server', () => {
            const ls = iso(['list-sessions', '-F', '#S']);
            assert.ok(
                String(ls.stdout || '').split('\n').includes(SESSION),
                `expected ${SESSION} on isolated server, got: ${ls.stdout}`
            );
        });

        test('isolated session does NOT leak onto the default tmux server', () => {
            // Query the default server WITHOUT TMUX_TMPDIR. If it is not running,
            // tmux exits non-zero ("no server running") — which is itself proof of
            // isolation. If it IS running (dev machine), our probe must be absent.
            const ls = def(['list-sessions', '-F', '#S']);
            const names = ls.status === 0 ? String(ls.stdout || '').split('\n') : [];
            assert.ok(!names.includes(SESSION), 'isolated session leaked onto the default server');
        });

        test('isolated server holds its own global env, not the default server\'s', () => {
            // Stamp a sentinel into the isolated server's global env, then confirm
            // the default server never sees it (mirrors how a leaked fake HOME
            // would otherwise have poisoned the shared global env).
            iso(['set-environment', '-g', 'AIGON_F544_SENTINEL', 'isolated']);
            const isoEnvOut = iso(['show-environment', '-g', 'AIGON_F544_SENTINEL']);
            assert.match(String(isoEnvOut.stdout || ''), /AIGON_F544_SENTINEL=isolated/);

            const defEnvOut = def(['show-environment', '-g', 'AIGON_F544_SENTINEL']);
            const defSawSentinel = defEnvOut.status === 0
                && /AIGON_F544_SENTINEL=isolated/.test(String(defEnvOut.stdout || ''));
            assert.ok(!defSawSentinel, 'sentinel leaked into the default server global env');
        });
    } finally {
        // Reap ONLY the isolated server; never the developer's default server.
        spawnSync('tmux', ['kill-server'], { stdio: 'ignore', env: isoEnv });
        fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
    }

    report();
}
