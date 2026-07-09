'use strict';

/**
 * F658: server-owned close readiness / blocker projection for dashboard cards.
 * Advisory and cheap — never invokes feature-close or git subprocesses.
 */

const {
    isCloseReadinessApplicable,
    hasOpenEscalationGate,
    evaluateCriteriaAttestationGate,
    isLifecycleReadyForClose,
    isInCloseRecovery,
    normalizeCloseFailureKind,
} = require('./close-gate-predicates');
const { getOpenEscalations } = require('./review-escalation');

const BLOCKER_LABELS = Object.freeze({
    'open-escalation': 'Review escalation',
    'criteria-attestation': 'Criteria attestation',
    'preauth-validation': 'Pre-auth validation',
    'post-merge-gate': 'Post-merge gate',
    'merge-conflict': 'Merge conflict',
    'close-recovery': 'Close recovery',
    'close-gate': 'Close gate',
    'autonomous-stopped': 'Review escalation',
    'eval-pick-winner': 'Pick eval winner',
    'awaiting-input': 'Needs input',
    'dependency-blocked': 'Dependency blocked',
});

function makeBlocker(kind, label, detail, actionKind, actionCommand) {
    return {
        kind,
        label: label || BLOCKER_LABELS[kind] || kind,
        detail: detail || null,
        actionKind: actionKind || null,
        actionCommand: actionCommand || null,
    };
}

function buildOpenEscalationBlockers(snapshot, featureId) {
    const open = getOpenEscalations(snapshot);
    if (open.length === 0) return [];
    const first = open[0];
    const reason = String(first.reason || '').trim();
    const preview = reason.length > 120 ? `${reason.slice(0, 117)}…` : reason;
    const countLabel = open.length === 1
        ? '1 escalation blocking close'
        : `${open.length} escalations blocking close`;
    const detail = preview
        ? `[${first.category}] ${preview}`
        : countLabel;
    const padded = String(featureId || '').trim().padStart(2, '0');
    return [makeBlocker(
        'open-escalation',
        'Review escalation',
        detail,
        'feature-escalation-accept',
        `aigon feature-escalation accept ${padded} 1`,
    )];
}

function buildCriteriaAttestationBlocker(gate, featureId) {
    if (!gate.blocked) return null;
    const indices = gate.unattested.length ? gate.unattested : gate.invalid;
    const detail = indices.length
        ? `Missing attestation for criterion index(es): ${indices.join(', ')}`
        : 'Complete ## Criteria Attestation in the implementation log';
    return makeBlocker('criteria-attestation', 'Criteria attestation', detail);
}

function buildLastCloseFailureBlocker(lcf, featureId) {
    if (!lcf) return null;
    const kind = normalizeCloseFailureKind(lcf.kind);
    const mappedKind = kind === 'close-gate' ? 'close-gate' : lcf.kind;
    let detail = lcf.reason || lcf.message || lcf.outputTail || null;
    if (mappedKind === 'criteria-attestation' && Array.isArray(lcf.unattested) && lcf.unattested.length) {
        detail = `Missing attestation for criterion index(es): ${lcf.unattested.join(', ')}`;
    }
    if (mappedKind === 'merge-conflict' && Array.isArray(lcf.conflictFiles) && lcf.conflictFiles.length) {
        detail = `Merge conflict in ${lcf.conflictFiles.join(', ')}`;
    }
    if (mappedKind === 'post-merge-gate' && lcf.gateCommand) {
        detail = lcf.gateCommand + (lcf.logPath ? ` · log: ${lcf.logPath}` : '');
    }
    if (mappedKind === 'preauth-validation' && lcf.outputTail) {
        detail = String(lcf.outputTail).trim().split('\n').slice(-3).join(' · ');
    }
    const actionKind = (mappedKind === 'merge-conflict' || mappedKind === 'post-merge-gate'
        || mappedKind === 'preauth-validation' || mappedKind === 'criteria-attestation')
        ? 'feature-resolve-and-close'
        : null;
    const padded = String(featureId || '').trim().padStart(2, '0');
    const actionCommand = actionKind ? `aigon feature-resolve-and-close ${padded}` : null;
    return makeBlocker(mappedKind, BLOCKER_LABELS[mappedKind] || mappedKind, detail, actionKind, actionCommand);
}

function buildCloseRecoveryBlocker(snapshot, featureId) {
    if (!isInCloseRecovery(snapshot)) return null;
    const lcf = snapshot.lastCloseFailure;
    if (lcf) return buildLastCloseFailureBlocker(lcf, featureId);
    return makeBlocker(
        'close-recovery',
        'Close recovery',
        'Retry close or cancel recovery',
        'feature-resolve-and-close',
        `aigon feature-resolve-and-close ${String(featureId || '').trim().padStart(2, '0')}`,
    );
}

/**
 * @param {object} entity poll row fields (agents, evalStatus, blockedBy, autonomousController, …)
 * @param {object} snapshot workflow snapshot
 * @param {object} [options] { repoPath, featureId, specPath, stage, closingInProgress }
 */
