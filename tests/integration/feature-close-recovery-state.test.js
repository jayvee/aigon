#!/usr/bin/env node
'use strict';

/**
 * F432: close-recovery as a first-class currentSpecState.
 * Verifies projector/machine handling, snapshot adapter swap, and the
 * full failure → recovery → retry → done round-trip.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const wf = require('../../lib/workflow-core');
const { recordCloseFailure } = require('../../lib/feature-close');
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
    return withTempDirAsync('aigon-close-recovery-', async (dir) => {
        for (const sub of REPO_DIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
        return fn(dir);
    });
}

function writeSpec(repoPath, featureId, name) {
    const specPath = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress', `feature-${featureId}-${name}.md`);
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

testAsync('state-render-meta: close_recovery_in_progress is registered', () => {
    const meta = getStateRenderMeta('close_recovery_in_progress');
    assert.strictEqual(meta.cls, 'status-reviewing');
    assert.ok(meta.label && meta.icon, 'label/icon required');
    assert.ok(meta.badge, 'badge required so dashboard surfaces the state');
});

testAsync('parseTmuxSessionName recognises the close role round-trip', () => {
    const name = buildTmuxSessionName('42', 'cc', { repo: 'aigon', desc: 'demo', role: 'close' });
    const parsed = parseTmuxSessionName(name);
    assert.ok(parsed, 'parseTmuxSessionName must recognise the close-role session name');
    assert.strictEqual(parsed.role, 'close');
    assert.strictEqual(parsed.agent, 'cc');
    assert.strictEqual(parsed.id, '42');
});

testAsync('recordCloseRecoveryStarted: moves lifecycle to close_recovery_in_progress and records context', () => withTempRepo(async (repo) => {
    writeSpec(repo, '01', 'recovery-enter');
    await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '01', 'cc');
    await recordCloseFailure(repo, '01', 'CONFLICT (content): Merge conflict in lib/foo.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '01', {
        agentId: 'cc',
        sessionName: 'aigon-f01-close-cc',
        source: 'dashboard',
        returnSpecState: 'submitted',
    });
    const snap = await wf.showFeature(repo, '01');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    assert.ok(snap.closeRecovery, 'closeRecovery context blob should be set');
    assert.strictEqual(snap.closeRecovery.agentId, 'cc');
    assert.strictEqual(snap.closeRecovery.returnSpecState, 'submitted');
    // lastCloseFailure must persist as forensic detail across the recovery transition
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure must persist into recovery');
}));

testAsync('recordCloseRecoveryEnded: returns lifecycle to submitted and clears closeRecovery', () => withTempRepo(async (repo) => {
    writeSpec(repo, '02', 'recovery-end');
    await engine.startFeature(repo, '02', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '02', 'cc');
    await recordCloseFailure(repo, '02', 'CONFLICT (content): Merge conflict in a.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '02', { agentId: 'cc', returnSpecState: 'submitted' });
    await engine.recordCloseRecoveryEnded(repo, '02', { agentId: 'cc' });
    const snap = await wf.showFeature(repo, '02');
    assert.strictEqual(snap.currentSpecState, 'submitted', 'recovery exit returns to submitted');
    assert.strictEqual(snap.closeRecovery, null);
    // lastCloseFailure default: do not auto-clear on recovery exit (cleared only by feature.closed)
    assert.ok(snap.lastCloseFailure, 'lastCloseFailure should not be cleared by recovery exit');
}));

testAsync('recordCloseRecoveryEnded: restores returnSpecState implementing (projector + machine)', () => withTempRepo(async (repo) => {
    writeSpec(repo, '05', 'recovery-return-impl');
    await engine.startFeature(repo, '05', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '05', 'cc');
    await engine.pauseFeature(repo, '05');
    await engine.resumeFeature(repo, '05');
    let snap = await wf.showFeature(repo, '05');
    assert.strictEqual(snap.currentSpecState, 'implementing');
    await recordCloseFailure(repo, '05', 'CONFLICT (content): Merge conflict in z.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '05', { agentId: 'cc', returnSpecState: 'implementing' });
    snap = await wf.showFeature(repo, '05');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    await engine.recordCloseRecoveryEnded(repo, '05', { agentId: 'cc' });
    snap = await wf.showFeature(repo, '05');
    assert.strictEqual(snap.currentSpecState, 'implementing', 'REGRESSION: ended must restore returnSpecState not hardcoded submitted');
    assert.strictEqual(snap.closeRecovery, null);
}));

testAsync('full round-trip: failed → recovery → retry close → done clears failure + closeRecovery', () => withTempRepo(async (repo) => {
    writeSpec(repo, '03', 'recovery-roundtrip');
    await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '03', 'cc');
    await recordCloseFailure(repo, '03', 'CONFLICT (content): Merge conflict in b.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '03', { agentId: 'cc', returnSpecState: 'submitted' });
    let snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.currentSpecState, 'close_recovery_in_progress');
    // Operator (or agent) fixes conflicts; close-with-effects retries successfully.
    await engine.closeFeatureWithEffects(repo, '03', async () => {});
    snap = await wf.showFeature(repo, '03');
    assert.strictEqual(snap.currentSpecState, 'done');
    assert.strictEqual(snap.lastCloseFailure, null, 'lastCloseFailure cleared on close');
    assert.strictEqual(snap.closeRecovery, null, 'closeRecovery cleared on close');
}));

testAsync('snapshotToDashboardActions: close_recovery_in_progress + merge-conflict → Resolve & close', () => withTempRepo(async (repo) => {
    writeSpec(repo, '04', 'recovery-actions');
    await engine.startFeature(repo, '04', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repo, '04', 'cc');
    await recordCloseFailure(repo, '04', 'CONFLICT (content): Merge conflict in c.js', 1);
    await engine.recordCloseRecoveryStarted(repo, '04', { agentId: 'cc', returnSpecState: 'submitted' });
    const snap = await wf.showFeature(repo, '04');
    const actions = snapshotToDashboardActions('feature', '04', snap, 'in-progress');
    const hasResolve = actions.validActions.some(a => a.action === 'feature-resolve-and-close');
    const hasClose = actions.validActions.some(a => a.action === 'feature-close');
    assert.ok(hasResolve, 'recovery state should expose Resolve & close when merge conflict persists');
    assert.ok(!hasClose, 'plain feature-close should be swapped out');
}));

report();
