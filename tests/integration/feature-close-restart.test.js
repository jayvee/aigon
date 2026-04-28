#!/usr/bin/env node
const a = require('assert'), { restartServerIfLibChanged: r } = require('../../lib/feature-close');
const mk = (d, o = {}) => { const c = { n: 0, marker: null }; return { c, x: { getChangedLibFiles: () => String(d || '').trim().split('\n').filter(Boolean), getServerRegistryEntry: () => o.noServer ? null : { pid: 1 }, isProcessAlive: () => true, loadProjectConfig: () => o.cfg || {}, restartServer: () => { c.n++; }, writeRestartMarker: (m) => { c.marker = m; }, log: () => {}, warn: () => {} } }; };
const run = (d, o) => { const m = mk(d, o); r({ preMergeBaseRef: 'main' }, m.x); return m.c; };
const prev = process.env.AIGON_INVOKED_BY_DASHBOARD;
try {
    delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    a.strictEqual(run('lib/x.js\n').n, 1, 'AC1 lib/*.js triggers restart');
    a.strictEqual(run('').n, 0, 'AC2 empty diff skips restart');
    a.strictEqual(run('lib/x.js\n', { noServer: true }).n, 0, 'AC7 no server skips silently');
    a.strictEqual(run('lib/x.js\n', { cfg: { featureClose: { autoRestartServer: false } } }).n, 0, 'AC8 opt-out disables');
    process.env.AIGON_INVOKED_BY_DASHBOARD = '1';
    const dash = run('lib/x.js\nlib/y.js\n');
    a.strictEqual(dash.n, 0, 'feature 234: dashboard-invoked never calls restartServer');
    a.ok(dash.marker && dash.marker.reason === 'lib-changed' && dash.marker.files.length === 2, 'feature 234: marker recorded with files');
} finally {
    if (prev === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD; else process.env.AIGON_INVOKED_BY_DASHBOARD = prev;
}

// feature 428: runDashboardInteractiveAction is now async (spawn, not spawnSync).
// Test with a mocked spawn that completes immediately.
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const origSpawn = childProcess.spawn;
const dashboardServerPath = require.resolve('../../lib/dashboard-server');
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
const dashboardServer = require('../../lib/dashboard-server');
dashboardServer.runDashboardInteractiveAction({
    action: 'feature-close',
    args: ['234'],
    repoPath: process.cwd(),
    registeredRepos: [],
    defaultRepoPath: process.cwd(),
}).then(result => {
    a.ok(result.ok, 'feature 234: dashboard action returns success with mocked spawn');
    a.ok(seen, 'feature 234: dashboard action invoked spawn');
    a.strictEqual(seen.opts.env.AIGON_INVOKED_BY_DASHBOARD, '1', 'feature 234: dashboard action injects restart-deferral env var');
}).catch(e => {
    console.error('feature 234 async test failed:', e.message);
    process.exitCode = 1;
}).finally(() => {
    childProcess.spawn = origSpawn;
    delete require.cache[dashboardServerPath];
    if (prevDash === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD;
    else process.env.AIGON_INVOKED_BY_DASHBOARD = prevDash;
});
