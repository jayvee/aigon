#!/usr/bin/env node
'use strict';

// F535: dev-mode detection + split staleness helpers.
// User mode = npm-installed aigon → only version mismatch is stale.
// Dev mode  = local checkout → digest mismatch is the real signal.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, withRepoCwd, report } = require('../_helpers');

function freshVersionStatus() {
    const key = require.resolve('../../lib/version-status');
    delete require.cache[key];
    return require('../../lib/version-status');
}

// ── isAigonDevMode ────────────────────────────────────────────────────────────

test('isAigonDevMode: AIGON_DEV_MODE=1 forces dev mode', () => {
    const prev = process.env.AIGON_DEV_MODE;
    process.env.AIGON_DEV_MODE = '1';
    try {
        const { isAigonDevMode } = freshVersionStatus();
        assert.strictEqual(isAigonDevMode(), true);
    } finally {
        if (prev === undefined) delete process.env.AIGON_DEV_MODE;
        else process.env.AIGON_DEV_MODE = prev;
    }
});

test('isAigonDevMode: AIGON_DEV_MODE=0 forces user mode', () => {
    const prev = process.env.AIGON_DEV_MODE;
    process.env.AIGON_DEV_MODE = '0';
    try {
        const { isAigonDevMode } = freshVersionStatus();
        assert.strictEqual(isAigonDevMode(), false);
    } finally {
        if (prev === undefined) delete process.env.AIGON_DEV_MODE;
        else process.env.AIGON_DEV_MODE = prev;
    }
});

test('isAigonDevMode: no env override → detects local aigon checkout (true in this repo)', () => {
    const prev = process.env.AIGON_DEV_MODE;
    delete process.env.AIGON_DEV_MODE;
    try {
        const { isAigonDevMode } = freshVersionStatus();
        // Tests run from the aigon source tree, so detection should fire.
        assert.strictEqual(isAigonDevMode(), true);
    } finally {
        if (prev !== undefined) process.env.AIGON_DEV_MODE = prev;
    }
});

// ── split staleness helpers ───────────────────────────────────────────────────

function loadStaleHelpers() {
    const key = require.resolve('../../lib/dashboard-routes/version-status');
    delete require.cache[key];
    return require('../../lib/dashboard-routes/version-status');
}

test('dashboard-routes/version-status: exports routes array (smoke)', () => {
    const mod = loadStaleHelpers();
    assert.ok(Array.isArray(mod));
    assert.ok(mod.some(r => r.path === '/api/version-status'));
});

// Direct helper coverage via re-require of the source file — the helpers are
// module-private but stable. We expose them through a small probe that calls
// the route handler with crafted status, and assert via ctx.sendJson capture.

function captureRouteResponse(routeHandler, ctxExtras) {
    let captured = null;
    const ctx = {
        sendJson: (status, body) => { captured = { status, body }; },
        routes: { readConductorReposFromGlobalConfig: () => [] },
        helpers: { log: () => {} },
        ...ctxExtras,
    };
    routeHandler({ url: '/api/version-status' }, {}, ctx);
    return captured;
}

function writeRepoState(repo, { version, digest = 'current' } = {}) {
    const aigonDir = path.join(repo, '.aigon');
    fs.mkdirSync(aigonDir, { recursive: true });
    if (version !== undefined) {
        fs.writeFileSync(path.join(aigonDir, 'version'), version);
    }
    if (digest) {
        const { computeAppliedDigestDetailed } = require('../../lib/profile-placeholders');
        const current = computeAppliedDigestDetailed(repo);
        const stored = digest === 'current'
            ? current
            : { ...current, digest: `mismatch-${current.digest}` };
        fs.writeFileSync(path.join(aigonDir, 'applied-digest'), JSON.stringify({
            v: 1,
            digest: stored.digest,
            cats: stored.cats,
            files: stored.files,
        }));
    }
}

test('/api/version-status: emits devMode flag', () => {
    const prev = process.env.AIGON_DEV_MODE;
    process.env.AIGON_DEV_MODE = '1';
    try {
        const mod = loadStaleHelpers();
        const route = mod.find(r => r.path === '/api/version-status');
        const res = captureRouteResponse(route.handler);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.devMode, true);
    } finally {
        if (prev === undefined) delete process.env.AIGON_DEV_MODE;
        else process.env.AIGON_DEV_MODE = prev;
    }
});

