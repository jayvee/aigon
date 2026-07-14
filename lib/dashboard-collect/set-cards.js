'use strict';

const fs = require('fs');
const { parseFrontMatter } = require('../cli-parse');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const featureSets = require('../feature-sets');
const {
    safeSetAutoSessionExists,
    safeSetSpecReviewSessionExists,
    safeSetSpecRevisionSessionExists,
} = require('../dashboard-status-helpers');
const { buildSetValidActions } = require('../feature-set-workflow-rules');
const {
    countReviewableSetMembers,
    countLaunchableSetSpecReviewMembers,
} = require('../feature-set-spec-review');
const { countPendingSpecReviseMembers } = require('../feature-set-spec-revise');
const { isProAvailable } = require('../pro');
const { buildEntityDisplayKey } = require('./safe-reads');

function summarizeReviewSessions(sessions) {
    return (Array.isArray(sessions) ? sessions : []).map(session => ({
        agent: session.agent || session.agentId || null,
        session: session.session || null,
        running: Boolean(session.running),
        sessionRunning: session.sessionRunning != null ? Boolean(session.sessionRunning) : Boolean(session.running),
        status: session.status || null,
        statusCls: session.statusCls || null,
        startedAt: session.startedAt || null,
        completedAt: session.completedAt || null,
        requestRevision: session.requestRevision != null ? Boolean(session.requestRevision) : null,
    }));
}

// F590: the lean list shape for a `done` feature. Done features never carry the
// heavy per-entity detail (agents, detailFingerprint, startupReadiness,
// cardHeadline, stateRenderMeta, validActions, …) on the poll path — that lives
// behind /api/feature/:id/details (F469). Both enrichment loops and the
// extraDone mapper share this so the shape stays identical (F459 invariant).
function buildLeanDoneFeatureRow({ id, name, specPath, updatedAt, createdAt, set = null, logPaths = [] }) {
    return {
        id,
        displayKey: buildEntityDisplayKey('feature', id),
        name,
        stage: 'done',
        specPath,
        updatedAt,
        createdAt,
        set: set || null,
        logPaths: logPaths || [],
    };
}

function readSetGoal(members) {
    for (const member of Array.isArray(members) ? members : []) {
        if (!member || !member.fullPath) continue;
        try {
            const raw = fs.readFileSync(member.fullPath, 'utf8');
            const { data } = parseFrontMatter(raw);
            if (data && data.goal) return String(data.goal).trim();
        } catch (_) { /* ignore */ }
    }
    return '';
}

function isStaleSetMemberFailure(id, autoState, snapshot) {
    if (!id || !autoState || !snapshot) return false;
    const failedIds = new Set(Array.isArray(autoState.failed) ? autoState.failed.map(String) : []);
    const inFailed = failedIds.has(id) || String(autoState.failedFeature || '') === id;
    if (!inFailed) return false;
    const lifecycle = String(snapshot.currentSpecState || snapshot.lifecycle || '');
    const reviewCompletedAt = snapshot.codeReview && snapshot.codeReview.reviewCompletedAt;
    if (reviewCompletedAt && (lifecycle === 'ready' || lifecycle === 'code_revision_in_progress' || lifecycle === 'closing')) {
        return true;
    }
    return lifecycle === 'done';
}

function buildSetMemberState(member, snapshot, autoState, doneIds, blockedIds) {
    const id = member && member.paddedId ? String(member.paddedId) : '';
    const lifecycle = String(snapshot && (snapshot.currentSpecState || snapshot.lifecycle) || member.stage || '');
    const failedIds = new Set(Array.isArray(autoState && autoState.failed) ? autoState.failed.map(String) : []);
    const failedFeature = autoState && autoState.failedFeature ? String(autoState.failedFeature) : '';
    if (id && !isStaleSetMemberFailure(id, autoState, snapshot) && (failedIds.has(id) || failedFeature === id || member.stage === 'paused')) return 'failed';
    if (id && doneIds.has(id)) return 'done';
    if (lifecycle === 'done' || member.stage === 'done') return 'done';
    if (lifecycle === 'code_review_in_progress' || lifecycle === 'code_revision_in_progress' || lifecycle === 'ready_for_review' || member.stage === 'in-evaluation') return 'in-review';
    if (lifecycle === 'implementing' || lifecycle === 'ready' || lifecycle === 'evaluating' || lifecycle === 'closing' || member.stage === 'in-progress') return 'in-progress';
    if (id && blockedIds.has(id)) return 'blocked';
    return 'backlog';
}

function humanizeSetEvent(reason, status) {
    const raw = String(reason || status || '').trim();
    if (!raw) return '';
    return raw
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, ch => ch.toUpperCase());
}

