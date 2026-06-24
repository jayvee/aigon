#!/usr/bin/env node
// REGRESSION F563: review recovery validActions surface cancel + stop automation during autonomous review trouble.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report, seedEntityDirs, writeSpec, writeSnap } = require('../_helpers');
const { readFeatureAutoState } = require('../../lib/auto-session-state');
const wrm = require('../../lib/workflow-read-model');
const {
    appendFeatureReviewRecoveryDashboardActions,
    isFeatureReviewRecoveryContext,
} = require('../../lib/feature-review-recovery-dashboard-actions');

function writeAutoState(repo, featureId, payload) {
    const autoPath = path.join(repo, '.aigon', 'state', `feature-${featureId}-auto.json`);
    fs.mkdirSync(path.dirname(autoPath), { recursive: true });
    fs.writeFileSync(autoPath, JSON.stringify({
        featureId,
        ...payload,
    }, null, 2));
}

test('recovery context is true for autonomous running or code review in progress', () => withTempDir('aigon-f563-recovery-', (repo) => {
    const autoState = { status: 'running', running: true };
    const snapReview = { currentSpecState: 'code_review_in_progress', lifecycle: 'code_review_in_progress' };
    const snapReady = { currentSpecState: 'ready', lifecycle: 'ready' };
    const snapCancelled = { currentSpecState: 'ready', lifecycle: 'ready', codeReview: { cancelledAt: '2026-06-18T00:00:00Z' } };
    assert.strictEqual(isFeatureReviewRecoveryContext(snapReview, null, repo, '563'), true);
    assert.strictEqual(isFeatureReviewRecoveryContext(snapReady, autoState, repo, '563'), true);
    assert.strictEqual(isFeatureReviewRecoveryContext(snapCancelled, null, repo, '563'), true);
    assert.strictEqual(isFeatureReviewRecoveryContext(snapReady, { status: 'stopped', running: false }, repo, '563'), true);
    assert.strictEqual(isFeatureReviewRecoveryContext(snapReady, { status: 'completed', running: false }, repo, '563'), false);
}));

test('recovery actions promote cancel code review and tag metadata', () => withTempDir('aigon-f563-recovery-', (repo) => {
    const snapshot = { currentSpecState: 'code_review_in_progress', lifecycle: 'code_review_in_progress' };
    const merged = appendFeatureReviewRecoveryDashboardActions(repo, '563', null, snapshot, [
        { action: 'feature-cancel-code-review', label: 'Cancel review', priority: 'normal' },
        { action: 'feature-code-review', label: 'Code Review', mode: 'agent' },
    ]);
    const cancel = merged.find((a) => a.action === 'feature-cancel-code-review');
    assert.ok(cancel, 'cancel action present');
    assert.strictEqual(cancel.label, 'Cancel code review');
    assert.strictEqual(cancel.priority, 'high');
    assert.strictEqual(cancel.metadata.recovery, true);
}));

test('ready-after-cancel re-tags code review as re-run review', () => withTempDir('aigon-f563-recovery-', (repo) => {
    const snapshot = {
        currentSpecState: 'ready',
        lifecycle: 'ready',
        codeReview: { cancelledAt: '2026-06-18T00:00:00Z' },
    };
    const merged = appendFeatureReviewRecoveryDashboardActions(repo, '563', null, snapshot, [
        { action: 'feature-code-review', label: 'Code Review', mode: 'agent' },
    ]);
    assert.strictEqual(merged[0].label, 'Re-run code review');
    assert.strictEqual(merged[0].metadata.recovery, true);
}));

