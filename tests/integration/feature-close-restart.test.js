#!/usr/bin/env node
'use strict';

// REGRESSION F234: feature-close server restart is deferred when invoked from the dashboard
// (AIGON_INVOKED_BY_DASHBOARD=1) — it records a restart marker instead of calling restartServer.
// Also tests: F428 runDashboardInteractiveAction is async (spawn, not spawnSync).

const assert = require('assert');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const { test, testAsync, report } = require('../_helpers');
const { restartServerIfLibChanged } = require('../../lib/feature-close');

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
            log: () => {},
            warn: () => {},
        },
    };
}

function run(diff, opts) {
    const { calls, deps } = makeDeps(diff, opts);
    restartServerIfLibChanged({ preMergeBaseRef: 'main' }, deps);
    return calls;
}

const prevEnv = process.env.AIGON_INVOKED_BY_DASHBOARD;

test('lib/*.js diff triggers server restart in CLI context', () => {
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    assert.strictEqual(run('lib/x.js\n').n, 1);
});

test('empty diff skips restart', () => {
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    assert.strictEqual(run('').n, 0);
});

test('missing server entry skips restart silently', () => {
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    assert.strictEqual(run('lib/x.js\n', { noServer: true }).n, 0);
});

test('opt-out config disables restart', () => {
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    assert.strictEqual(run('lib/x.js\n', { cfg: { featureClose: { autoRestartServer: false } } }).n, 0);
});

test('dashboard-invoked: never calls restartServer, records restart marker with files (F234)', () => {
    process.env.AIGON_INVOKED_BY_DASHBOARD = '1';
    try {
        const calls = run('lib/x.js\nlib/y.js\n');
        assert.strictEqual(calls.n, 0, 'dashboard-invoked must never call restartServer');
        assert.ok(calls.marker && calls.marker.reason === 'lib-changed' && calls.marker.files.length === 2, 'marker recorded with files');
    } finally {
        if (prevEnv === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD;
        else process.env.AIGON_INVOKED_BY_DASHBOARD = prevEnv;
    }
});

testAsync('runDashboardInteractiveAction: async spawn path succeeds with mocked child process (F428)', async () => {
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
            action: 'feature-close',
            args: ['234'],
            repoPath: process.cwd(),
            registeredRepos: [],
            defaultRepoPath: process.cwd(),
        });
        assert.ok(result.ok, 'dashboard action returns success with mocked spawn');
        assert.ok(seen, 'dashboard action invoked spawn');
        assert.strictEqual(seen.opts.env.AIGON_INVOKED_BY_DASHBOARD, '1', 'injects restart-deferral env var');
    } finally {
        childProcess.spawn = origSpawn;
        delete require.cache[dashboardServerPath];
        if (prevDash === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD;
        else process.env.AIGON_INVOKED_BY_DASHBOARD = prevDash;
    }
});

report();
