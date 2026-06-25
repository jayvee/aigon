'use strict';

const { formatDashboardActionCommand } = require('./action-command-mapper');
const { isFeatureAutonomousActive } = require('./feature-autonomous-dashboard-actions');
const { getControllerLogStatus } = require('./transcript-read');

const RECOVERY_ACTION_IDS = new Set([
    'feature-autonomous-stop',
    'feature-autonomous-resume',
    'feature-cancel-code-review',
    'feature-close',
    'feature-code-review',
    'feature-code-revise',
    'feature-reset',
    'research-cancel-code-review',
    'research-review',
]);

const FEATURE_RECOVERY_OPERATION_BY_ACTION = Object.freeze({
    'feature-autonomous-stop': 'take-over-manually',
    'feature-autonomous-resume': 'resume-automation',
    'feature-cancel-code-review': 'cancel-review',
    'feature-code-review': 'rerun-review',
    'feature-code-revise': 'start-code-revision',
    'feature-close': 'retry-close',
    'feature-reset': 'reset',
});

const DESTRUCTIVE_RECOVERY_KINDS = new Set(['reset']);

function isFeatureReviewRecoveryContext(snapshot, autoState, repoPath, featureId) {
    if (!snapshot) return false;
    const lifecycle = snapshot.currentSpecState || snapshot.lifecycle;
    if (lifecycle === 'code_review_in_progress') return true;
    if (lifecycle === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt) return true;
    if (autoState && ['failed', 'stopped', 'quota-paused'].includes(autoState.status)) return true;
    return isFeatureAutonomousActive(repoPath, featureId, autoState);
}

function isResearchReviewRecoveryContext(snapshot) {
    if (!snapshot) return false;
    return snapshot.currentSpecState === 'code_review_in_progress'
        || (snapshot.currentSpecState === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt);
}

function tagRecoveryAction(action, overrides = {}) {
    if (!action || typeof action !== 'object') return action;
    return {
        ...action,
        ...overrides,
        metadata: {
            ...(action.metadata || {}),
            recovery: true,
            ...(overrides.metadata || {}),
        },
    };
}

function isFeatureAutonomousRecoveryRelevant(autonomousController) {
    if (!autonomousController) return false;
    return ['failed', 'stopped', 'quota-paused'].includes(autonomousController.status);
}

function resolveFeatureRecommendedRecoveryKind(snapshot, autonomousController, operations) {
    const controllerKind = autonomousController && autonomousController.recommendedRecoveryKind;
    const lifecycle = snapshot && (snapshot.currentSpecState || snapshot.lifecycle);
    const hasOperation = (kind) => operations.some(operation => operation.kind === kind);

    if (autonomousController && autonomousController.staleFailureRecovered && hasOperation('resume-automation')) {
        return 'resume-automation';
    }
    if (lifecycle === 'code_review_in_progress' && hasOperation('cancel-review')) return 'cancel-review';
    if (lifecycle === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt && hasOperation('rerun-review')) return 'rerun-review';
    if (lifecycle === 'code_revision_in_progress' && hasOperation('start-code-revision')) return 'start-code-revision';
    if (controllerKind && hasOperation(controllerKind) && !DESTRUCTIVE_RECOVERY_KINDS.has(controllerKind)) return controllerKind;
    const firstSafe = operations.find(operation => !operation.destructive);
    return firstSafe ? firstSafe.kind : null;
}

function buildFeatureRecoveryOperations(actions) {
    return actions
        .map((action) => {
            const kind = FEATURE_RECOVERY_OPERATION_BY_ACTION[action.action];
            if (!kind || !(action.metadata && action.metadata.recovery)) return null;
            return {
                kind,
                action: action.action,
                label: action.label,
                command: action.command || null,
                destructive: Boolean(action.destructive || action.metadata.destructive),
                priority: action.priority || 'normal',
                available: true,
            };
        })
        .filter(Boolean);
}

