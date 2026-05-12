#!/usr/bin/env node
'use strict';

// Merged: feature-close-failure-event (classify + record + projector) +
// feature-close-recovery-state (F432: close_recovery_in_progress lifecycle).
// Both exercise the failure → recovery → retry → done round-trip.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const { classifyCloseFailure, recordCloseFailure } = require('../../lib/feature-close');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');
const { parseTmuxSessionName, buildTmuxSessionName } = require('../../lib/worktree');
const { getStateRenderMeta } = require('../../lib/state-render-meta');

const REPO_DIRS = [
    'docs/specs/features/03-in-progress',
    'docs/specs/features/logs',
    'docs/specs/features/05-done',
    '.aigon/workflows/features',
    '.aigon/state',
];

function withTempRepo(fn) {
    return withTempDirAsync('aigon-close-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repo, id, name) {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', `feature-${id}-${name}.md`);
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

async function bootstrapFeature(repo, id, name) {
    writeSpec(repo, id, name);
    await engine.startFeature(repo, id, 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, id, 'cc');
}

// ---------------------------------------------------------------------------
// classifyCloseFailure: pure-function regex classifier
// ---------------------------------------------------------------------------

const CLASSIFY_CASES = [
    ['merge-conflict from git stderr',
        'Auto-merging lib/foo.js\nCONFLICT (content): Merge conflict in lib/foo.js\nAutomatic merge failed; fix conflicts and then commit the result.',
        { kind: 'merge-conflict', conflictFilesIncludes: 'lib/foo.js' }],
    ['merge-conflict from our own error message',
        '❌ Merge conflict in 2 file(s):\n   - lib/commands/setup.js\n   - docs/specs/features/03-in-progress/feature-335-foo.md\n\nRebase the feature branch...',
        { kind: 'merge-conflict', conflictFilesIncludes: 'lib/commands/setup.js' }],
    ['security-scan',
        'Security scan failed\ngitleaks: secrets detected\n',
        { kind: 'security-scan' }],
    ['other (unknown stderr)',
        'Something else went wrong',
        { kind: 'other', conflictFiles: [] }],
];
for (const [name, stderr, expected] of CLASSIFY_CASES) {
    testAsync(`classifyCloseFailure: ${name}`, async () => {
        const r = classifyCloseFailure(stderr);
        assert.strictEqual(r.kind, expected.kind);
        if (expected.conflictFilesIncludes) {
            assert.ok(r.conflictFiles.includes(expected.conflictFilesIncludes),
                `expected ${expected.conflictFilesIncludes} in ${JSON.stringify(r.conflictFiles)}`);
        }
        if (expected.conflictFiles) {
            assert.deepStrictEqual(r.conflictFiles, expected.conflictFiles);
        }
    });
}

// ---------------------------------------------------------------------------
// Failure recording → events → projector → snapshot
// ---------------------------------------------------------------------------

testAsync('recordCloseFailure: emits event with conflictFiles, capped stderrTail, exitCode', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '01', 'close-failure');
    const longStderr = 'CONFLICT (content): Merge conflict in lib/foo.js\n' + 'x'.repeat(10000);
    await recordCloseFailure(repo, '01', longStderr, 1);

    const eventsPath = wf.getEntityWorkflowPaths(repo, 'feature', '01').eventsPath;
    const events = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const failEvent = events.find(e => e.type === 'feature_close.failed');
    assert.ok(failEvent, 'feature_close.failed event must be present');
    assert.strictEqual(failEvent.featureId, '01');
    assert.strictEqual(failEvent.kind, 'merge-conflict');
    assert.deepStrictEqual(failEvent.conflictFiles, ['lib/foo.js']);
    assert.ok(failEvent.stderrTail.length <= 4200, 'stderrTail must be capped near 4KB');
    assert.strictEqual(failEvent.exitCode, 1);
    assert.ok(failEvent.at);

    // Projector materialises lastCloseFailure on the snapshot
    const snap = await wf.showFeature(repo, '01');
    assert.strictEqual(snap.lastCloseFailure.kind, 'merge-conflict');
    assert.deepStrictEqual(snap.lastCloseFailure.conflictFiles, ['lib/foo.js']);

    // Dashboard actions: feature-close swapped for feature-resolve-and-close
    const actions = snapshotToDashboardActions('feature', '01', snap, 'in-progress');
    const resolveAction = actions.validActions.find(a => a.action === 'feature-resolve-and-close');
    assert.ok(resolveAction, 'should expose feature-resolve-and-close');
    assert.strictEqual(resolveAction.label, 'Resolve & close');
    assert.ok(!actions.validActions.some(a => a.action === 'feature-close'),
        'plain feature-close must be swapped out');
}));

