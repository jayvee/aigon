#!/usr/bin/env node
// REGRESSION feature 228: restartServerIfLibChanged restarts server only when
// merged commits touch lib/*.js (AC1/AC2), skips when no server (AC7), respects opt-out (AC8).
// REGRESSION feature 234: when AIGON_INVOKED_BY_DASHBOARD=1 the helper MUST
// write the restart marker and MUST NOT call restartServer (otherwise the
// close subprocess kills its own grandparent dashboard and dies via EPIPE).
const a = require('assert'), { restartServerIfLibChanged: r } = require('../../lib/feature-close');
const mk = (d, o = {}) => { const c = { n: 0, marker: null }; return { c, x: { getChangedLibFiles: () => String(d || '').trim().split('\n').filter(Boolean), getServerRegistryEntry: () => o.noServer ? null : { pid: 1 }, isProcessAlive: () => true, loadProjectConfig: () => o.cfg || {}, restartServer: () => { c.n++; }, writeRestartMarker: (m) => { c.marker = m; }, log: () => {}, warn: () => {} } }; };
const run = (d, o) => { const m = mk(d, o); r({ preMergeBaseRef: 'main' }, m.x); return m.c; };
a.strictEqual(run('lib/x.js\n').n, 1, 'AC1 lib/*.js triggers restart');
a.strictEqual(run('').n, 0, 'AC2 empty diff skips restart');
a.strictEqual(run('lib/x.js\n', { noServer: true }).n, 0, 'AC7 no server skips silently');
a.strictEqual(run('lib/x.js\n', { cfg: { featureClose: { autoRestartServer: false } } }).n, 0, 'AC8 opt-out disables');
// feature 234 AC: dashboard-invoked → marker only, never restartServer
const prev = process.env.AIGON_INVOKED_BY_DASHBOARD;
process.env.AIGON_INVOKED_BY_DASHBOARD = '1';
const dash = run('lib/x.js\nlib/y.js\n');
a.strictEqual(dash.n, 0, 'feature 234: dashboard-invoked never calls restartServer');
a.ok(dash.marker && dash.marker.reason === 'lib-changed' && dash.marker.files.length === 2, 'feature 234: marker recorded with files');
if (prev === undefined) delete process.env.AIGON_INVOKED_BY_DASHBOARD; else process.env.AIGON_INVOKED_BY_DASHBOARD = prev;

// feature 234 AC: dashboard action subprocesses must be launched with the
// dashboard env var so feature-close can defer restart instead of self-killing.
const childProcess = require('child_process');
const origSpawnSync = childProcess.spawnSync;
const dashboardServerPath = require.resolve('../../lib/dashboard-server');
let seen = null;
try {
    delete require.cache[dashboardServerPath];
    childProcess.spawnSync = (cmd, args, opts) => {
        seen = { cmd, args, opts };
        return { status: 0, stdout: '', stderr: '' };
    };
    const dashboardServer = require('../../lib/dashboard-server');
    const result = dashboardServer.runDashboardInteractiveAction({
        action: 'feature-close',
        args: ['234'],
        repoPath: process.cwd(),
        registeredRepos: [],
        defaultRepoPath: process.cwd(),
    });
    a.ok(result.ok, 'feature 234: dashboard action returns success with mocked spawn');
    a.ok(seen, 'feature 234: dashboard action invoked spawnSync');
    a.strictEqual(seen.opts.env.AIGON_INVOKED_BY_DASHBOARD, '1', 'feature 234: dashboard action injects restart-deferral env var');
} finally {
    childProcess.spawnSync = origSpawnSync;
    delete require.cache[dashboardServerPath];
}
