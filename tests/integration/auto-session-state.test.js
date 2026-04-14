#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    getFeatureAutoStatePath,
    readFeatureAutoState,
    writeFeatureAutoState,
    clearFeatureAutoState,
} = require('../../lib/auto-session-state');
const { safeFeatureAutoSessionExists } = require('../../lib/dashboard-status-helpers');

test('feature auto state persists and clears cleanly', () => withTempDir('aigon-auto-state-', (repoDir) => {
    const first = writeFeatureAutoState(repoDir, '7', {
        status: 'starting',
        sessionName: 'aigon-f07-auto-test',
    });
    assert.strictEqual(first.featureId, '07');
    assert.strictEqual(first.status, 'starting');
    assert.ok(first.startedAt);
    assert.ok(first.updatedAt);

    const second = writeFeatureAutoState(repoDir, '07', {
        status: 'completed',
        running: false,
        reason: 'feature-closed',
    });
    assert.strictEqual(second.featureId, '07');
    assert.strictEqual(second.status, 'completed');
    assert.strictEqual(second.reason, 'feature-closed');
    assert.strictEqual(second.sessionName, 'aigon-f07-auto-test');

    const statePath = getFeatureAutoStatePath(repoDir, '07');
    assert.ok(fs.existsSync(statePath));
    assert.deepStrictEqual(readFeatureAutoState(repoDir, '07'), second);

    assert.strictEqual(clearFeatureAutoState(repoDir, '07'), true);
    assert.strictEqual(fs.existsSync(statePath), false);
    assert.strictEqual(readFeatureAutoState(repoDir, '07'), null);
}));

test('dashboard helper falls back to persisted feature auto state when tmux session is gone', () => withTempDir('aigon-auto-state-', (repoDir) => {
    fs.mkdirSync(path.join(repoDir, '.aigon', 'state'), { recursive: true });
    writeFeatureAutoState(repoDir, '99123', {
        status: 'failed',
        running: false,
        sessionName: 'aigon-f99123-auto-example',
        reason: 'eval-session-start-failed',
    });

    const result = safeFeatureAutoSessionExists('99123', repoDir);
    assert.deepStrictEqual(result, {
        sessionName: null,
        running: false,
        status: 'failed',
        updatedAt: readFeatureAutoState(repoDir, '99123').updatedAt,
        startedAt: readFeatureAutoState(repoDir, '99123').startedAt,
        endedAt: null,
        reason: 'eval-session-start-failed',
    });
}));

report();
