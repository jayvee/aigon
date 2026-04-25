#!/usr/bin/env node
// REGRESSION commit dac7a380: AutoConductor status used to die with its tmux
// session — dashboard read path couldn't distinguish "never started" from
// "started and failed". writeFeatureAutoState persists failure/reason to
// .aigon/state/, and safeFeatureAutoSessionExists surfaces that persisted
// state when tmux is gone so the UI renders the right badge.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, report } = require('../_helpers');
const {
    getFeatureAutoStatePath, readFeatureAutoState,
    writeFeatureAutoState, clearFeatureAutoState,
    getSetAutoStatePath, readSetAutoState,
    writeSetAutoState, clearSetAutoState,
} = require('../../lib/auto-session-state');
const { safeFeatureAutoSessionExists } = require('../../lib/dashboard-status-helpers');

test('auto state persists, merges sessionName, and clears cleanly', () => withTempDir('aigon-auto-state-', (repo) => {
    const first = writeFeatureAutoState(repo, '7', { status: 'starting', sessionName: 'aigon-f07-auto' });
    assert.strictEqual(first.featureId, '07');
    const second = writeFeatureAutoState(repo, '07', { status: 'completed', running: false, reason: 'feature-closed' });
    assert.strictEqual(second.sessionName, 'aigon-f07-auto', 'sessionName merged from prior write');
    assert.deepStrictEqual(readFeatureAutoState(repo, '07'), second);
    assert.strictEqual(clearFeatureAutoState(repo, '07'), true);
    assert.strictEqual(fs.existsSync(getFeatureAutoStatePath(repo, '07')), false);
}));

test('dashboard falls back to persisted state when tmux session is gone', () => withTempDir('aigon-auto-state-', (repo) => {
    fs.mkdirSync(path.join(repo, '.aigon', 'state'), { recursive: true });
    writeFeatureAutoState(repo, '99123', { status: 'failed', running: false, sessionName: 'aigon-f99123-auto', reason: 'eval-session-start-failed' });
    const r = safeFeatureAutoSessionExists('99123', repo);
    assert.strictEqual(r.status, 'failed');
    assert.strictEqual(r.reason, 'eval-session-start-failed');
    assert.strictEqual(r.running, false);
}));

testAsync('set auto state persists under lock and clears cleanly', async () => withTempDir('aigon-set-auto-state-', async (repo) => {
    // REGRESSION F316: SetConductor writes must be lock-serialized so resume/start
    // cannot race and corrupt set-<slug>-auto.json.
    const first = await writeSetAutoState(repo, 'feature-set', {
        status: 'starting',
        currentFeature: '01',
        completed: [],
        failed: [],
    });
    assert.strictEqual(first.setSlug, 'feature-set');
    const second = await writeSetAutoState(repo, 'feature-set', {
        status: 'running',
        running: true,
        completed: ['01'],
    });
    assert.strictEqual(second.status, 'running');
    assert.deepStrictEqual(second.completed, ['01']);
    assert.deepStrictEqual(readSetAutoState(repo, 'feature-set').completed, ['01']);
    assert.strictEqual(await clearSetAutoState(repo, 'feature-set'), true);
    assert.strictEqual(fs.existsSync(getSetAutoStatePath(repo, 'feature-set')), false);
}));

report();
