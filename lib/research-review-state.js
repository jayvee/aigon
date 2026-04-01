'use strict';

const fs = require('fs');
const path = require('path');
const wf = require('./workflow-core');

function getReviewStatePath(repoPath, researchId) {
    return path.join(wf.getEntityRoot(repoPath, 'research', String(researchId)), 'review-state.json');
}

function emptyReviewState() {
    return {
        current: null,
        history: [],
    };
}

function readReviewState(repoPath, researchId) {
    const filePath = getReviewStatePath(repoPath, researchId);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return emptyReviewState();
    }
}

function writeReviewState(repoPath, researchId, state) {
    const filePath = getReviewStatePath(repoPath, researchId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return state;
}

async function persistReviewEvent(repoPath, researchId, event) {
    const eventsPath = wf.getEventsPathForEntity(repoPath, 'research', String(researchId));
    await wf.appendEvent(eventsPath, event);
}

function persistReviewEventSync(repoPath, researchId, event) {
    const eventsPath = wf.getEventsPathForEntity(repoPath, 'research', String(researchId));
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
}

async function startReview(repoPath, researchId, agentId, at = new Date().toISOString(), source = 'dashboard/review-launch') {
    const current = readReviewState(repoPath, researchId);
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
    writeReviewState(repoPath, researchId, next);
    await persistReviewEvent(repoPath, researchId, {
        type: 'review.started',
        agentId,
        cycle: nextCycle,
        at,
        source,
    });
    return next;
}

function startReviewSync(repoPath, researchId, agentId, at = new Date().toISOString(), source = 'dashboard/review-launch') {
    const current = readReviewState(repoPath, researchId);
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
    writeReviewState(repoPath, researchId, next);
    persistReviewEventSync(repoPath, researchId, {
        type: 'review.started',
        agentId,
        cycle: nextCycle,
        at,
        source,
    });
    return next;
}

async function completeReview(repoPath, researchId, agentId, at = new Date().toISOString(), source = 'agent-status/review-complete') {
    const current = readReviewState(repoPath, researchId);
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
    writeReviewState(repoPath, researchId, next);
    await persistReviewEvent(repoPath, researchId, {
        type: 'review.completed',
        agentId: completed.agent,
        cycle: completed.cycle,
        at,
        source,
    });
    return next;
}

function completeReviewSync(repoPath, researchId, agentId, at = new Date().toISOString(), source = 'agent-status/review-complete') {
    const current = readReviewState(repoPath, researchId);
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
    writeReviewState(repoPath, researchId, next);
    persistReviewEventSync(repoPath, researchId, {
        type: 'review.completed',
        agentId: completed.agent,
        cycle: completed.cycle,
        at,
        source,
    });
    return next;
}

async function markReviewing(repoPath, researchId, agentId, at = new Date().toISOString(), source = 'agent-status/reviewing') {
    const current = readReviewState(repoPath, researchId);
    if (current.current && current.current.agent === agentId && current.current.status === 'in-progress') {
        return current;
    }
    return startReview(repoPath, researchId, agentId, at, source);
}

function markReviewingSync(repoPath, researchId, agentId, at = new Date().toISOString(), source = 'agent-status/reviewing') {
    const current = readReviewState(repoPath, researchId);
    if (current.current && current.current.agent === agentId && current.current.status === 'in-progress') {
        return current;
    }
    return startReviewSync(repoPath, researchId, agentId, at, source);
}

function reconcileReviewState(repoPath, researchId, isSessionRunning) {
    const current = readReviewState(repoPath, researchId);
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
    writeReviewState(repoPath, researchId, next);
    try {
        fs.mkdirSync(path.dirname(getReviewStatePath(repoPath, researchId)), { recursive: true });
        const eventsPath = wf.getEventsPathForEntity(repoPath, 'research', String(researchId));
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
