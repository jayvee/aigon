'use strict';

const path = require('path');
const fs = require('fs');
const { SESSION_EVENT_TYPES, validateSessionEvent } = require('./events');
const { createAgentSessionStore } = require('./store');

const START_STATUSES = new Set([
    'implementing',
    'reviewing',
    'addressing-code-review',
    'addressing-spec-review',
    'spec-reviewing',
]);

const COMPLETION_STATUSES = new Set([
    'implementation-complete',
    'revision-complete',
    'review-complete',
    'spec-review-complete',
    'research-complete',
]);

function getDefaultWorkflow() {
    return require(path.join('..', 'workflow-core'));
}

function getDefaultAgentStatus() {
    return require(path.join('..', 'agent-status'));
}

function normalizeEntityType(value) {
    return value === 'research' ? 'research' : 'feature';
}

function normalizeEntityId(value) {
    return String(value || '').trim().padStart(2, '0');
}

function statusToEventType(status) {
    if (status === 'awaiting-input') return SESSION_EVENT_TYPES.AWAITING_OPERATOR;
    if (status === 'error') return SESSION_EVENT_TYPES.TASK_FAILED;
    if (COMPLETION_STATUSES.has(status)) return SESSION_EVENT_TYPES.TASK_COMPLETED;
    return SESSION_EVENT_TYPES.STATUS_REPORTED;
}

function inferRoleFromStatus(status, payload = {}) {
    if (payload.taskType) return payload.taskType;
    if (status === 'reviewing' || status === 'review-complete') return 'review';
    if (status === 'addressing-code-review' || status === 'revision-complete') return 'revise';
    if (status === 'spec-reviewing') return 'spec-review';
    if (status === 'addressing-spec-review') return 'spec-revise';
    if (status === 'spec-review-complete') return payload.taskType || 'spec-review';
    return 'do';
}

function normalizeSessionSignal(signal, { now = () => new Date() } = {}) {
    const atValue = signal.at || now();
    const at = atValue instanceof Date ? atValue.toISOString() : new Date(atValue).toISOString();
    const status = signal.status || (signal.payload && signal.payload.legacyStatus) || null;
    const entityType = normalizeEntityType(signal.entityType || (signal.entity && signal.entity.type));
    const entityId = normalizeEntityId(signal.entityId || (signal.entity && signal.entity.id));
    const agentId = String(signal.agentId || (signal.agent && signal.agent.id) || '').trim();
    const role = signal.role || inferRoleFromStatus(status, signal.payload || {});
    const sessionId = signal.sessionId
        || [entityType, entityId, role || 'unknown', agentId || 'unknown'].join('-');
    const eventType = signal.eventType || signal.type || statusToEventType(status);
    const id = signal.id || buildSignalId({ sessionId, eventType, status, payload: signal.payload || {} });
    return validateSessionEvent({
        id,
        type: eventType,
        eventType,
        sessionId,
        entity: { type: entityType, id: entityId },
        role,
        agent: agentId ? { id: agentId } : null,
        status,
        at,
        actor: signal.actor || null,
        source: signal.source || null,
        payload: signal.payload || {},
    });
}

function buildSignalId({ sessionId, eventType, status, payload }) {
    const stablePayload = payload && payload.verdict
        ? `:${payload.verdict}`
        : payload && payload.requestRevision !== undefined
            ? `:${payload.requestRevision ? 'request-revision' : 'approve'}`
            : '';
    return [sessionId, eventType, status || 'none'].join(':') + stablePayload;
}

function getLegacyStatus(signal) {
    return signal.status || (signal.payload && signal.payload.legacyStatus) || null;
}

