'use strict';

const { isFeatureAutonomousActive } = require('./feature-autonomous-dashboard-actions');

const RECOVERY_ACTION_IDS = new Set([
    'feature-autonomous-stop',
    'feature-cancel-code-review',
    'feature-code-review',
    'research-cancel-code-review',
    'research-review',
]);

function isFeatureReviewRecoveryContext(snapshot, autoState, repoPath, featureId) {
    if (!snapshot) return false;
    const lifecycle = snapshot.currentSpecState || snapshot.lifecycle;
    if (lifecycle === 'code_review_in_progress') return true;
    if (lifecycle === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt) return true;
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

function appendFeatureReviewRecoveryDashboardActions(repoPath, featureId, autoState, snapshot, validActions) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    if (!isFeatureReviewRecoveryContext(snapshot, autoState, repoPath, featureId)) return base;

    return base.map((action) => {
        if (!RECOVERY_ACTION_IDS.has(action.action)) return action;
        if (action.action === 'feature-cancel-code-review') {
            return tagRecoveryAction(action, {
                label: 'Cancel code review',
                priority: 'high',
            });
        }
        if (action.action === 'feature-autonomous-stop') {
            return tagRecoveryAction(action);
        }
        if (action.action === 'feature-code-review' && snapshot.currentSpecState === 'ready' && snapshot.codeReview && snapshot.codeReview.cancelledAt) {
            return tagRecoveryAction(action, { label: 'Re-run code review' });
        }
        return tagRecoveryAction(action);
    });
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