function buildCloseReadiness(entity, snapshot, options) {
    const opts = options || {};
    snapshot = snapshot || (entity && entity.workflowSnapshot) || null;
    entity = entity || {};
    const featureId = opts.featureId || entity.id;
    const applicable = isCloseReadinessApplicable(snapshot, entity);
    const blockers = [];

    if (!applicable) {
        return {
            applicable: false,
            ready: false,
            blockers: [],
            primaryBlocker: null,
            phase: null,
            closeLogHint: null,
        };
    }

    if (opts.closingInProgress || (snapshot && snapshot.currentSpecState === 'closing')) {
        return {
            applicable: true,
            ready: false,
            blockers: [],
            primaryBlocker: makeBlocker('closing', 'Closing…', null),
            phase: 'closing',
            closeLogHint: 'Watch the close log panel for live progress',
        };
    }

    blockers.push(...buildOpenEscalationBlockers(snapshot, featureId));

    const criteriaGate = evaluateCriteriaAttestationGate(
        opts.specPath || entity.specPath,
        opts.repoPath,
        featureId,
        { snapshot, worktreePath: opts.worktreePath },
    );
    const criteriaBlocker = buildCriteriaAttestationBlocker(criteriaGate, featureId);
    if (criteriaBlocker) blockers.push(criteriaBlocker);

    const controller = entity.autonomousController;
    if (!hasOpenEscalationGate(snapshot) && controller && controller.status === 'stopped' && controller.reason === 'escalation-pending') {
        blockers.push(makeBlocker(
            'autonomous-stopped',
            'Review escalation',
            controller.reasonLabel || 'Autonomous close paused for escalation disposition',
            'feature-escalation-accept',
            `aigon feature-escalation accept ${String(featureId || '').trim().padStart(2, '0')} 1`,
        ));
    }

    const recoveryBlocker = buildCloseRecoveryBlocker(snapshot, featureId);
    if (recoveryBlocker) {
        blockers.push(recoveryBlocker);
    } else if (snapshot && snapshot.lastCloseFailure && !isInCloseRecovery(snapshot)) {
        const failBlocker = buildLastCloseFailureBlocker(snapshot.lastCloseFailure, featureId);
        if (failBlocker) blockers.push(failBlocker);
    }

    const awaitAgent = (entity.agents || []).find(a => a && a.awaitingInput && a.awaitingInput.message);
    if (awaitAgent) {
        blockers.push(makeBlocker(
            'awaiting-input',
            'Needs input',
            awaitAgent.awaitingInput.message,
        ));
    }

    if (entity.evalStatus === 'pick winner' && opts.stage === 'in-evaluation') {
        blockers.push(makeBlocker(
            'eval-pick-winner',
            'Pick eval winner',
            entity.winnerAgent ? `Recommended: ${entity.winnerAgent}` : null,
            'feature-close',
            `aigon feature-close ${String(featureId || '').trim().padStart(2, '0')}`,
        ));
    }

    if (entity.stage === 'backlog' && Array.isArray(entity.blockedBy) && entity.blockedBy.length > 0) {
        const deps = entity.blockedBy.map(d => `#${String(d.id).padStart(2, '0')}`).join(', ');
        blockers.push(makeBlocker('dependency-blocked', 'Dependency blocked', `Waiting on ${deps}`));
    }

    if (snapshot && snapshot.lastCloseFailure && isInCloseRecovery(snapshot)) {
        const retryKind = snapshot.lastCloseFailure.kind;
        if (retryKind === 'preauth-validation' && !blockers.some(b => b.kind === 'preauth-validation')) {
            blockers.push(buildLastCloseFailureBlocker(snapshot.lastCloseFailure, featureId));
        }
    }

    const unique = [];
    const seen = new Set();
    for (const b of blockers) {
        const key = b.kind + ':' + (b.detail || '');
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(b);
    }

    const hasEscalations = hasOpenEscalationGate(snapshot);
    const lifecycleReady = isLifecycleReadyForClose(snapshot);
    const ready = lifecycleReady
        && unique.length === 0
        && !hasEscalations
        && !(snapshot && snapshot.lastCloseFailure && isInCloseRecovery(snapshot));

    const primaryBlocker = unique.length > 0 ? unique[0] : null;
    let closeLogHint = null;
    if (primaryBlocker && primaryBlocker.kind === 'post-merge-gate') {
        closeLogHint = (snapshot.lastCloseFailure && snapshot.lastCloseFailure.logPath) || null;
    }

    return {
        applicable: true,
        ready,
        blockers: unique,
        primaryBlocker,
        phase: primaryBlocker ? primaryBlocker.kind : (ready ? 'ready' : null),
        closeLogHint,
    };
}

function applyCloseReadinessActionPriority(validActions, closeReadiness) {
    const base = Array.isArray(validActions) ? validActions.slice() : [];
    const blocker = closeReadiness && closeReadiness.primaryBlocker;
    if (!blocker || !blocker.actionKind) return base;

    const primaryKind = blocker.actionKind;
    return base.map((va) => {
        const isPrimary = va.action === primaryKind || va.kind === primaryKind;
        if (isPrimary) return { ...va, priority: 'high' };
        if (va.priority === 'high') return { ...va, priority: 'normal' };
        return va;
    });
}

module.exports = {
    buildCloseReadiness,
    applyCloseReadinessActionPriority,
    BLOCKER_LABELS,
};