test('/api/version-status: devMode=false when forced via env', () => {
    const prev = process.env.AIGON_DEV_MODE;
    process.env.AIGON_DEV_MODE = '0';
    try {
        const mod = loadStaleHelpers();
        const route = mod.find(r => r.path === '/api/version-status');
        const res = captureRouteResponse(route.handler);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.devMode, false);
    } finally {
        if (prev === undefined) delete process.env.AIGON_DEV_MODE;
        else process.env.AIGON_DEV_MODE = prev;
    }
});

test('/api/version-status: user mode ignores digest-only drift for registered repos and reads each repo version', () => {
    withTempDir('aigon-version-status-', root => {
        const currentRepo = path.join(root, 'current');
        const registeredRepo = path.join(root, 'registered');
        fs.mkdirSync(currentRepo, { recursive: true });
        fs.mkdirSync(registeredRepo, { recursive: true });

        writeRepoState(currentRepo, { version: '9.9.9', digest: 'current' });
        writeRepoState(registeredRepo, { version: '1.2.3', digest: 'mismatch' });

        const prevDev = process.env.AIGON_DEV_MODE;
        const prevInstalled = process.env.AIGON_TEST_INSTALLED_VERSION;
        process.env.AIGON_DEV_MODE = '0';
        process.env.AIGON_TEST_INSTALLED_VERSION = '1.2.3';
        try {
            withRepoCwd(currentRepo, () => {
                const mod = loadStaleHelpers();
                const route = mod.find(r => r.path === '/api/version-status');
                const res = captureRouteResponse(route.handler, {
                    routes: { readConductorReposFromGlobalConfig: () => [registeredRepo] },
                });
                assert.strictEqual(res.status, 200);
                assert.strictEqual(res.body.devMode, false);
                assert.strictEqual(res.body.current.appliedVersion, '9.9.9');
                assert.strictEqual(res.body.current.stale, true);
                assert.strictEqual(res.body.repos[0].appliedVersion, '1.2.3');
                assert.strictEqual(res.body.repos[0].stale, false);
            });
        } finally {
            if (prevDev === undefined) delete process.env.AIGON_DEV_MODE;
            else process.env.AIGON_DEV_MODE = prevDev;
            if (prevInstalled === undefined) delete process.env.AIGON_TEST_INSTALLED_VERSION;
            else process.env.AIGON_TEST_INSTALLED_VERSION = prevInstalled;
        }
    });
});

test('/api/version-status: dev mode treats digest drift as stale for registered repos', () => {
    withTempDir('aigon-version-status-', root => {
        const currentRepo = path.join(root, 'current');
        const registeredRepo = path.join(root, 'registered');
        fs.mkdirSync(currentRepo, { recursive: true });
        fs.mkdirSync(registeredRepo, { recursive: true });

        writeRepoState(currentRepo, { version: '1.2.3', digest: 'current' });
        writeRepoState(registeredRepo, { version: '1.2.3', digest: 'mismatch' });

        const prevDev = process.env.AIGON_DEV_MODE;
        const prevInstalled = process.env.AIGON_TEST_INSTALLED_VERSION;
        process.env.AIGON_DEV_MODE = '1';
        process.env.AIGON_TEST_INSTALLED_VERSION = '1.2.3';
        try {
            withRepoCwd(currentRepo, () => {
                const mod = loadStaleHelpers();
                const route = mod.find(r => r.path === '/api/version-status');
                const res = captureRouteResponse(route.handler, {
                    routes: { readConductorReposFromGlobalConfig: () => [registeredRepo] },
                });
                assert.strictEqual(res.status, 200);
                assert.strictEqual(res.body.devMode, true);
                assert.strictEqual(res.body.repos[0].appliedVersion, '1.2.3');
                assert.strictEqual(res.body.repos[0].stale, true);
            });
        } finally {
            if (prevDev === undefined) delete process.env.AIGON_DEV_MODE;
            else process.env.AIGON_DEV_MODE = prevDev;
            if (prevInstalled === undefined) delete process.env.AIGON_TEST_INSTALLED_VERSION;
            else process.env.AIGON_TEST_INSTALLED_VERSION = prevInstalled;
        }
    });
});

report();
