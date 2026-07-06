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
    const review = merged.find((a) => a.action === 'feature-code-review');
    assert.ok(review);
    assert.strictEqual(review.label, 'Run Review');
    assert.strictEqual(review.metadata.recovery, true);
    assert.strictEqual(review.metadata.recoverySurface, true);
}));

// REGRESSION: implementation-complete must satisfy review/close guards (not only literal ready).
test('allAgentsSubmitted accepts implementation-complete', () => {
    const { allAgentsSubmitted, allAgentsReady } = require('../../lib/state-queries');
    const ctx = { agentStatuses: { cu: 'implementation-complete' } };
    assert.strictEqual(allAgentsSubmitted(ctx), true);
    assert.strictEqual(allAgentsReady(ctx), false);
});

test('review-quota-paused on ready injects surfaced Run Review', () => withTempDir('aigon-quota-review-', (repo) => {
    const snapshot = {
        currentSpecState: 'ready',
        lifecycle: 'ready',
        codeReview: { cancelledAt: '2026-07-06T02:56:34.439Z' },
    };
    const autoState = { status: 'stopped', reason: 'review-quota-paused', agents: ['cu'] };
    const autonomousController = {
        status: 'stopped',
        reason: 'review-quota-paused',
        reasonLabel: 'Reviewer quota paused (review cancelled — pick a new reviewer)',
        recommendedRecoveryKind: 'rerun-review',
        staleFailureRecovered: true,
    };
    const merged = appendFeatureReviewRecoveryDashboardActions(repo, '611', autoState, snapshot, [], autonomousController);
    const runReview = merged.find((a) => a.action === 'feature-code-review');
    assert.ok(runReview, 'Run Review injected');
    assert.strictEqual(runReview.label, 'Run Review');
    assert.strictEqual(runReview.metadata.recoverySurface, true);
    const recover = merged.find((a) => a.action === 'autonomous-recover');
    assert.ok(recover, 'recover action present');
    assert.strictEqual(recover.payload.recommendedRecoveryKind, 'rerun-review');
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
        sessionName: 'aigon-f560-auto',
        updatedAt: '2026-06-18T02:00:00Z',
        workflowState: 'code_review_in_progress',
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
    assert.strictEqual(recover.payload.controller.status, 'failed');
    assert.strictEqual(recover.payload.controller.reason, 'review-exited-without-signal');
    assert.strictEqual(recover.payload.controller.reasonLabel, 'Reviewer exited without signaling');
    assert.strictEqual(recover.payload.controller.sessionName, 'aigon-f560-auto');
    assert.strictEqual(recover.payload.controller.sessionRunning, false);
    assert.strictEqual(recover.payload.controller.updatedAt, '2026-06-18T02:00:00Z');
    assert.strictEqual(recover.payload.controller.workflowState, 'code_review_in_progress');
    assert.strictEqual(recover.payload.controllerLog.available, false);
    assert.match(recover.payload.controllerLog.reason, /Controller log is not available/);
    assert.ok(recover.payload.operations.some((op) => op.kind === 'cancel-review' && op.action === 'feature-cancel-code-review'));

    const cancel = actions.find((a) => a.action === 'feature-cancel-code-review');
    assert.ok(cancel, 'cancel primitive remains visible');
    assert.strictEqual(cancel.metadata.recovery, true);
    assert.strictEqual(cancel.metadata.recoveryOperationKind, 'cancel-review');
}));

test('failed autonomous review exposes available controller log metadata', () => withTempDir('aigon-f570-recovery-log-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-570-controller-log.md');
    writeSnap(repo, 'features', '570', 'code_review_in_progress');
    writeAutoState(repo, '570', {
        status: 'failed',
        running: false,
        reason: 'review-exited-without-signal',
        sessionName: 'aigon-f570-auto',
        updatedAt: '2026-06-18T02:00:00Z',
        workflowState: 'code_review_in_progress',
    });
    const logPath = path.join(repo, '.aigon', 'transcripts', 'features', '570', 'auto', 'auto-log.tmux.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, 'controller failed\nreviewer exited\n');
    const sessionsDir = path.join(repo, '.aigon', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'aigon-f570-auto.json'), JSON.stringify({
        category: 'entity',
        sessionName: 'aigon-f570-auto',
        repoPath: repo,
        worktreePath: repo,
        entityType: 'f',
        entityId: '570',
        role: 'auto',
        agent: 'auto',
        createdAt: '2026-06-18T01:59:00Z',
        tmuxLogPath: logPath,
    }, null, 2));

    const dashboard = wrm.getFeatureDashboardState(repo, '570', 'in-progress', []);
    const recover = (dashboard.validActions || []).find((a) => a.action === 'autonomous-recover');
    assert.ok(recover, 'recover action present');
    assert.deepStrictEqual(recover.payload.controllerLog, {
        available: true,
        sessionName: 'aigon-f570-auto',
        createdAt: '2026-06-18T01:59:00Z',
    });
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

// REGRESSION F588/F576: stale review-timeout after review completed recommends resume not rerun-review
test('stale review-timeout reconciles to resume-automation when review since completed', () => withTempDir('aigon-f588-stale-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-576-specstore-local-adapter.md');
    const snapPath = path.join(repo, '.aigon', 'workflows', 'features', '576', 'snapshot.json');
    fs.mkdirSync(path.dirname(snapPath), { recursive: true });
    fs.writeFileSync(snapPath, JSON.stringify({
        currentSpecState: 'ready',
        lifecycle: 'ready',
        codeReview: { reviewCompletedAt: '2026-06-20T12:00:00Z', requestRevision: false },
        agents: { cu: { status: 'ready' } },
    }, null, 2));
    writeAutoState(repo, '576', {
        status: 'failed',
        running: false,
        reason: 'review-timeout',
        updatedAt: '2026-06-20T10:00:00Z',
        agents: ['cu'],
        reviewAgent: 'cx',
        stopAfter: 'close',
    });

    const dashboard = wrm.getFeatureDashboardState(repo, '576', 'in-progress', []);
    const recover = (dashboard.validActions || []).find((a) => a.action === 'autonomous-recover');
    assert.ok(recover, 'recover action present');
    assert.strictEqual(recover.payload.recommendedRecoveryKind, 'resume-automation');
    assert.strictEqual(dashboard.autonomousController.recommendedRecoveryKind, 'resume-automation');
    assert.strictEqual(dashboard.autonomousController.staleFailureRecovered, true);
    const resume = (dashboard.validActions || []).find((a) => a.action === 'feature-autonomous-resume');
    assert.ok(resume, 'resume automation action exposed');
}));

report();
