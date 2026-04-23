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

test('set conductor tmux session naming matches spec', () => {
    assert.strictEqual(buildSetAutoSessionName('aigon', 'feature-set'), 'aigon-sfeature-set-auto');
});

// F319: failure pause/resume state transitions

test('paused-on-failure: failedFeature persisted and completed list preserved', () => withTempDir('aigon-set-pause-', async (repo) => {
    // REGRESSION F316+F319: rerun continues from first incomplete; pause records failedFeature
    await writeSetAutoState(repo, 'auth', { status: 'running', running: true, completed: ['01'], failed: [] });
    await writeSetAutoState(repo, 'auth', {
        completed: ['01'], failed: ['02'], failedFeature: '02',
        status: 'paused-on-failure', running: false, reason: 'feature-auto-failed',
    });
    const state = readSetAutoState(repo, 'auth');
    assert.strictEqual(state.status, 'paused-on-failure');
    assert.strictEqual(state.failedFeature, '02');
    assert.deepStrictEqual(state.completed, ['01']);
    // resume: failed member is retried (not skipped); if now done in workflow it is skipped
    assert.deepStrictEqual(computeRemainingOrder(['01', '02', '03'], ['01'], []), ['02', '03']);
    assert.deepStrictEqual(computeRemainingOrder(['01', '02', '03'], ['01'], ['02']), ['03']);
}));

test('pause notification message contains slug, feature ID and resume command', () => {
    const msg = buildPauseNotificationMessage('feature-set', '03', []);
    assert.ok(msg.includes('feature-set') && msg.includes('feature #3'));
    assert.ok(msg.includes('aigon set-autonomous-resume feature-set') && msg.includes('review failed'));
    assert.ok(buildPauseNotificationMessage('s', 'x', []).includes('aigon set-autonomous-resume s'));
});

report();

