'use strict';

/**
 * F650: dashboard card presentation model — pure derivation from poll row fields.
 * Converts cardHeadline + lifecycle facts into one dominant state, quiet timeline,
 * suppression flags, and action/recovery hints. Shared by monitor, pipeline, set cards.
 *
 * Contract: docs/dashboard-card-design.md
 */

const SEVERITY_FROM_TONE = Object.freeze({
    warn: 'error',
    blocked: 'error',
    attention: 'warning',
    waiting: 'warning',
    running: 'running',
    ready: 'ready',
    done: 'done',
    idle: 'idle',
});

const STAGE_TIMELINE_LABELS = Object.freeze({
    implement: 'Implemented',
    review: 'Reviewed',
    revision: 'Revision complete',
    eval: 'Evaluated',
    close: 'Close attempted',
});

function agentUpper(id) {
    return id ? String(id).toUpperCase() : '?';
}

function pushTimelineUnique(timeline, entry) {
    const key = entry.status + ':' + entry.label;
    if (timeline.some(t => t.status + ':' + t.label === key)) return;
    timeline.push(entry);
}

/**
 * @param {object} entity feature/research/feedback poll row (must include cardHeadline when available)
 * @param {object} [options] { entityType }
 */
function buildCardPresentation(entity, options) {
    const opts = options || {};
    const entityType = opts.entityType || entity.entityType || 'feature';
    const headline = entity.cardHeadline || null;
    const headlineVerb = headline && headline.verb ? headline.verb : null;
    const severity = headline ? (SEVERITY_FROM_TONE[headline.tone] || 'idle') : 'idle';
    const isFailureState = severity === 'error';

    const agents = Array.isArray(entity.agents) ? entity.agents : [];
    const reviews = entity.reviewSessionSummary || entity.reviewSessions || [];
    const cycles = Array.isArray(entity.reviewCycles)
        ? entity.reviewCycles.filter(c => c && c.type === 'code')
        : [];
    const lcf = entity.lastCloseFailure || null;
    const controller = entity.autonomousController || null;
    const plan = entity.autonomousPlan || null;
    const closeRecovery = entity.closeRecovery || null;
    const closeReadiness = entity.closeReadiness || null;

    const timeline = [];

    agents.forEach((a) => {
        if (!a || !a.id) return;
        if (a.status === 'revision-complete') {
            pushTimelineUnique(timeline, {
                status: 'complete',
                label: 'Revision complete',
                detail: 'by ' + agentUpper(a.id),
            });
        } else if (a.status === 'implementation-complete' || a.status === 'research-complete') {
            const label = entityType === 'research' ? 'Research complete' : 'Implemented';
            pushTimelineUnique(timeline, {
                status: 'complete',
                label,
                detail: 'by ' + agentUpper(a.id),
            });
        } else if (a.status === 'ready') {
            const label = entityType === 'research' ? 'Research ready' : 'Implemented';
            pushTimelineUnique(timeline, {
                status: 'complete',
                label,
                detail: 'by ' + agentUpper(a.id),
            });
        } else if (a.status === 'review-complete' || a.status === 'spec-review-complete') {
            const label = a.status === 'spec-review-complete' ? 'Spec reviewed' : 'Reviewed';
            pushTimelineUnique(timeline, {
                status: 'complete',
                label,
                detail: 'by ' + agentUpper(a.id),
            });
        }
    });

    cycles.forEach((c) => {
        pushTimelineUnique(timeline, {
            status: 'complete',
            label: 'Reviewed',
            detail: 'by ' + agentUpper(c.reviewer),
        });
    });

    (Array.isArray(reviews) ? reviews : []).forEach((r) => {
        if (!r || r.running) return;
        const approved = r.requestRevision === false;
        pushTimelineUnique(timeline, {
            status: 'complete',
            label: approved ? 'Review approved' : 'Review complete',
            detail: 'by ' + agentUpper(r.agent),
        });
    });

    if (plan && Array.isArray(plan.stages)) {
        plan.stages.filter(s => s && s.status === 'complete').forEach((s) => {
            const label = STAGE_TIMELINE_LABELS[s.type] || s.label || s.type || 'Stage complete';
            pushTimelineUnique(timeline, { status: 'complete', label });
        });
        const failedStage = plan.stages.find(s => s && s.status === 'failed');
        if (failedStage && headlineVerb !== 'Close failed' && headlineVerb !== 'Autonomous failed') {
            const raw = STAGE_TIMELINE_LABELS[failedStage.type] || failedStage.label || failedStage.type || 'Stage';
            pushTimelineUnique(timeline, {
                status: 'failed',
                label: String(raw).replace(/ complete$/i, '') + ' failed',
            });
        }
    }

    if (lcf && headlineVerb === 'Close failed') {
        pushTimelineUnique(timeline, { status: 'failed', label: 'Close failed' });
    }

    let contextLine = null;
    if (headlineVerb === 'Close failed') {
        const hadReview = timeline.some(t => /^Review/.test(t.label));
        if (lcf && lcf.kind === 'merge-conflict' && Array.isArray(lcf.conflictFiles) && lcf.conflictFiles.length > 0) {
            contextLine = 'Merge conflict in ' + lcf.conflictFiles.join(', ');
        } else if (hadReview) {
            contextLine = 'Feature close failed after review approval.';
        } else {
            contextLine = (headline && headline.detail) ? headline.detail : 'Feature close failed.';
        }
    } else if (headlineVerb === 'Autonomous failed' && controller) {
        contextLine = controller.reasonLabel || controller.error || headline.detail || null;
    } else if (headlineVerb === 'Recovering close') {
        contextLine = 'Retry close or cancel recovery.';
    } else if (headline && headline.detail && headlineVerb !== 'Needs you') {
        contextLine = headline.detail;
    }

    let agentSummary = null;
    if (agents.length > 0 && (isFailureState || agents.length > 1)) {
        const parts = agents.map((a) => {
            const name = agentUpper(a.id);
            if (!a) return name;
            if (a.status === 'review-complete' || a.status === 'spec-review-complete') return name + ' approved';
            if (a.status === 'ready') return name + ' ready';
            if (a.isWorking) return name + ' running';
            if (a.status === 'implementing' || a.status === 'researching') return name + ' implementing';
            if (a.flags && a.flags.sessionEnded) return name + ' exited';
            if (a.status) return name + ' ' + String(a.status).replace(/-/g, ' ');
            return name;
        }).filter(Boolean);
        if (parts.length) agentSummary = parts.join(' · ');
    }

    const reviewsComplete = reviews.length > 0 && reviews.every(r => r && !r.running);
    const closeBlocked = closeReadiness && closeReadiness.applicable && !closeReadiness.ready;
    const suppress = {
        closeFailurePanel: headlineVerb === 'Close failed'
            || (closeBlocked && headlineVerb && headlineVerb.startsWith('Blocked:')),
        readyToClose: closeReadiness && closeReadiness.applicable
            ? !closeReadiness.ready
            : (Boolean(lcf) || isFailureState || headlineVerb === 'Recovering close'),
        autonomousController: headlineVerb === 'Close failed'
            || (closeBlocked && headlineVerb && headlineVerb.startsWith('Blocked:'))
            || (headlineVerb === 'Autonomous failed' && controller && controller.status === 'failed'),
        reviewerPanels: isFailureState && reviewsComplete,
        reviewCycleHistory: isFailureState && cycles.length > 0,
    };

    const compactAgents = isFailureState && agents.length > 0 && agents.length <= 4;
    const staleCodeReview = (Array.isArray(reviews) ? reviews : []).some(
        (r) => r && (r.status === 'session-lost' || (r.running === false && r.status === 'in-progress')),
    );
    const showRecoveryActions = isFailureState
        || Boolean(closeRecovery)
        || headlineVerb === 'Recovering close'
        || (controller && controller.status === 'failed')
        || staleCodeReview;

    return {
        severity,
        contextLine,
        timeline,
        agentSummary,
        suppress,
        compactAgents,
        showRecoveryActions,
    };
}

module.exports = {
    buildCardPresentation,
    SEVERITY_FROM_TONE,
};
