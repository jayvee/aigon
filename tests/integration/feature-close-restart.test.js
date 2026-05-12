#!/usr/bin/env node
'use strict';

// REGRESSION F234: dashboard-invoked feature-close defers restart (writes marker, not call).
// F428: runDashboardInteractiveAction is async (spawn, not spawnSync).

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