function hasActiveSpecReview(snapshot) {
    const active = snapshot && snapshot.specReview && Array.isArray(snapshot.specReview.activeReviewers)
        ? snapshot.specReview.activeReviewers
        : [];
    return active.length > 0 || String(snapshot && (snapshot.currentSpecState || snapshot.lifecycle) || '') === 'spec_review_in_progress';
}

function hasActiveSpecRevision(snapshot) {
    const active = snapshot && snapshot.specReview && Array.isArray(snapshot.specReview.activeCheckers)
        ? snapshot.specReview.activeCheckers
        : [];
    return active.length > 0
        || Boolean(snapshot && snapshot.activeSpecRevision)
        || String(snapshot && (snapshot.currentSpecState || snapshot.lifecycle) || '') === 'spec_revision_in_progress';
}

function newestCommit(commits) {
    return (Array.isArray(commits) ? commits : [])
        .filter(Boolean)
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] || null;
}

function latestEvent(events, predicate) {
    return (Array.isArray(events) ? events : [])
        .filter(predicate)
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] || null;
}

function isReviewCompleteEvent(event) {
    return event && (event.type === 'feature.spec_review.completed' || event.type === 'spec_review.submitted');
}

function isRevisionCompleteEvent(event) {
    return event && (event.type === 'feature.spec_revision.completed' || event.type === 'spec_review.acked');
}

function buildSetSpecCycleSummary({
    members,
    memberSnapshots,
    memberEvents,
    specReviewSession,
    specRevisionSession,
    pendingSpecReviseMemberCount,
    launchableSpecReviewMemberCount,
}) {
    const reviewCompletions = [];
    const revisionCompletions = [];
    const eventMap = memberEvents instanceof Map ? memberEvents : new Map();
    for (const member of Array.isArray(members) ? members : []) {
        if (!member || !member.paddedId) continue;
        const events = eventMap.get(String(member.paddedId)) || [];
        const review = latestEvent(events, isReviewCompleteEvent);
        if (review) {
            reviewCompletions.push({
                at: review.at || null,
                sha: review.commitSha || review.reviewId || null,
                subject: review.summary || review.type,
                featureId: member.paddedId,
            });
        }
        const revision = latestEvent(events, isRevisionCompleteEvent);
        if (revision) {
            revisionCompletions.push({
                at: revision.at || null,
                sha: revision.commitSha || null,
                subject: revision.summary || revision.type,
                featureId: member.paddedId,
            });
        }
    }

    const snapshots = Array.isArray(memberSnapshots) ? memberSnapshots.filter(Boolean) : [];
    const reviewRunning = snapshots.some(hasActiveSpecReview);
    const revisionRunning = snapshots.some(hasActiveSpecRevision);
    const pending = Number(pendingSpecReviseMemberCount) || 0;
    const launchable = Number(launchableSpecReviewMemberCount) || 0;
    const latestReview = newestCommit(reviewCompletions);
    const latestRevision = newestCommit(revisionCompletions);

    let reviewStatus = 'inactive';
    if (reviewRunning) reviewStatus = 'running';
    else if (pending > 0) reviewStatus = 'feedback-waiting';
    else if (reviewCompletions.length > 0) reviewStatus = 'complete';
    else if (launchable > 0) reviewStatus = 'ready';

    let revisionStatus = 'inactive';
    if (revisionRunning) revisionStatus = 'running';
    else if (pending > 0) revisionStatus = 'needed';
    else if (revisionCompletions.length > 0 || reviewCompletions.length > 0) revisionStatus = 'complete';

    return {
        review: {
            status: reviewStatus,
            label: reviewStatus === 'running' ? 'Spec review: running'
                : reviewStatus === 'feedback-waiting' ? `Spec review: feedback waiting (${pending})`
                : reviewStatus === 'complete' ? `Spec review: complete (${reviewCompletions.length}/${Math.max(reviewCompletions.length, launchable || reviewCompletions.length)})`
                : reviewStatus === 'ready' ? `Spec review: ready (${launchable})`
                : 'Spec review: inactive',
            memberCount: reviewCompletions.length,
            pendingCount: pending,
            completedAt: latestReview && latestReview.at || null,
            commitSha: latestReview && latestReview.sha || null,
            session: specReviewSession || null,
        },
        revision: {
            status: revisionStatus,
            label: revisionStatus === 'running' ? 'Spec revision: running'
                : revisionStatus === 'needed' ? `Spec revision: needed (${pending})`
                : revisionStatus === 'complete' ? `Spec revision: complete (${revisionCompletions.length}/${Math.max(reviewCompletions.length, revisionCompletions.length)})`
                : 'Spec revision: inactive',
            memberCount: revisionCompletions.length,
            pendingCount: pending,
            completedAt: latestRevision && latestRevision.at || null,
            commitSha: latestRevision && latestRevision.sha || null,
            session: specRevisionSession || null,
        },
    };
}