function buildFeatureRecoverAction(repoPath, featureId, snapshot, autonomousController, actions) {
    if (!isFeatureAutonomousRecoveryRelevant(autonomousController)) return null;
    const operations = buildFeatureRecoveryOperations(actions);
    if (operations.length === 0) return null;
    const recommendedRecoveryKind = resolveFeatureRecommendedRecoveryKind(snapshot, autonomousController, operations);
    if (!recommendedRecoveryKind) return null;
    const controllerLog = getControllerLogStatus(repoPath, featureId);

    return {
        command: null,
        label: 'Recover',
        reason: autonomousController.reasonLabel || autonomousController.error || 'Choose an autonomous recovery operation',
        action: 'autonomous-recover',
        kind: 'autonomous-recover',
        mode: 'client',
        category: 'lifecycle',
        type: 'action',
        priority: 'high',
        clientOnly: true,
        metadata: {
            recovery: true,
            recoverySurface: true,
        },
        payload: {
            recommendedRecoveryKind,
            controllerRecommendedRecoveryKind: autonomousController.recommendedRecoveryKind || null,
            nextRecoveryKind: recommendedRecoveryKind === 'cancel-review' && operations.some(operation => operation.kind === 'rerun-review')
                ? 'rerun-review'
                : null,
            operations,
            controller: {
                status: autonomousController.status || null,
                running: Boolean(autonomousController.running),
                reason: autonomousController.reason || null,
                reasonLabel: autonomousController.reasonLabel || null,
                reasonCategory: autonomousController.reasonCategory || null,
                error: autonomousController.error || null,
                sessionName: autonomousController.sessionName || null,
                sessionRunning: Boolean(autonomousController.sessionRunning),
                startedAt: autonomousController.startedAt || null,
                updatedAt: autonomousController.updatedAt || null,
                endedAt: autonomousController.endedAt || null,
                workflowState: autonomousController.workflowState || null,
            },
            controllerLog,
        },
    };
}

function appendFeatureAutonomousResumeAction(featureId, autoState, validActions) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    if (!autoState || !['failed', 'stopped', 'quota-paused'].includes(String(autoState.status || ''))) return base;
    if (!Array.isArray(autoState.agents) || autoState.agents.length === 0) return base;
    if (base.some((action) => action.action === 'feature-autonomous-resume')) return base;
    base.push({
        command: formatDashboardActionCommand('feature-autonomous-resume', featureId),
        label: 'Resume automation',
        reason: 'Resume AutoConductor from the current workflow state',
        action: 'feature-autonomous-resume',
        kind: 'feature-autonomous-resume',
        mode: 'fire-and-forget',
        category: 'lifecycle',
        type: 'action',
        priority: 'high',
    });
    return base;
}

function appendFeatureReviewRecoveryDashboardActions(repoPath, featureId, autoState, snapshot, validActions, autonomousController = null) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    if (!isFeatureReviewRecoveryContext(snapshot, autoState, repoPath, featureId)) return base;

    const withResume = appendFeatureAutonomousResumeAction(featureId, autoState, base);

    const tagged = withResume.map((action) => {
        if (!RECOVERY_ACTION_IDS.has(action.action)) return action;
        if (action.action === 'feature-cancel-code-review') {
            return tagRecoveryAction(action, {
                label: 'Cancel code review',
                priority: 'high',
                metadata: { recoveryOperationKind: 'cancel-review' },
            });
        }
        if (action.action === 'feature-autonomous-stop') {
            const lifecycle = snapshot.currentSpecState || snapshot.lifecycle;
            return tagRecoveryAction(action, {
                ...(lifecycle === 'code_review_in_progress' ? { priority: 'high' } : {}),
                metadata: { recoveryOperationKind: 'take-over-manually' },
            });
        }
        if (action.action === 'feature-code-review' && snapshot.currentSpecState === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt) {
            return tagRecoveryAction(action, {
                label: 'Re-run code review',
                metadata: { recoveryOperationKind: 'rerun-review' },
            });
        }
        if (action.action === 'feature-code-revise') {
            return tagRecoveryAction(action, {
                metadata: { recoveryOperationKind: 'start-code-revision' },
            });
        }
        return tagRecoveryAction(action, {
            metadata: { recoveryOperationKind: FEATURE_RECOVERY_OPERATION_BY_ACTION[action.action] || null },
        });
    });
    const recoverAction = buildFeatureRecoverAction(repoPath, featureId, snapshot, autonomousController, tagged);
    return recoverAction ? [recoverAction, ...tagged] : tagged;
}

function appendResearchReviewRecoveryDashboardActions(snapshot, validActions) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    if (!isResearchReviewRecoveryContext(snapshot)) return base;

    return base.map((action) => {
        if (!RECOVERY_ACTION_IDS.has(action.action)) return action;
        if (action.action === 'research-cancel-code-review') {
            return tagRecoveryAction(action, {
                label: 'Cancel code review',
                priority: 'high',
            });
        }
        if (action.action === 'research-review' && snapshot.currentSpecState === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt) {
            return tagRecoveryAction(action, { label: 'Re-run code review' });
        }
        return tagRecoveryAction(action);
    });
}

module.exports = {
    RECOVERY_ACTION_IDS,
    isFeatureReviewRecoveryContext,
    isResearchReviewRecoveryContext,
    appendFeatureReviewRecoveryDashboardActions,
    appendResearchReviewRecoveryDashboardActions,
};
