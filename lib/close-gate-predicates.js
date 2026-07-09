'use strict';

/**
 * Shared sync close-gate predicates — imported by feature-close enforcement
 * and buildCloseReadiness projection. Drift between the two is a bug here.
 */

const { getOpenEscalations } = require('./review-escalation');
const CLOSE_RELEVANT_LIFECYCLES = Object.freeze([
    'ready',
    'close_recovery_in_progress',
    'closing',
]);

const KNOWN_CLOSE_FAILURE_KINDS = Object.freeze(new Set([
    'preauth-validation',
    'post-merge-gate',
    'merge-conflict',
]));

function isInCloseRecovery(snapshot) {
    return Boolean(snapshot && snapshot.currentSpecState === 'close_recovery_in_progress');
}

function isPostMergeGateRetry(snapshot) {
    return Boolean(
        snapshot
        && snapshot.currentSpecState === 'close_recovery_in_progress'
        && snapshot.lastCloseFailure
        && snapshot.lastCloseFailure.kind === 'post-merge-gate',
    );
}

function isPreauthValidationRetry(snapshot) {
    return Boolean(
        snapshot
        && snapshot.currentSpecState === 'close_recovery_in_progress'
        && snapshot.lastCloseFailure
        && snapshot.lastCloseFailure.kind === 'preauth-validation',
    );
}

function isCloseReadinessApplicable(snapshot, entity) {
    if (!snapshot) return false;
    const lifecycle = snapshot.currentSpecState || snapshot.lifecycle;
    if (CLOSE_RELEVANT_LIFECYCLES.includes(lifecycle)) return true;
    if (snapshot.lastCloseFailure) return true;
    if (getOpenEscalations(snapshot).length > 0) return true;
    if (snapshot.closeRecovery) return true;
    const controller = entity && entity.autonomousController;
    if (controller && controller.status === 'stopped' && controller.reason === 'escalation-pending') {
        return true;
    }
    return false;
}

function hasOpenEscalationGate(snapshot) {
    return getOpenEscalations(snapshot).length > 0;
}

function isLifecycleReadyForClose(snapshot) {
    if (!snapshot) return false;
    const lifecycle = snapshot.currentSpecState || snapshot.lifecycle;
    return lifecycle === 'ready' || lifecycle === 'close_recovery_in_progress';
}

function normalizeCloseFailureKind(kind) {
    if (!kind) return 'close-gate';
    return KNOWN_CLOSE_FAILURE_KINDS.has(kind) ? kind : 'close-gate';
}

module.exports = {
    CLOSE_RELEVANT_LIFECYCLES,
    KNOWN_CLOSE_FAILURE_KINDS,
    isInCloseRecovery,
    isPostMergeGateRetry,
    isPreauthValidationRetry,
    isCloseReadinessApplicable,
    hasOpenEscalationGate,
    isLifecycleReadyForClose,
    normalizeCloseFailureKind,
};
