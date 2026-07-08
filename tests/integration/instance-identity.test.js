#!/usr/bin/env node
'use strict';

// REGRESSION F600: per-machine dashboard instance isolation — identity resolver,
// registry slots, and mixed-invocation guard.

const assert = require('assert');

const os = require('os');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

const ROOT = path.join(__dirname, '..', '..');
const _CLI_PATH = path.join(ROOT, 'aigon-cli.js');

function withIdentityEnv(overrides, fn) {
    const saved = {};
    for (const [key, val] of Object.entries(overrides)) {
        saved[key] = process.env[key];
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
    }
    const modulePath = require.resolve('../../lib/instance-identity');
    delete require.cache[modulePath];
    delete require.cache[require.resolve('../../lib/config')];
    try {
        return fn(require('../../lib/instance-identity'));
    } finally {
        delete require.cache[modulePath];
        delete require.cache[require.resolve('../../lib/config')];
        for (const [key, val] of Object.entries(saved)) {
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    }
}

test('resolveInstanceIdentity: worktree code root is non-primary with distinct port and caddy host', () => {
    const codeRoot = path.join(os.homedir(), '.aigon', 'worktrees', 'aigon', 'feature-600-cu-test');
    withIdentityEnv({}, (ii) => {
        const id = ii.resolveInstanceIdentity({ codeRoot, cwd: codeRoot });
        assert.strictEqual(id.isPrimary, false);
        assert.strictEqual(id.isWorktreeCode, true);
        assert.ok(id.port >= 4101 && id.port <= 4199);
        assert.ok(id.caddyHost.endsWith('.aigon.localhost'), id.caddyHost);
        assert.notStrictEqual(id.caddyHost, 'aigon.localhost');
        assert.strictEqual(id.caddyServerId, id.instanceId);
    });
});

test('resolveInstanceIdentity: mixed invocation fails closed without --primary', () => {
    const ii = require('../../lib/instance-identity');
    const mainCheckout = ii.resolveRegisteredMainCheckout();
    if (!mainCheckout || ii.isWorktreePath(mainCheckout)) return;
    const worktreeCwd = path.join(os.homedir(), '.aigon', 'worktrees', 'aigon', 'feature-1-cu-mixed');
    const id = ii.resolveInstanceIdentity({ codeRoot: mainCheckout, cwd: worktreeCwd });
    assert.strictEqual(id.primaryEligible, true);
    assert.strictEqual(id.isMixedInvocation, true);
    assert.strictEqual(id.isPrimary, false);
    const forced = ii.resolveInstanceIdentity({ codeRoot: mainCheckout, cwd: worktreeCwd, forcePrimary: true });
    assert.strictEqual(forced.isPrimary, true);
    assert.strictEqual(forced.isMixedInvocation, false);
});

test('getDashboardRuntimePath: non-primary instances use per-instance registry files', () => withTempDir('aigon-f600-runtime-', (home) => {
    const prev = process.env.AIGON_HOME;
    process.env.AIGON_HOME = home;
    try {
        const { getDashboardRuntimePath } = require('../../lib/global-config-migration');
        assert.strictEqual(
            getDashboardRuntimePath('main'),
            path.join(home, '.aigon', 'dashboard-runtime.json'),
        );
        assert.strictEqual(
            getDashboardRuntimePath('cu-600'),
            path.join(home, '.aigon', 'dashboard-runtime-cu-600.json'),
        );
    } finally {
        if (prev === undefined) delete process.env.AIGON_HOME;
        else process.env.AIGON_HOME = prev;
    }
}));

test('getAigonServerCaddyHost returns instance-qualified hostname for worktree code', () => {
    withIdentityEnv({}, () => {
        delete require.cache[require.resolve('../../lib/proxy')];
        delete require.cache[require.resolve('../../lib/instance-identity')];
        const proxy = require('../../lib/proxy');
        const ii = require('../../lib/instance-identity');
        if (!ii.isWorktreePath(ii.resolveAigonCodeRoot())) return;
        const expected = ii.resolveInstanceIdentity().caddyHost;
        assert.notStrictEqual(expected, 'aigon.localhost');
        assert.strictEqual(proxy.getAigonServerCaddyHost(), expected);
    });
});

report();
