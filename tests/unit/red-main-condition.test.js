#!/usr/bin/env node
'use strict';

// REGRESSION F659: repo-level red-main condition dedupes failures and clears on pass.

const assert = require('assert');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const {
    readRedMainCondition,
    recordRedMainFailure,
    clearRedMainCondition,
} = require('../../lib/red-main-condition');

testAsync('recordRedMainFailure preserves first-seen and updates latest', () => withTempDirAsync('aigon-red-main-', async (dir) => {
    const first = recordRedMainFailure(dir, {
        featureId: '01',
        gateCommand: 'npm run test:core',
        logPath: '.aigon/state/close-gates/feature-01-a.log',
        at: '2026-07-08T13:27:00.000Z',
    });
    assert.strictEqual(first.firstSeenFeatureId, '01');
    assert.strictEqual(first.latestFeatureId, '01');

    const second = recordRedMainFailure(dir, {
        featureId: '02',
        gateCommand: 'npm run test:core',
        logPath: '.aigon/state/close-gates/feature-02-b.log',
        at: '2026-07-08T13:29:00.000Z',
    });
    assert.strictEqual(second.firstSeenFeatureId, '01');
    assert.strictEqual(second.firstSeenAt, '2026-07-08T13:27:00.000Z');
    assert.strictEqual(second.latestFeatureId, '02');
    assert.strictEqual(second.latestSeenAt, '2026-07-08T13:29:00.000Z');
    assert.strictEqual(second.gateLogPath, '.aigon/state/close-gates/feature-02-b.log');

    const active = readRedMainCondition(dir);
    assert.ok(active && active.active);
}));

testAsync('clearRedMainCondition deactivates the active record', () => withTempDirAsync('aigon-red-main-', async (dir) => {
    recordRedMainFailure(dir, { featureId: '03', gateCommand: 'true' });
    const cleared = clearRedMainCondition(dir, { featureId: '04', at: '2026-07-08T14:00:00.000Z' });
    assert.strictEqual(cleared.active, false);
    assert.strictEqual(readRedMainCondition(dir), null);
}));

report();
