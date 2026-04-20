#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, withTempDir, withTempDirAsync, report } = require('../_helpers');
const workflowEngine = require('../../lib/workflow-core/engine');
const { applySpecReviewStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');
const { runPendingMigrations } = require('../../lib/migration');

const DIRS = [
    'docs/specs/features/01-inbox',
    'docs/specs/features/02-backlog',
    'docs/specs/research-topics/01-inbox',
    'docs/specs/research-topics/02-backlog',
];

function initRepo(repo) {
    DIRS.forEach(d => fs.mkdirSync(path.join(repo, d), { recursive: true }));
    execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: repo });
}

function mkItem(id, stage, specPath) {
    return [{ id, stage, specPath, updatedAt: new Date().toISOString(), validActions: [], nextActions: [] }];
}

function syntheticContext(entityType, stage, pendingCount) {
    return {
        entityType,
        featureId: '12',
        currentSpecState: stage,
        lifecycle: stage,
        mode: 'solo_branch',
        agents: {},
        winnerAgentId: null,
        updatedAt: new Date().toISOString(),
        specReview: {
            pendingCount,
            pendingAgents: pendingCount > 0 ? ['gg'] : [],
            pendingLabel: pendingCount > 0 ? `${pendingCount} pending — gg` : '',
            pendingReviews: pendingCount > 0 ? [{ reviewId: 'sha1', reviewerId: 'gg', summary: 'tighten spec' }] : [],
        },
    };
}

testAsync('feature backlog cards surface pending spec-review badge and actions from workflow state', () => withTempDirAsync('aigon-spec-review-', async (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test.md');
    fs.writeFileSync(specPath, '# Feature: test\n');
    await workflowEngine.recordSpecReviewSubmitted(repo, 'feature', '12', {
        reviewId: 'sha-review-1',
        reviewerId: 'gg',
        summary: 'tighten acceptance criteria',
        commitSha: 'sha-review-1',
    });

    const items = mkItem('12', 'backlog', specPath);
    clearTierCache(repo);
    applySpecReviewStatus(repo, items, []);

    assert.strictEqual(items[0].specReview.pendingCount, 1);
    assert.deepStrictEqual(items[0].specReview.pendingAgents, ['gg']);
    assert.ok(items[0].validActions.some(a => a.action === 'feature-spec-review'));
    assert.ok(items[0].validActions.some(a => a.action === 'feature-spec-review-check'));
}));

testAsync('acknowledgement clears pending spec-review state', () => withTempDirAsync('aigon-spec-review-', async (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/research-topics/02-backlog/research-21-topic.md');
    fs.writeFileSync(specPath, '# Research: topic\n');
    await workflowEngine.recordSpecReviewSubmitted(repo, 'research', '21', {
        reviewId: 'sha-review-1',
        reviewerId: 'cc',
        summary: 'tighten questions',
        commitSha: 'sha-review-1',
    });
    await workflowEngine.recordSpecReviewAcknowledged(repo, 'research', '21', {
        commitSha: 'sha-ack-1',
    });

    const items = mkItem('21', 'backlog', specPath);
    clearTierCache(repo);
    applySpecReviewStatus(repo, [], items);

    assert.strictEqual(items[0].specReview.pendingCount, 0);
    assert.ok(items[0].validActions.some(a => a.action === 'research-spec-review'));
    assert.ok(!items[0].validActions.some(a => a.action === 'research-spec-review-check'));
}));

test('feature and research spec-review actions keep distinct labels', () => {
    const featurePending = snapshotToDashboardActions('feature', '12', syntheticContext('feature', 'backlog', 1)).validActions;
    const researchPending = snapshotToDashboardActions('research', '12', syntheticContext('research', 'backlog', 1)).validActions;
    const featureNone = snapshotToDashboardActions('feature', '12', syntheticContext('feature', 'backlog', 0)).validActions;
    const researchNone = snapshotToDashboardActions('research', '12', syntheticContext('research', 'backlog', 0)).validActions;

    assert.deepStrictEqual(featurePending.map(a => a.label), ['Review spec', 'Check spec review']);
    assert.deepStrictEqual(researchPending.map(a => a.label), ['Review spec', 'Check spec review']);
    assert.deepStrictEqual(featureNone.map(a => a.label), ['Review spec']);
    assert.deepStrictEqual(researchNone.map(a => a.label), ['Review spec']);
});

testAsync('migration backfills legacy spec-review commits into workflow state', () => withTempDirAsync('aigon-spec-review-mig-', async (repo) => {
    initRepo(repo);
    const specPath = path.join(repo, 'docs/specs/features/02-backlog/feature-12-test.md');
    fs.writeFileSync(specPath, '# Feature: test\n');
    execSync('git add . && git commit -qm init', { cwd: repo });
    fs.writeFileSync(specPath, '# Feature: test\n\nReviewed.\n');
    execSync('git add . && git commit -qm "spec-review: feature 12 — tighten acceptance criteria" -m "Reviewer: gg"', { cwd: repo });

    await runPendingMigrations(repo);

    const snapshot = await workflowEngine.showFeatureOrNull(repo, '12');
    assert.ok(snapshot);
    assert.strictEqual(snapshot.specReview.pendingCount, 1);
    assert.deepStrictEqual(snapshot.specReview.pendingAgents, ['gg']);
}));

report();