testAsync('projector: feature.closed clears lastCloseFailure', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '03', 'close-failure-cleared');
    await recordCloseFailure(repo, '03', 'CONFLICT (content): Merge conflict in lib/x.js', 1);
    assert.ok((await wf.showFeature(repo, '03')).lastCloseFailure, 'set before close');
    await engine.closeFeatureWithEffects(repo, '03', async () => {});
    assert.strictEqual((await wf.showFeature(repo, '03')).lastCloseFailure, null,
        'cleared after successful close');
}));

// ---------------------------------------------------------------------------
// F432: close_recovery_in_progress lifecycle
// ---------------------------------------------------------------------------

testAsync('F432: state-render-meta + tmux session-name parsing register the close role', () => {
    const meta = getStateRenderMeta('close_recovery_in_progress');
    assert.strictEqual(meta.cls, 'status-reviewing');
    assert.ok(meta.label && meta.icon && meta.badge);

    const sessionName = buildTmuxSessionName('42', 'cc', { repo: 'aigon', desc: 'demo', role: 'close' });
    const parsed = parseTmuxSessionName(sessionName);
    assert.strictEqual(parsed.role, 'close');
    assert.strictEqual(parsed.agent, 'cc');
    assert.strictEqual(parsed.id, '42');
});

testAsync('F432: recovery transitions lifecycle, persists context, preserves lastCloseFailure', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '01', 'recovery-enter');
    await recordCloseFailure(repo, '01', 'CONFLICT (content): Merge conflict in lib/foo.js', 1);

    await engine.recordCloseRecoveryStarted(repo, '01', {
        agentId: 'cc', sessionName: 'aigon-f01-close-cc', source: 'dashboard', returnSpecState: 'ready',
    });
    let snap = await wf.showFeature(repo, '01');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    assert.strictEqual(snap.closeRecovery.agentId, 'cc');
    assert.strictEqual(snap.closeRecovery.returnSpecState, 'ready');
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure must persist into recovery');

    await engine.recordCloseRecoveryEnded(repo, '01', { agentId: 'cc' });
    snap = await wf.showFeature(repo, '01');
    assert.strictEqual(snap.currentSpecState, 'ready', 'recovery exit returns to ready');
    assert.strictEqual(snap.closeRecovery, null);
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure not cleared by recovery exit (only by feature.closed)');
}));

testAsync('F432 REGRESSION: recovery end restores returnSpecState (not hardcoded ready)', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '05', 'recovery-return-impl');
    await engine.pauseFeature(repo, '05');
    await engine.resumeFeature(repo, '05');
    assert.strictEqual((await wf.showFeature(repo, '05')).currentSpecState, 'implementing');

    await recordCloseFailure(repo, '05', 'CONFLICT (content): Merge conflict in z.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '05', { agentId: 'cc', returnSpecState: 'implementing' });
    assert.strictEqual((await wf.showFeature(repo, '05')).currentSpecState, 'close_recovery_in_progress');
    await engine.recordCloseRecoveryEnded(repo, '05', { agentId: 'cc' });
    assert.strictEqual((await wf.showFeature(repo, '05')).currentSpecState, 'implementing',
        'ended must restore returnSpecState not hardcoded ready');
}));

testAsync('F432 round-trip: failed → recovery → close → done clears failure + recovery', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '03', 'recovery-roundtrip');
    await recordCloseFailure(repo, '03', 'CONFLICT (content): Merge conflict in b.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '03', { agentId: 'cc', returnSpecState: 'ready' });
    assert.strictEqual((await wf.showFeature(repo, '03')).currentSpecState, 'close_recovery_in_progress');

    await engine.closeFeatureWithEffects(repo, '03', async () => {});
    const snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.currentSpecState, 'done');
    assert.strictEqual(snap.lastCloseFailure, null);
    assert.strictEqual(snap.closeRecovery, null);
}));

testAsync('F432: recovery state surfaces Resolve & close action when conflict persists', () => withTempRepo(async (repo) => {
    await bootstrapFeature(repo, '04', 'recovery-actions');
    await recordCloseFailure(repo, '04', 'CONFLICT (content): Merge conflict in c.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '04', { agentId: 'cc', returnSpecState: 'ready' });

    const snap = await wf.showFeature(repo, '04');
    const actions = snapshotToDashboardActions('feature', '04', snap, 'in-progress');
    assert.ok(actions.validActions.some(a => a.action === 'feature-resolve-and-close'));
    assert.ok(!actions.validActions.some(a => a.action === 'feature-close'));
}));

report();