function buildSetDashboardCard(absRepoPath, summary, paths, specIndex) {
    const members = featureSets.getSetMembersSorted(summary.slug, paths, specIndex);
    const edges = featureSets.getSetDependencyEdges(summary.slug, paths, specIndex);
    const autonomous = safeSetAutoSessionExists(summary.slug, absRepoPath);
    const specReview = safeSetSpecReviewSessionExists(summary.slug, absRepoPath);
    const specRevision = safeSetSpecRevisionSessionExists(summary.slug, absRepoPath);
    const reviewableMemberCount = countReviewableSetMembers(members);
    const launchableSpecReviewMemberCount = countLaunchableSetSpecReviewMembers(members);
    const pendingSpecReviseMemberCount = countPendingSpecReviseMembers(members, absRepoPath);
    const status = autonomous && autonomous.status
        ? String(autonomous.status)
        : (summary.isComplete ? 'done' : 'idle');
    const completedIds = new Set((autonomous && autonomous.completed) || members.filter(m => m.stage === 'done').map(m => m.paddedId).filter(Boolean));
    const memberById = new Map(members.filter(m => m.paddedId).map(m => [String(m.paddedId), m]));
    const blockedIds = new Set();
    edges.forEach(edge => {
        if (!completedIds.has(String(edge.to))) blockedIds.add(String(edge.from));
    });

    const memberSnapshots = [];
    const memberEvents = new Map();
    const graphNodes = members.map(member => {
        const snapshot = member.paddedId
            ? workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepoPath, 'feature', member.paddedId)
            : null;
        memberSnapshots.push(snapshot);
        if (member.paddedId) {
            try {
                memberEvents.set(String(member.paddedId), workflowSnapshotAdapter.readFeatureEventsSync(absRepoPath, member.paddedId));
            } catch (_) {
                memberEvents.set(String(member.paddedId), []);
            }
        }
        return {
            id: member.paddedId || member.slug,
            featureId: member.paddedId || null,
            label: member.slug.replace(/-/g, ' '),
            stage: member.stage,
            state: buildSetMemberState(member, snapshot, autonomous, completedIds, blockedIds),
            isCurrent: Boolean(autonomous && autonomous.currentFeature && member.paddedId === String(autonomous.currentFeature)),
        };
    });

    const currentMember = autonomous && autonomous.currentFeature
        ? memberById.get(String(autonomous.currentFeature)) || null
        : null;

    return {
        slug: summary.slug,
        goal: readSetGoal(members),
        memberCount: summary.memberCount,
        completed: summary.completed,
        reviewableMemberCount,
        launchableSpecReviewMemberCount,
        pendingSpecReviseMemberCount,
        progress: {
            merged: summary.completed,
            total: summary.memberCount,
            percent: summary.memberCount > 0 ? Math.round((summary.completed / summary.memberCount) * 100) : 0,
        },
        status,
        isComplete: summary.isComplete,
        lastUpdatedAt: summary.lastUpdatedAt,
        currentFeature: currentMember ? {
            id: currentMember.paddedId,
            label: currentMember.slug.replace(/-/g, ' '),
            stage: currentMember.stage,
        } : null,
        lastEvent: autonomous ? {
            label: humanizeSetEvent(autonomous.reason, autonomous.status),
            at: autonomous.updatedAt || autonomous.endedAt || autonomous.startedAt || null,
        } : null,
        autonomous,
        specReview: specReview && specReview.running ? specReview : (specReview || null),
        specRevision: specRevision && specRevision.running ? specRevision : (specRevision || null),
        specCycle: buildSetSpecCycleSummary({
            members,
            memberSnapshots,
            memberEvents,
            specReviewSession: specReview && specReview.running ? specReview : (specReview || null),
            specRevisionSession: specRevision && specRevision.running ? specRevision : (specRevision || null),
            pendingSpecReviseMemberCount,
            launchableSpecReviewMemberCount,
        }),
        depGraph: {
            nodes: graphNodes,
            edges: edges.map(edge => ({ from: String(edge.from), to: String(edge.to) })),
        },
        validActions: buildSetValidActions({
            slug: summary.slug,
            status,
            isComplete: summary.isComplete,
            autonomous,
            inboxMemberCount: Number(summary.counts && summary.counts.inbox) || 0,
            reviewableMemberCount,
            launchableSpecReviewMemberCount,
            pendingSpecReviseMemberCount,
        }, {
            requiresPro: false,
            proAvailable: isProAvailable(),
        }),
    };
}

module.exports = {
    summarizeReviewSessions,
    buildLeanDoneFeatureRow,
    readSetGoal,
    isStaleSetMemberFailure,
    buildSetMemberState,
    humanizeSetEvent,
    buildSetDashboardCard,
    buildSetSpecCycleSummary,
};