function mapSessionSignalToWorkflowActions(signal) {
    const status = getLegacyStatus(signal);
    const entityType = signal.entity && signal.entity.type;
    const entityId = signal.entity && signal.entity.id;
    const agentId = signal.agent && signal.agent.id;
    const source = signal.source || (signal.payload && signal.payload.source) || `agent-session/${signal.eventType}`;
    const actions = [];

    if (!entityType || !entityId || !agentId) return actions;

    if (signal.eventType === SESSION_EVENT_TYPES.STARTED) {
        return actions;
    }

    if (status === 'reviewing') {
        actions.push({
            type: 'workflow.recordCodeReviewStarted',
            entityType,
            entityId,
            reviewerId: agentId,
            source,
        });
        return actions;
    }

    if (status === 'waiting' || signal.eventType === SESSION_EVENT_TYPES.AWAITING_OPERATOR) {
        if (status === 'waiting') {
            actions.push({ type: 'workflow.emitSignal', entityType, entityId, signal: 'agent-waiting', agentId, source });
        }
        return actions;
    }

    if (status === 'error' || signal.eventType === SESSION_EVENT_TYPES.TASK_FAILED) {
        actions.push({ type: 'workflow.emitSignal', entityType, entityId, signal: 'agent-failed', agentId, source });
        return actions;
    }

    if (signal.eventType === SESSION_EVENT_TYPES.LOST) {
        actions.push({ type: 'workflow.emitSignal', entityType, entityId, signal: 'session-lost', agentId, source });
        return actions;
    }

    if (status === 'implementation-complete' || status === 'research-complete') {
        actions.push({ type: 'workflow.emitSignal', entityType, entityId, signal: 'agent-ready', agentId, source });
        return actions;
    }

    if (status === 'revision-complete') {
        actions.push({
            type: 'workflow.recordCodeRevisionCompleted',
            entityType,
            entityId,
            revisionAgentId: agentId,
            source,
        });
        actions.push({ type: 'workflow.emitSignal', entityType, entityId, signal: 'agent-ready', agentId, source });
        return actions;
    }

    if (status === 'review-complete') {
        const verdict = signal.payload && signal.payload.verdict;
        const hasRequestRevision = signal.payload && signal.payload.requestRevision !== undefined;
        if (!verdict && !hasRequestRevision) {
            throw new Error('review-complete requires --approve or --request-revision');
        }
        const requestRevision = hasRequestRevision
            ? signal.payload.requestRevision === true
            : verdict === 'request-revision';
        actions.push({
            type: 'workflow.recordCodeReviewCompleted',
            entityType,
            entityId,
            reviewerId: agentId,
            requestRevision,
            source,
        });
        return actions;
    }

    if (status === 'spec-review-complete') {
        const taskType = (signal.payload && signal.payload.taskType) || signal.role;
        if (taskType === 'spec-revise' || taskType === 'spec-check') {
            actions.push({
                type: 'workflow.recordSpecRevisionCompleted',
                entityType,
                entityId,
                ackedBy: agentId,
                source,
            });
        } else {
            actions.push({
                type: 'workflow.recordSpecReviewCompleted',
                entityType,
                entityId,
                reviewerId: agentId,
                source,
            });
        }
        return actions;
    }

    return actions;
}

async function applyWorkflowAction(action, deps) {
    const workflow = deps.workflow || getDefaultWorkflow();
    if (action.type === 'workflow.emitSignal') {
        return workflow.emitSignal(action.repoPath || deps.repoPath, action.entityId, action.signal, action.agentId, {
            entityType: action.entityType,
            source: action.source,
        });
    }
    if (action.type === 'workflow.recordCodeReviewStarted') {
        return workflow.recordCodeReviewStarted(deps.repoPath, action.entityType, action.entityId, {
            reviewerId: action.reviewerId,
            source: action.source,
        });
    }
    if (action.type === 'workflow.recordCodeReviewCompleted') {
        return workflow.recordCodeReviewCompleted(deps.repoPath, action.entityType, action.entityId, {
            reviewerId: action.reviewerId,
            requestRevision: action.requestRevision,
            source: action.source,
        });
    }
    if (action.type === 'workflow.recordCodeRevisionCompleted') {
        return workflow.recordCodeRevisionCompleted(deps.repoPath, action.entityType, action.entityId, {
            revisionAgentId: action.revisionAgentId,
            source: action.source,
        });
    }
    if (action.type === 'workflow.recordSpecReviewCompleted') {
        return workflow.recordSpecReviewCompleted(deps.repoPath, action.entityType, action.entityId, {
            reviewerId: action.reviewerId,
            source: action.source,
        });
    }
    if (action.type === 'workflow.recordSpecRevisionCompleted') {
        return workflow.recordSpecRevisionCompleted(deps.repoPath, action.entityType, action.entityId, {
            ackedBy: action.ackedBy,
            source: action.source,
        });
    }
    throw new Error(`Unknown workflow action: ${action.type}`);
}

