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
    writeSetAutoState, writeSetAutoStateSync, clearSetAutoState,
    reconcileStaleSetAutoPauseState,
} = require('../../lib/auto-session-state');
const {
    safeFeatureAutoSessionExists,
    safeSetAutoSessionExists,
    _setTmuxListCacheForTest,
    _resetTmuxListCache,
} = require('../../lib/dashboard-status-helpers');
const { buildSetValidActions } = require('../../lib/feature-set-workflow-rules');
const engine = require('../../lib/workflow-core');

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

// REGRESSION F646: paused set wait-loop keeps tmux alive — dashboard must not map
// session presence to status=running (that hid Resume and showed Stop only).
test('safeSetAutoSessionExists preserves paused-on-failure when tmux wait-loop is alive', () => withTempDir('aigon-set-pause-dash-', (repo) => {
    const repoName = path.basename(repo);
    writeSetAutoStateSync(repo, 'close-integrity', {
        status: 'paused-on-failure',
        running: false,
        currentFeature: '646',
        failedFeature: '646',
        failed: ['646'],
        completed: ['644', '645'],
        members: ['644', '645', '646', '647'],
        reason: 'post-merge-gate-failed',
        sessionName: `${repoName}-sclose-integrity-auto`,
    });
    _setTmuxListCacheForTest([`${repoName}-sclose-integrity-auto`]);
    try {
        const view = safeSetAutoSessionExists('close-integrity', repo);
        assert.strictEqual(view.status, 'paused-on-failure');
        assert.strictEqual(view.running, false);
        assert.strictEqual(view.sessionAlive, true);
        assert.deepStrictEqual(view.failed, ['646']);
        const actions = buildSetValidActions({
            slug: 'close-integrity',
            status: view.status,
            isComplete: false,
            autonomous: view,
        }, { requiresPro: false, proAvailable: true });
        assert.ok(actions.some((a) => a.action === 'set-autonomous-resume'), 'expected resume when paused with live tmux');
        assert.ok(!actions.some((a) => a.action === 'set-autonomous-stop'), 'stop must not replace resume on pause');
    } finally {
        _resetTmuxListCache();
    }
}));

test('reconcileStaleSetAutoPauseState heals failed member closed externally', () => withTempDir('aigon-set-pause-heal-', (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '05-done', 'feature-646-healed.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# Feature: healed\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', '646', 'done', specPath);
    writeSetAutoStateSync(repo, 'close-integrity', {
        status: 'paused-on-failure',
        running: false,
        currentFeature: '646',
        failedFeature: '646',
        failed: ['646'],
        completed: ['644', '645'],
        members: ['644', '645', '646', '647'],
        reason: 'post-merge-gate-failed',
    });
    const healed = reconcileStaleSetAutoPauseState(repo, 'close-integrity');
    assert.strictEqual(healed.status, 'paused-on-failure');
    assert.deepStrictEqual(healed.completed, ['644', '645', '646']);
    assert.deepStrictEqual(healed.failed, []);
    assert.strictEqual(healed.currentFeature, null);
    assert.strictEqual(healed.failedFeature, null);
}));

report();
