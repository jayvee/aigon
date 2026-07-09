#!/usr/bin/env node
'use strict';

// REGRESSION F234: dashboard-invoked feature-close defers restart (writes marker, not call).
// F428: runDashboardInteractiveAction is async (spawn, not spawnSync).
// F652: marker path normalization, stderr-422 consumption, poll backstop.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const { test, testAsync, report } = require('../_helpers');
const {
    restartServerIfLibChanged,
    writeRestartMarkerFile,
    consumeRestartMarkerFromCandidates,
    peekRestartMarker,
    isRestartMarkerStale,
    RESTART_MARKER_TTL_MS,
} = require('../../lib/feature-close');
const { createRestartBackstop } = require('../../lib/dashboard-restart-backstop');

function makeDeps(diff, opts = {}) {
    const calls = { n: 0, marker: null };
    return {
        calls,
        deps: {
            getChangedLibFiles: () => String(diff || '').trim().split('\n').filter(Boolean),
            getServerRegistryEntry: () => opts.noServer ? null : { pid: 1 },
            isProcessAlive: () => true,
            loadProjectConfig: () => opts.cfg || {},
            restartServer: () => { calls.n++; },
            writeRestartMarker: (m) => { calls.marker = m; },
            log: () => {}, warn: () => {},
        },
    };
}

function run(diff, opts) {
    const { calls, deps } = makeDeps(diff, opts);
    restartServerIfLibChanged({ preMergeBaseRef: 'main' }, deps);
    return calls;
}

const prevEnv = process.env.AIGON_INVOKED_BY_DASHBOARD;

test('CLI context: restart triggered only when lib/ changed, server alive, opt-in', () => {
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    assert.strictEqual(run('lib/x.js\n').n, 1, 'lib change → restart');
    assert.strictEqual(run('').n, 0, 'empty diff → no restart');
    assert.strictEqual(run('lib/x.js\n', { noServer: true }).n, 0, 'no server → no restart');
    assert.strictEqual(run('lib/x.js\n', { cfg: { featureClose: { autoRestartServer: false } } }).n, 0, 'opt-out');
});

test('dashboard-invoked (F234): never calls restartServer, records marker with files', () => {
    process.env.AIGON_INVOKED_BY_DASHBOARD = '1';
    try {
        const calls = run('lib/x.js\nlib/y.js\n');
        assert.strictEqual(calls.n, 0);
        assert.ok(calls.marker && calls.marker.reason === 'lib-changed' && calls.marker.files.length === 2);
    } finally {
        if (prevEnv === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD;
        else process.env.AIGON_INVOKED_BY_DASHBOARD = prevEnv;
    }
});

test('REGRESSION F652: marker round-trip via alternate resolved repo path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-marker-'));
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.aigon', 'server'), { recursive: true });
    const marker = { reason: 'lib-changed', files: ['lib/x.js'], at: new Date().toISOString() };
    writeRestartMarkerFile(repo, marker);
    const real = fs.realpathSync.native(repo);
    const consumed = consumeRestartMarkerFromCandidates([path.join(tmp, 'repo'), real]);
    assert.ok(consumed && consumed.marker && consumed.marker.reason === 'lib-changed');
    assert.strictEqual(peekRestartMarker(real), null, 'marker consumed');
});

test('REGRESSION F652: diff failure and missing server log actionable warnings', () => {
    const warnings = [];
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    restartServerIfLibChanged({ preMergeBaseRef: 'main' }, {
        getChangedLibFiles: () => { throw new Error('git diff failed'); },
        getServerRegistryEntry: () => ({ pid: 1 }),
        isProcessAlive: () => true,
        loadProjectConfig: () => ({}),
        restartServer: () => {},
        writeRestartMarker: () => {},
        log: () => {},
        warn: (m) => warnings.push(m),
    });
    assert.ok(warnings.some((w) => /diff/i.test(w) && /manually/i.test(w)));

    warnings.length = 0;
    restartServerIfLibChanged({ preMergeBaseRef: 'main' }, {
        getChangedLibFiles: () => ['lib/a.js'],
        getServerRegistryEntry: () => null,
        isProcessAlive: () => true,
        loadProjectConfig: () => ({}),
        restartServer: () => {},
        writeRestartMarker: () => {},
        log: () => {},
        warn: (m) => warnings.push(m),
    });
    assert.ok(warnings.some((w) => /no live aigon server/i.test(w)));
});

test('REGRESSION F652: stale restart marker detected by TTL helper', () => {
    const fresh = { at: new Date().toISOString() };
    const stale = { at: new Date(Date.now() - RESTART_MARKER_TTL_MS - 1000).toISOString() };
    assert.strictEqual(isRestartMarkerStale(fresh), false);
    assert.strictEqual(isRestartMarkerStale(stale), true);
});

test('REGRESSION F652: poll backstop consumes marker without /api/action', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-backstop-'));
    writeRestartMarkerFile(tmp, { reason: 'lib-changed', files: ['lib/y.js'], at: new Date().toISOString() });
    let broadcasted = false;
    let restarted = false;
    const backstop = createRestartBackstop({
        getRegisteredRepos: () => [tmp],
        getServerCwd: () => tmp,
        hasInflightActions: () => false,
        broadcastServerRestarting: () => { broadcasted = true; },
        log: () => {},
        warn: () => {},
        cliEntryPath: '/fake/aigon-cli.js',
        scheduleSelfRestart: (options) => {
            if (options && typeof options.broadcast === 'function') options.broadcast();
            restarted = true;
        },
    });
    backstop.tick();
    assert.ok(broadcasted, 'SSE broadcast before restart');
    assert.ok(restarted, 'self-restart scheduled');
    assert.strictEqual(peekRestartMarker(tmp), null, 'marker consumed');
});

testAsync('runDashboardInteractiveAction (F428): async spawn injects restart-deferral env', async () => {
    const dashboardServerPath = require.resolve('../../lib/dashboard-server');
    const origSpawn = childProcess.spawn;
    let seen = null;

    delete require.cache[dashboardServerPath];
    childProcess.spawn = (cmd, args, opts) => {
        seen = { cmd, args, opts };
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
        child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
        setImmediate(() => child.emit('close', 0));
        return child;
    };

    const prevDash = process.env.AIGON_INVOKED_BY_DASHBOARD;
    process.env.AIGON_INVOKED_BY_DASHBOARD = '1';

    try {
        const dashboardServer = require('../../lib/dashboard-server');
        const result = await dashboardServer.runDashboardInteractiveAction({
            action: 'feature-close', args: ['234'],
            repoPath: process.cwd(), registeredRepos: [], defaultRepoPath: process.cwd(),
        });
        assert.ok(result.ok);
        assert.strictEqual(seen.opts.env.AIGON_INVOKED_BY_DASHBOARD, '1');
    } finally {
        childProcess.spawn = origSpawn;
        delete require.cache[dashboardServerPath];
        if (prevDash === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD;
        else process.env.AIGON_INVOKED_BY_DASHBOARD = prevDash;
    }
});

report();
