#!/usr/bin/env node
// REGRESSION feature 228: feature-close auto-restarts aigon server only when merged
// commits touch lib/*.js (AC1/AC2), skips when no server running (AC7), respects opt-out (AC8).
const a = require('assert'), { restartServerIfLibChanged: r } = require('../../lib/feature-close');
const mk = (d, o = {}) => { const c = { n: 0 }; return { c, x: { getChangedLibFiles: () => String(d || '').trim().split('\n').filter(Boolean), getServerRegistryEntry: () => o.noServer ? null : { pid: 1 }, isProcessAlive: () => true, loadProjectConfig: () => o.cfg || {}, restartServer: () => { c.n++; }, log: () => {}, warn: () => {} } }; };
const run = (d, o) => { const m = mk(d, o); r({ preMergeBaseRef: 'main' }, m.x); return m.c.n; };
a.strictEqual(run('lib/x.js\n'), 1, 'AC1 lib/*.js triggers restart');
a.strictEqual(run(''), 0, 'AC2 empty diff skips restart');
a.strictEqual(run('lib/x.js\n', { noServer: true }), 0, 'AC7 no server skips silently');
a.strictEqual(run('lib/x.js\n', { cfg: { featureClose: { autoRestartServer: false } } }), 0, 'AC8 opt-out disables');
