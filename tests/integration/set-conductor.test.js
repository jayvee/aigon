#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const {
    buildSetAutoSessionName,
    resolveSetExecutionPlan,
    computeRemainingOrder,
    buildPauseNotificationMessage,
} = require('../../lib/set-conductor');
const { readSetAutoState, writeSetAutoState } = require('../../lib/auto-session-state');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function seedFeatureDirs(repoRoot) {
    const featuresRoot = path.join(repoRoot, 'docs', 'specs', 'features');
    FOLDERS.forEach((folder) => fs.mkdirSync(path.join(featuresRoot, folder), { recursive: true }));
    return featuresRoot;
}

function writeSpec(featuresRoot, folder, file, { set, dependsOn } = {}) {
    const lines = ['---'];
    if (set) lines.push(`set: ${set}`);
    if (dependsOn) lines.push(`depends_on: [${dependsOn.join(', ')}]`);
    lines.push('---', '', `# ${file}`, '');
    fs.writeFileSync(path.join(featuresRoot, folder, file), lines.join('\n'));
}

test('set conductor resolves set members in topological order', () => withTempDir('aigon-set-conductor-', (repo) => {
    // REGRESSION F316: set execution order must respect intra-set depends_on edges.
    const featuresRoot = seedFeatureDirs(repo);
    writeSpec(featuresRoot, '02-backlog', 'feature-01-root.md', { set: 'auth' });
    writeSpec(featuresRoot, '02-backlog', 'feature-02-mid.md', { set: 'auth', dependsOn: ['01'] });
    writeSpec(featuresRoot, '02-backlog', 'feature-03-leaf.md', { set: 'auth', dependsOn: ['02'] });
    const plan = resolveSetExecutionPlan(repo, 'auth');
    assert.deepStrictEqual(plan.order, ['01', '02', '03']);
}));

test('set conductor refuses dependency cycles within a set', () => withTempDir('aigon-set-conductor-', (repo) => {
    // REGRESSION F316: cycle detection must fail loud instead of silently degrading order.
    const featuresRoot = seedFeatureDirs(repo);
    writeSpec(featuresRoot, '02-backlog', 'feature-01-a.md', { set: 'auth', dependsOn: ['02'] });
    writeSpec(featuresRoot, '02-backlog', 'feature-02-b.md', { set: 'auth', dependsOn: ['01'] });
    assert.throws(() => resolveSetExecutionPlan(repo, 'auth'), /Dependency cycle inside set/);
}));

test('resume skips completed and already-merged members', () => {
    // REGRESSION F316: rerun after a killed set tmux session must continue from the first incomplete member.
    assert.deepStrictEqual(
        computeRemainingOrder(['01', '02', '03'], ['01'], ['02']),
        ['03']
    );
});

test('set conductor tmux session naming matches spec', () => {
    assert.strictEqual(buildSetAutoSessionName('aigon', 'feature-set'), 'aigon-sfeature-set-auto');
});

// F319: failure pause/resume state transitions

test('paused-on-failure state includes failedFeature field', () => withTempDir('aigon-set-pause-', async (repo) => {
    // Simulate the conductor writing paused-on-failure state after a member fails.
    await writeSetAutoState(repo, 'auth', {
        setSlug: 'auth',
        members: ['01', '02', '03'],
        order: ['01', '02', '03'],
        currentFeature: '02',
        completed: ['01'],
        failed: ['02'],
        failedFeature: '02',
        status: 'paused-on-failure',
        running: false,
        endedAt: new Date().toISOString(),
        reason: 'feature-auto-failed',
    });
    const state = readSetAutoState(repo, 'auth');
    assert.strictEqual(state.status, 'paused-on-failure');
    assert.strictEqual(state.failedFeature, '02');
    assert.deepStrictEqual(state.failed, ['02']);
    assert.deepStrictEqual(state.completed, ['01']);
}));

test('resume from paused-on-failure retries the failed feature (not skipped)', () => {
    // F319 AC: resume re-enters at the failed feature.
    // computeRemainingOrder does NOT exclude failed features — only completed and already-done.
    const remaining = computeRemainingOrder(['01', '02', '03'], ['01'], []);
    assert.deepStrictEqual(remaining, ['02', '03'], 'failed feature 02 is included (not skipped)');
});

test('resume when failed feature is now done advances past it', () => {
    // F319 AC: if the failed feature is now `done` in workflow-core, conductor advances to next.
    // computeRemainingOrder receives it in alreadyDoneIds.
    const remaining = computeRemainingOrder(['01', '02', '03'], ['01'], ['02']);
    assert.deepStrictEqual(remaining, ['03'], 'feature 02 (now done) is skipped, continue from 03');
});

test('set-autonomous-reset clears paused state', () => withTempDir('aigon-set-reset-', async (repo) => {
    await writeSetAutoState(repo, 'auth', {
        setSlug: 'auth',
        status: 'paused-on-failure',
        failedFeature: '02',
        failed: ['02'],
        completed: ['01'],
    });
    const { clearSetAutoState } = require('../../lib/auto-session-state');
    await clearSetAutoState(repo, 'auth');
    const state = readSetAutoState(repo, 'auth');
    assert.strictEqual(state, null, 'state is cleared after reset');
}));

test('notification message names the failing feature and includes resume command', () => {
    const msg = buildPauseNotificationMessage('feature-set', '03', ['01', '02', '03']);
    assert.ok(msg.includes('feature-set'), 'message includes set slug');
    assert.ok(msg.includes('feature #3'), 'message includes numeric feature ID');
    assert.ok(msg.includes('aigon set-autonomous-resume feature-set'), 'message includes resume command');
    assert.ok(msg.includes('review failed'), 'message explains why paused');
});

test('notification message with non-numeric feature ID falls back gracefully', () => {
    const msg = buildPauseNotificationMessage('myslug', 'pending-id', ['pending-id']);
    assert.ok(msg.includes('myslug'), 'includes set slug');
    assert.ok(msg.includes('aigon set-autonomous-resume myslug'), 'includes resume command');
});

test('state transition running → paused-on-failure preserves completed list', () => withTempDir('aigon-set-transition-', async (repo) => {
    // Simulate running state
    await writeSetAutoState(repo, 'myslug', {
        setSlug: 'myslug',
        members: ['01', '02', '03'],
        order: ['01', '02', '03'],
        currentFeature: '02',
        completed: ['01'],
        failed: [],
        status: 'running',
        running: true,
    });
    // Simulate failure transition
    await writeSetAutoState(repo, 'myslug', {
        currentFeature: '02',
        completed: ['01'],
        failed: ['02'],
        failedFeature: '02',
        status: 'paused-on-failure',
        running: false,
        endedAt: new Date().toISOString(),
        reason: 'feature-auto-failed',
    });
    const state = readSetAutoState(repo, 'myslug');
    assert.strictEqual(state.status, 'paused-on-failure');
    assert.deepStrictEqual(state.completed, ['01'], 'completed list preserved');
    assert.strictEqual(state.running, false);
    assert.ok(state.endedAt, 'endedAt set');
}));

report();

