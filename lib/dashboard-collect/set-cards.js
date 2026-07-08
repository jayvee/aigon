'use strict';

const fs = require('fs');
const { parseFrontMatter } = require('../cli-parse');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const featureSets = require('../feature-sets');
const { safeSetAutoSessionExists } = require('../dashboard-status-helpers');
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

function buildSetDashboardCard(absRepoPath, summary, paths, specIndex) {
    const members = featureSets.getSetMembersSorted(summary.slug, paths, specIndex);
    const edges = featureSets.getSetDependencyEdges(summary.slug, paths, specIndex);
    const autonomous = safeSetAutoSessionExists(summary.slug, absRepoPath);
    const status = autonomous && autonomous.status
        ? String(autonomous.status)
        : (summary.isComplete ? 'done' : 'idle');
    const completedIds = new Set((autonomous && autonomous.completed) || members.filter(m => m.stage === 'done').map(m => m.paddedId).filter(Boolean));
    const memberById = new Map(members.filter(m => m.paddedId).map(m => [String(m.paddedId), m]));
    const blockedIds = new Set();
    edges.forEach(edge => {
        if (!completedIds.has(String(edge.to))) blockedIds.add(String(edge.from));
    });

    const graphNodes = members.map(member => {
        const snapshot = member.paddedId
            ? workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepoPath, 'feature', member.paddedId)
            : null;
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
            reviewableMemberCount: countReviewableSetMembers(members),
            launchableSpecReviewMemberCount: countLaunchableSetSpecReviewMembers(members),
            pendingSpecReviseMemberCount: countPendingSpecReviseMembers(members, absRepoPath),
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
};
