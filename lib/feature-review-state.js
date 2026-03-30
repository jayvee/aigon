'use strict';

const fs = require('fs');
const path = require('path');
const wf = require('./workflow-core');

function getReviewStatePath(repoPath, featureId) {
    return path.join(wf.getFeatureRoot(repoPath, String(featureId)), 'review-state.json');
}

function emptyReviewState() {
    return {
        current: null,
        history: [],
    };
}

function readReviewState(repoPath, featureId) {
    const filePath = getReviewStatePath(repoPath, featureId);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return emptyReviewState();
    }
}

function writeReviewState(repoPath, featureId, state) {
    const filePath = getReviewStatePath(repoPath, featureId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return state;
}

async function persistReviewEvent(repoPath, featureId, event) {
    await wf.appendEvent(repoPath, String(featureId), event);
}

function persistReviewEventSync(repoPath, featureId, event) {
    const eventsPath = wf.getEventsPath(repoPath, String(featureId));
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
}

async function startReview(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'dashboard/review-launch') {
    const current = readReviewState(repoPath, featureId);
    const nextCycle = current.history.length + (current.current ? 1 : 0) + 1;
    const next = {
        current: {
            agent: agentId,
            status: 'in-progress',
            startedAt: at,
            completedAt: null,
            cycle: nextCycle,
            source,
        },
        history: current.history || [],
    };
    writeReviewState(repoPath, featureId, next);
    await persistReviewEvent(repoPath, featureId, {
        type: 'review.started',
        agentId,
        cycle: nextCycle,
        at,
        source,
    });
    return next;
}

function startReviewSync(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'dashboard/review-launch') {
    const current = readReviewState(repoPath, featureId);
    const nextCycle = current.history.length + (current.current ? 1 : 0) + 1;
    const next = {
        current: {
            agent: agentId,
            status: 'in-progress',
            startedAt: at,
            completedAt: null,
            cycle: nextCycle,
            source,
        },
        history: current.history || [],
    };
    writeReviewState(repoPath, featureId, next);
    persistReviewEventSync(repoPath, featureId, {
        type: 'review.started',
        agentId,
        cycle: nextCycle,
        at,
        source,
    });
    return next;
}

async function completeReview(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'agent-status/review-complete') {
    const current = readReviewState(repoPath, featureId);
    const active = current.current && (!agentId || current.current.agent === agentId)
        ? current.current
        : {
            agent: agentId,
            status: 'complete',
            startedAt: at,
            completedAt: at,
            cycle: (current.history || []).length + 1,
            source,
        };
    const completed = {
        ...active,
        agent: active.agent || agentId,
        status: 'complete',
        completedAt: at,
        source,
    };
    const next = {
        current: null,
        history: [...(current.history || []), completed],
    };
    writeReviewState(repoPath, featureId, next);
    await persistReviewEvent(repoPath, featureId, {
        type: 'review.completed',
        agentId: completed.agent,
        cycle: completed.cycle,
        at,
        source,
    });
    return next;
}

function completeReviewSync(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'agent-status/review-complete') {
    const current = readReviewState(repoPath, featureId);
    const active = current.current && (!agentId || current.current.agent === agentId)
        ? current.current
        : {
            agent: agentId,
            status: 'complete',
            startedAt: at,
            completedAt: at,
            cycle: (current.history || []).length + 1,
            source,
        };
    const completed = {
        ...active,
        agent: active.agent || agentId,
        status: 'complete',
        completedAt: at,
        source,
    };
    const next = {
        current: null,
        history: [...(current.history || []), completed],
    };
    writeReviewState(repoPath, featureId, next);
    persistReviewEventSync(repoPath, featureId, {
        type: 'review.completed',
        agentId: completed.agent,
        cycle: completed.cycle,
        at,
        source,
    });
    return next;
}

async function markReviewing(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'agent-status/reviewing') {
    const current = readReviewState(repoPath, featureId);
    if (current.current && current.current.agent === agentId && current.current.status === 'in-progress') {
        return current;
    }
    return startReview(repoPath, featureId, agentId, at, source);
}

function markReviewingSync(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'agent-status/reviewing') {
    const current = readReviewState(repoPath, featureId);
    if (current.current && current.current.agent === agentId && current.current.status === 'in-progress') {
        return current;
    }
    return startReviewSync(repoPath, featureId, agentId, at, source);
}

function reconcileReviewState(repoPath, featureId, isSessionRunning) {
    const current = readReviewState(repoPath, featureId);
    if (!current.current || current.current.status !== 'in-progress' || isSessionRunning) {
        return current;
    }
    const completedAt = new Date().toISOString();
    const completed = {
        ...current.current,
        status: 'complete',
        completedAt,
        source: current.current.source || 'reconcile/session-ended',
    };
    const next = {
        current: null,
        history: [...(current.history || []), completed],
    };
    writeReviewState(repoPath, featureId, next);
    try {
        fs.mkdirSync(path.dirname(getReviewStatePath(repoPath, featureId)), { recursive: true });
        const eventsPath = wf.getEventsPath(repoPath, String(featureId));
        fs.appendFileSync(eventsPath, JSON.stringify({
            type: 'review.completed',
            agentId: completed.agent,
            cycle: completed.cycle,
            at: completedAt,
            source: 'reconcile/session-ended',
        }) + '\n');
    } catch (_) { /* ignore */ }
    return next;
}

module.exports = {
    emptyReviewState,
    getReviewStatePath,
    readReviewState,
    writeReviewState,
    startReview,
    startReviewSync,
    markReviewing,
    markReviewingSync,
    completeReview,
    completeReviewSync,
    reconcileReviewState,
};
