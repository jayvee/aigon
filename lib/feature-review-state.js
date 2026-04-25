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
    await wf.recordCodeReviewStarted(repoPath, 'feature', String(featureId), { reviewerId: agentId, at, source });
    return readReviewState(repoPath, featureId);
}

function startReviewSync(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'dashboard/review-launch') {
    void agentId; void at; void source;
    return readReviewState(repoPath, featureId);
}

async function completeReview(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'agent-status/review-complete') {
    await wf.recordCodeReviewCompleted(repoPath, 'feature', String(featureId), { reviewerId: agentId, requestRevision: true, at, source });
    return readReviewState(repoPath, featureId);
}

function completeReviewSync(repoPath, featureId, agentId, at = new Date().toISOString(), source = 'agent-status/review-complete') {
    void agentId; void at; void source;
    return readReviewState(repoPath, featureId);
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

const REVIEW_MIN_DURATION_MS = 30_000;

function reconcileReviewState(repoPath, featureId, isSessionRunning) {
    const current = readReviewState(repoPath, featureId);
    void isSessionRunning; void REVIEW_MIN_DURATION_MS;
    return current;
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
