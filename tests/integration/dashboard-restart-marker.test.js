#!/usr/bin/env node
// REGRESSION feature 234: the restart-needed marker is the signalling bridge
// between a dashboard-spawned close subprocess and the dashboard process
// itself. If writeRestartMarkerFile / consumeRestartMarker drift apart, the
// dashboard will never notice it needs to restart and will keep serving
// stale lib/*.js — reproducing the feature 233 "socket hang up" symptom.
const a = require('assert'), fs = require('fs'), path = require('path');
const { withTempDir, report, test } = require('../_helpers');
const close = require('../../lib/feature-close');

test('writeRestartMarkerFile → consumeRestartMarker round-trip', () => withTempDir((dir) => {
    close.writeRestartMarkerFile(dir, { reason: 'lib-changed', files: ['lib/a.js'], at: '2026-04-07T00:00:00Z' });
    const p = path.join(dir, '.aigon', 'server', 'restart-needed.json');
    a.ok(fs.existsSync(p), 'marker file written');
    const m = close.consumeRestartMarker(dir);
    a.strictEqual(m.reason, 'lib-changed');
    a.deepStrictEqual(m.files, ['lib/a.js']);
    a.ok(!fs.existsSync(p), 'marker deleted after consume');
    a.strictEqual(close.consumeRestartMarker(dir), null, 'absent marker → null');
}));

report();
