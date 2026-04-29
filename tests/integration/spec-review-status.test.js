#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const { applySpecReviewFromSnapshots: _applySpecReviewFromSnapshots, clearTierCache } = require('../../lib/dashboard-status-collector');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');
const { runPendingMigrations } = require('../../lib/migration');

const initRepo = (repo) => {
    ['docs/specs/features/01-inbox', 'docs/specs/features/02-backlog', 'docs/specs/research-topics/01-inbox', 'docs/specs/research-topics/02-backlog']
        .forEach((dir) => fs.mkdirSync(path.join(repo, dir), { recursive: true }));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: repo });
};
const pickSpecReviewLabels = (entityType, pendingCount) => snapshotToDashboardActions(entityType, '12', {
    entityType, featureId: '12', currentSpecState: 'backlog', lifecycle: 'backlog', mode: 'solo_branch',
    agents: {}, winnerAgentId: null, updatedAt: new Date().toISOString(),
    specReview: { pendingCount, pendingAgents: pendingCount ? ['gg'] : [], pendingLabel: pendingCount ? `${pendingCount} pending — gg` : '', pendingReviews: pendingCount ? [{ reviewId: 'sha1', reviewerId: 'gg', summary: 'tighten spec' }] : [] },
}).validActions.filter((action) => action.action.includes('spec-review') || action.action.includes('spec-revise')).map((action) => action.label);

testAsync('workflow-backed spec-review status drives dashboard actions', () => withTempDirAsync('aigon-spec-review-', async (repo) => {
    initRepo(repo);
    const featureSpec = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test.md');
    const researchSpec = path.join(repo, 'docs/specs/research-topics/02-backlog/research-21-topic.md');
    fs.writeFileSync(featureSpec, '# Feature: test\n');
    fs.writeFileSync(researchSpec, '# Research: topic\n');
    await engine.recordSpecReviewSubmitted(repo, 'feature', '12', { reviewId: 'sha-review-1', reviewerId: 'gg', summary: 'tighten acceptance criteria', commitSha: 'sha-review-1' });
    await engine.recordSpecReviewSubmitted(repo, 'research', '21', { reviewId: 'sha-review-2', reviewerId: 'cc', summary: 'tighten questions', commitSha: 'sha-review-2' });
    await engine.recordSpecReviewAcknowledged(repo, 'research', '21', { commitSha: 'sha-ack-1' });
    clearTierCache(repo);
    // F344: applySpecReviewFromSnapshots is a no-op shim; badge data now comes from stateRenderMeta.
    // Verify that snapshotToDashboardActions still derives the correct actions from engine state.
    const featureSnapshot = await engine.showFeatureOrNull(repo, '12');
    const featureActions = snapshotToDashboardActions('feature', '12', featureSnapshot, 'backlog').validActions;
    assert.ok(featureActions.some((a) => a.action === 'feature-spec-revise'));
    const researchSnapshot = await engine.showResearchOrNull(repo, '21');
    const researchActions = snapshotToDashboardActions('research', '21', researchSnapshot, 'backlog').validActions;
    assert.ok(!researchActions.some((a) => a.action === 'research-spec-revise'));
}));

// REGRESSION: spec-review cycle actions must be absent for implementing entities; present for inbox/backlog
test('spec-review cycle: backlog allows, implementing blocks, labels distinct', () => {
    const hasSR = (et, lc, st) => snapshotToDashboardActions(et, '01', { entityType: et, featureId: '01', researchId: '01', currentSpecState: lc, lifecycle: lc, mode: 'solo_branch', agents: {}, winnerAgentId: null, updatedAt: new Date().toISOString() }, st).validActions.some(a => /spec-rev/.test(a.action));
    ['feature', 'research'].forEach(et => { assert.ok(hasSR(et, 'backlog', 'backlog'), `${et} backlog`); assert.ok(!hasSR(et, 'implementing', 'in-progress'), `${et} implementing`); });
    assert.deepStrictEqual(pickSpecReviewLabels('feature', 1), ['Review spec', 'Revise Spec']);
    assert.deepStrictEqual(pickSpecReviewLabels('research', 0), ['Review spec']);
});
// REGRESSION: spec-review engine write path rejects implementing lifecycle (hard fail, not silent no-op)
testAsync('spec-review engine guard rejects implementing lifecycle', () => withTempDirAsync('aigon-sr-guard-', async (repo) => {
    initRepo(repo); fs.mkdirSync(path.join(repo, 'docs/specs/features/03-in-progress'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/specs/features/03-in-progress/feature-05-test.md'), '# Feature: test\n');
    await engine.startFeature(repo, '05', 'solo_branch', ['cc']);
    await assert.rejects(() => engine.recordSpecReviewStarted(repo, 'feature', '05', { reviewerId: 'gg' }), /inbox or backlog/);
}));


testAsync('migration backfills legacy spec-review commits into workflow state', () => withTempDirAsync('aigon-spec-review-mig-', async (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test.md');
    fs.writeFileSync(specPath, '# Feature: test\n');
    execSync('git add . && git commit -qm init', { cwd: repo });
    fs.writeFileSync(specPath, '# Feature: test\n\nReviewed.\n');
    execSync('git add . && git commit -qm "spec-review: feature 12 — tighten acceptance criteria" -m "Reviewer: gg"', { cwd: repo });
    await runPendingMigrations(repo);
    const snapshot = await engine.showFeatureOrNull(repo, '12');
    assert.ok(snapshot);
    assert.deepStrictEqual([snapshot.specReview.pendingCount, snapshot.specReview.pendingAgents], [1, ['gg']]);
}));

test('research dashboard actions never emit feature-delete when snapshot lacks entityType', () => {
    // REGRESSION: deriveAvailableActions defaulted to feature — inbox delete showed feature-delete for research rows.
    const legacySnap = {
        researchId: '07',
        currentSpecState: 'inbox',
        lifecycle: 'backlog',
        mode: 'solo_branch',
        agents: {},
        winnerAgentId: null,
        updatedAt: new Date().toISOString(),
        specPath: '/tmp/research-07-x.md',
    };
    const { validActions } = snapshotToDashboardActions('research', '07', legacySnap, 'inbox');
    assert.ok(validActions.some((a) => a.action === 'research-delete'), 'expected research-delete');
    assert.ok(!validActions.some((a) => a.action === 'feature-delete'), 'must not surface feature-delete on research read path');
});

report();