test('read-model exposes recovery actions for autonomous review trouble', () => withTempDir('aigon-f563-recovery-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-563-dashboard-review-recovery-flow.md');
    writeSnap(repo, 'features', '563', 'code_review_in_progress');
    const autoPath = path.join(repo, '.aigon', 'state', 'feature-563-auto.json');
    fs.mkdirSync(path.dirname(autoPath), { recursive: true });
    fs.writeFileSync(autoPath, JSON.stringify({
        featureId: '563',
        status: 'running',
        running: true,
        sessionName: 'aigon-f563-auto',
    }, null, 2));

    const dashboard = wrm.getFeatureDashboardState(repo, '563', 'in-progress', []);
    const actions = dashboard.validActions || [];
    const stop = actions.find((a) => a.action === 'feature-autonomous-stop');
    const cancel = actions.find((a) => a.action === 'feature-cancel-code-review');
    assert.ok(stop, 'stop automation exposed');
    assert.strictEqual(stop.label, 'Stop automation');
    assert.strictEqual(stop.priority, 'high');
    assert.ok(cancel, 'cancel code review exposed');
    assert.strictEqual(cancel.label, 'Cancel code review');
    assert.ok(cancel.metadata && cancel.metadata.recovery);
    assert.ok(readFeatureAutoState(repo, '563').running);
}));

test('failed autonomous review exposes Recover payload and keeps primitive peers visible', () => withTempDir('aigon-f568-recovery-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-560-review-recovery.md');
    writeSnap(repo, 'features', '560', 'code_review_in_progress');
    writeAutoState(repo, '560', {
        status: 'failed',
        running: false,
        reason: 'review-exited-without-signal',
        error: { message: 'review died' },
        reviewAgent: 'cx',
        agents: ['cu'],
    });

    const dashboard = wrm.getFeatureDashboardState(repo, '560', 'in-progress', []);
    const actions = dashboard.validActions || [];
    const recover = actions.find((a) => a.action === 'autonomous-recover');
    assert.ok(recover, 'recover action present');
    assert.strictEqual(recover.clientOnly, true);
    assert.strictEqual(recover.payload.recommendedRecoveryKind, 'cancel-review');
    assert.strictEqual(recover.payload.controllerRecommendedRecoveryKind, 'rerun-review');
    assert.strictEqual(recover.payload.nextRecoveryKind, 'rerun-review');
    assert.ok(recover.payload.operations.some((op) => op.kind === 'cancel-review' && op.action === 'feature-cancel-code-review'));

    const cancel = actions.find((a) => a.action === 'feature-cancel-code-review');
    assert.ok(cancel, 'cancel primitive remains visible');
    assert.strictEqual(cancel.metadata.recovery, true);
    assert.strictEqual(cancel.metadata.recoveryOperationKind, 'cancel-review');
}));

test('stopped autonomous controller exposes manual recovery operations', () => withTempDir('aigon-f568-recovery-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-568-stopped.md');
    writeSnap(repo, 'features', '568', 'ready');
    writeAutoState(repo, '568', {
        status: 'stopped',
        running: false,
        reason: 'stopped-by-user',
        agents: ['cx'],
    });

    const dashboard = wrm.getFeatureDashboardState(repo, '568', 'in-progress', []);
    const recover = (dashboard.validActions || []).find((a) => a.action === 'autonomous-recover');
    assert.ok(recover, 'recover action present for stopped controller');
    assert.strictEqual(recover.payload.recommendedRecoveryKind, 'retry-close');
    assert.ok(recover.payload.operations.some((op) => op.kind === 'retry-close' && op.action === 'feature-close'));
}));

test('running autonomous controller keeps primitive recovery tags but no grouped Recover payload', () => withTempDir('aigon-f568-recovery-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-568-running.md');
    writeSnap(repo, 'features', '568', 'code_review_in_progress');
    writeAutoState(repo, '568', {
        status: 'running',
        running: true,
        sessionName: 'aigon-f568-auto',
    });

    const dashboard = wrm.getFeatureDashboardState(repo, '568', 'in-progress', []);
    const actions = dashboard.validActions || [];
    assert.ok(!actions.some((a) => a.action === 'autonomous-recover'));
    assert.ok(actions.some((a) => a.action === 'feature-cancel-code-review' && a.metadata && a.metadata.recovery));
}));

test('non-autonomous feature action behavior remains unchanged', () => withTempDir('aigon-f568-recovery-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-999-normal.md');
    writeSnap(repo, 'features', '999', 'implementing');

    const dashboard = wrm.getFeatureDashboardState(repo, '999', 'in-progress', []);
    const actions = dashboard.validActions || [];
    assert.ok(!actions.some((a) => a.action === 'autonomous-recover'));
    assert.ok(!actions.some((a) => a.metadata && a.metadata.recovery));
}));

report();
