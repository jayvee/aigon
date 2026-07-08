#!/usr/bin/env node
// REGRESSION F633: dashboard-collect entity-core + set-cards unit seams.
'use strict';

const assert = require('assert');
const { test, report } = require('../_helpers');
const { computePendingCompletionSignal } = require('../../lib/dashboard-collect/entity-core');
const { buildSetMemberState } = require('../../lib/dashboard-collect/set-cards');
const { collectDoneSpecs } = require('../../lib/dashboard-collect/safe-reads');

test('computePendingCompletionSignal returns implementation-complete escape hatch for open do task', () => {
    const signal = computePendingCompletionSignal('implementing', 'implementing', 'do', 'implementing', 'feature');
    assert.strictEqual(signal, 'implementation-complete');
});

test('computePendingCompletionSignal is null when file already recorded complete', () => {
    const signal = computePendingCompletionSignal('implementing', 'implementation-complete', 'do', 'implementing', 'feature');
    assert.strictEqual(signal, null);
});

test('buildSetMemberState marks done when member stage is done', () => {
    const state = buildSetMemberState({ paddedId: '5', stage: 'done' }, null, null, new Set(), new Set());
    assert.strictEqual(state, 'done');
});

test('collectDoneSpecs orders numeric ids descending', () => {
    const doneDir = require('path').join(__dirname, '../fixtures/dashboard-collect-done');
    const result = collectDoneSpecs(doneDir, /^feature-\d+-.+\.md$/, 3, { entityType: 'feature' });
    assert.strictEqual(result.total, 4);
    assert.deepStrictEqual(result.recent.map(r => r.file), [
        'feature-40-z.md',
        'feature-12-a.md',
        'feature-3-b.md',
    ]);
});

report();
