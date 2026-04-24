#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const { classifyCloseFailure, recordCloseFailure } = require('../../lib/feature-close');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    'docs/specs/features/05-done',
    '.aigon/workflows/features',
    '.aigon/state',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-close-failure-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repoPath, featureId, name) {
    const specPath = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress', `feature-${featureId}-${name}.md`);
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

// classifyCloseFailure unit tests
testAsync('classifyCloseFailure: detects merge-conflict from git output', async () => {
    const stderr = 'Auto-merging lib/foo.js\nCONFLICT (content): Merge conflict in lib/foo.js\nAutomatic merge failed; fix conflicts and then commit the result.';
    const r = classifyCloseFailure(stderr);
    assert.strictEqual(r.kind, 'merge-conflict');
    assert.deepStrictEqual(r.conflictFiles, ['lib/foo.js']);
});

testAsync('classifyCloseFailure: detects merge-conflict from our own error message', async () => {
    const stderr = '❌ Merge conflict in 2 file(s):\n   - lib/commands/setup.js\n   - docs/specs/features/03-in-progress/feature-335-foo.md\n\nRebase the feature branch...';
    const r = classifyCloseFailure(stderr);
    assert.strictEqual(r.kind, 'merge-conflict');
    assert.ok(r.conflictFiles.includes('lib/commands/setup.js'), 'should parse setup.js');
});

testAsync('classifyCloseFailure: detects security-scan', async () => {
    const r = classifyCloseFailure('Security scan failed\ngitleaks: secrets detected\n');
    assert.strictEqual(r.kind, 'security-scan');
});

testAsync('classifyCloseFailure: falls back to other for unknown', async () => {
    const r = classifyCloseFailure('Something else went wrong');
    assert.strictEqual(r.kind, 'other');
    assert.deepStrictEqual(r.conflictFiles, []);
});

// Integration test: recordCloseFailure emits event; projector consumes it
testAsync('recordCloseFailure: appends feature_close.failed event to events.jsonl', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'close-failure');
    await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '01', 'cc');

    const stderrText = 'CONFLICT (content): Merge conflict in lib/foo.js\nAutomatic merge failed';
    await recordCloseFailure(repo, '01', stderrText, 1);

    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '01').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8')
        .split('\n').filter(Boolean).map(l => JSON.parse(l));

    const failEvent = events.find(e => e.type === 'feature_close.failed');
    assert.ok(failEvent, 'feature_close.failed event should be in events.jsonl');
    assert.strictEqual(failEvent.featureId, '01');
    assert.strictEqual(failEvent.kind, 'merge-conflict');
    assert.deepStrictEqual(failEvent.conflictFiles, ['lib/foo.js']);
    assert.ok(failEvent.stderrTail.length > 0, 'stderrTail should be non-empty');
    assert.strictEqual(failEvent.exitCode, 1);
    assert.ok(failEvent.at, 'at field should be present');
}));

// Integration test: projector exposes lastCloseFailure on snapshot
testAsync('projector: feature_close.failed sets lastCloseFailure on snapshot', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'close-failure-projector');
    await engine.startFeature(repo, '02', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '02', 'cc');

    const stderrText = 'CONFLICT (content): Merge conflict in lib/bar.js\nAutomatic merge failed';
    await recordCloseFailure(repo, '02', stderrText, 1);

    const snap = await wf.showFeature(repo, '02');
    assert.ok(snap, 'snapshot should exist');
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure should be set');
    assert.strictEqual(snap.lastCloseFailure.kind, 'merge-conflict');
    assert.deepStrictEqual(snap.lastCloseFailure.conflictFiles, ['lib/bar.js']);
    assert.ok(snap.lastCloseFailure.stderrTail.length > 0);
    assert.ok(snap.lastCloseFailure.at, 'at field should be present');
}));

// Integration test: feature.closed clears lastCloseFailure
testAsync('projector: feature.closed clears lastCloseFailure', () => withTempRepo(async (repo) => {
    writeSpec(repo, '03', 'close-failure-cleared');
    await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '03', 'cc');

    await recordCloseFailure(repo, '03', 'CONFLICT (content): Merge conflict in lib/x.js', 1);

    let snap = await wf.showFeature(repo, '03');
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure should be set before close');

    // Close the feature — this emits feature.closed which should clear lastCloseFailure
    await engine.closeFeatureWithEffects(repo, '03', async () => {});
    snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.lastCloseFailure, null, 'lastCloseFailure should be cleared after successful close');
}));

// Integration test: snapshotToDashboardActions substitutes FEATURE_RESOLVE_AND_CLOSE
testAsync('snapshotToDashboardActions: swaps feature-close for feature-resolve-and-close on merge-conflict', () => withTempRepo(async (repo) => {
    writeSpec(repo, '04', 'close-failure-action');
    await engine.startFeature(repo, '04', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '04', 'cc');

    await recordCloseFailure(repo, '04', 'CONFLICT (content): Merge conflict in lib/y.js', 1);

    const snap = await wf.showFeature(repo, '04');
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure should be set');

    const actions = snapshotToDashboardActions('feature', '04', snap, 'in-progress');
    const hasResolveClose = actions.validActions.some(a => a.action === 'feature-resolve-and-close');
    const hasClose = actions.validActions.some(a => a.action === 'feature-close');
    assert.ok(hasResolveClose, 'should have feature-resolve-and-close action');
    assert.ok(!hasClose, 'should NOT have plain feature-close action');

    const resolveAction = actions.validActions.find(a => a.action === 'feature-resolve-and-close');
    assert.strictEqual(resolveAction.label, 'Resolve & close');
}));

// Integration test: stderrTail is capped at 4KB
testAsync('recordCloseFailure: caps stderrTail at 4KB', () => withTempRepo(async (repo) => {
    writeSpec(repo, '05', 'close-failure-cap');
    await engine.startFeature(repo, '05', 'solo_branch', ['cc']);

    const longStderr = 'x'.repeat(10000);
    await recordCloseFailure(repo, '05', longStderr, 1);

    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '05').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8')
        .split('\n').filter(Boolean).map(l => JSON.parse(l));
    const failEvent = events.find(e => e.type === 'feature_close.failed');
    assert.ok(failEvent.stderrTail.length <= 4200, 'stderrTail should be capped near 4KB');
}));

report();