function isDuplicateSignal(store, signal) {
    if (!store || typeof store.readEvents !== 'function') return false;
    const matches = store.readEvents().filter((event) => event.id === signal.id);
    return matches.length > 1;
}

function writeLegacyStatus(signal, deps) {
    const status = getLegacyStatus(signal);
    if (!status) return;
    const agentStatus = deps.agentStatus || getDefaultAgentStatus();
    const entityType = signal.entity && signal.entity.type;
    const entityId = signal.entity && signal.entity.id;
    const agentId = signal.agent && signal.agent.id;
    if (!entityType || !entityId || !agentId) return;
    const prefix = entityType === 'research' ? 'research' : 'feature';
    if (status === 'awaiting-input') {
        const message = signal.payload && signal.payload.message;
        agentStatus.writeAwaitingInput(deps.repoPath, entityId, agentId, message, prefix);
        return;
    }
    const isCompletion = COMPLETION_STATUSES.has(status);
    const payload = signal.payload || {};
    const cachePayload = {
        status,
        worktreePath: payload.worktreePath || process.cwd(),
        lastExitCode: Number.isFinite(payload.lastExitCode) ? payload.lastExitCode : null,
        lastPaneTail: payload.lastPaneTail || null,
        runtimeAgentId: payload.runtimeAgentId || agentId,
        continuityCheckpoint: payload.continuityCheckpoint || undefined,
    };
    if (isCompletion) {
        cachePayload.taskType = null;
        cachePayload.flags = {};
        cachePayload.quotaPausedAt = undefined;
        cachePayload.quotaPauseMeta = undefined;
        cachePayload.priorQuotaStatus = undefined;
    } else if (START_STATUSES.has(status) && payload.taskType) {
        cachePayload.taskType = payload.taskType;
    }
    agentStatus.writeAgentStatusAt(deps.repoPath, entityId, agentId, cachePayload, prefix);
}

function workflowSnapshotExists(repoPath, signal) {
    const entityType = signal.entity && signal.entity.type;
    const entityId = signal.entity && signal.entity.id;
    const dir = entityType === 'research' ? 'research' : 'features';
    return fs.existsSync(path.join(repoPath, '.aigon', 'workflows', dir, entityId, 'snapshot.json'));
}

async function dispatchSessionSignal(signalInput, deps = {}) {
    const repoPath = deps.repoPath || process.cwd();
    const store = deps.sessionStore || createAgentSessionStore({ repoPath });
    const signal = normalizeSessionSignal(signalInput, deps);
    store.appendEvent(signal);
    const duplicate = isDuplicateSignal(store, signal);
    const actions = mapSessionSignalToWorkflowActions(signal, deps);
    const needsWorkflow = actions.length > 0;
    const status = getLegacyStatus(signal);
    const requiresWorkflow = needsWorkflow || START_STATUSES.has(status);
    if (requiresWorkflow && !workflowSnapshotExists(repoPath, signal)) {
        if (status === 'waiting' || status === 'error' || signal.eventType === SESSION_EVENT_TYPES.LOST) {
            writeLegacyStatus(signal, { ...deps, repoPath });
            return { signal, actions: [], duplicate, skippedWorkflow: true };
        }
        throw new Error(`Cannot signal '${status || signal.eventType}' for ${signal.entity.type} ${signal.entity.id}: workflow state is not initialized.`);
    }
    if (!duplicate) {
        for (const action of actions) {
            await applyWorkflowAction(action, { ...deps, repoPath });
        }
    }
    writeLegacyStatus(signal, { ...deps, repoPath });
    return { signal, actions, duplicate };
}

module.exports = {
    START_STATUSES,
    COMPLETION_STATUSES,
    normalizeSessionSignal,
    mapSessionSignalToWorkflowActions,
    dispatchSessionSignal,
};
