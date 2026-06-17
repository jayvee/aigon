'use strict';

const { ERROR_CODES, createAgentSessionError } = require('./errors');
const { SESSION_EVENT_TYPES } = require('./events');
const {
    SESSION_STATES,
    normalizeAgentSessionRecord,
    validateAgentSessionStartRequest,
} = require('./model');
const { createAgentSessionStore } = require('./store');

function createAgentSessionService({
    repoPath = process.cwd(),
    store = createAgentSessionStore({ repoPath }),
    host = undefined,
    now = () => new Date(),
} = {}) {
    // Default to the process-wide tmux host so the service is usable out of the
    // box. Lazy-required to avoid a top-level cycle through worktree (F554).
    function resolveHost() {
        if (host === undefined) {
            host = require('./hosts').getDefaultHost();
        }
        return host;
    }

    function requireHost(method) {
        const resolved = resolveHost();
        if (!resolved || typeof resolved[method] !== 'function') {
            throw createAgentSessionError(
                ERROR_CODES.HOST_UNAVAILABLE,
                `AgentSessionService.${method} requires a SessionHost implementing ${method}`
            );
        }
        return resolved;
    }

    function timestamp() {
        const value = now();
        return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    }

    function startSession(request) {
        const requestedAt = timestamp();
        const startRequest = validateAgentSessionStartRequest({
            ...request,
            state: request.state || SESSION_STATES.REQUESTED,
            createdAt: request.createdAt || requestedAt,
            updatedAt: request.updatedAt || requestedAt,
        });
        const activeHost = requireHost('startSession');

        store.writeSession(startRequest);
        store.appendEvent({
            type: SESSION_EVENT_TYPES.REQUESTED,
            sessionId: startRequest.sessionId,
            at: requestedAt,
            payload: { role: startRequest.role, agentId: startRequest.agent && startRequest.agent.id },
        });

        const hostResult = activeHost.startSession(startRequest) || {};
        const startedAt = timestamp();
        const record = normalizeAgentSessionRecord({
            ...startRequest,
            ...hostResult,
            sessionId: hostResult.sessionId || startRequest.sessionId,
            category: hostResult.category || startRequest.category,
            entity: hostResult.entity || startRequest.entity,
            role: hostResult.role !== undefined ? hostResult.role : startRequest.role,
            agent: hostResult.agent || startRequest.agent,
            state: hostResult.state || SESSION_STATES.ACTIVE,
            startedAt: hostResult.startedAt || startRequest.startedAt || startedAt,
            updatedAt: hostResult.updatedAt || startedAt,
        }, 'hostResult');
        store.writeSession(record);
        store.appendEvent({
            type: SESSION_EVENT_TYPES.STARTED,
            sessionId: record.sessionId,
            at: record.startedAt,
            payload: { host: record.host || null },
        });
        return record;
    }

    function getSession(sessionRef) {
        const record = store.readSession(sessionRef);
        if (!record) {
            throw createAgentSessionError(
                ERROR_CODES.NOT_FOUND,
                'Agent session not found',
                { sessionRef }
            );
        }
        return record;
    }

    function listSessions(filter = {}) {
        return store.listSessions(filter);
    }

    function findSession({ entity, role, agentId } = {}) {
        return store.listSessions({ entity, role, agentId })[0] || null;
    }

    function recordSessionEvent(event) {
        return store.appendEvent(event);
    }

    function updateTranscriptBinding(sessionRef, binding) {
        const record = getSession(sessionRef);
        const updatedAt = timestamp();
        const updated = store.writeSession({
            ...record,
            transcriptBinding: binding,
            updatedAt,
        });
        store.appendEvent({
            type: SESSION_EVENT_TYPES.TRANSCRIPT_BOUND,
            sessionId: updated.sessionId,
            at: updatedAt,
            payload: { transcriptBinding: updated.transcriptBinding },
        });
        return updated;
    }

    function markSessionState(sessionRef, state, patch = {}) {
        if (!Object.values(SESSION_STATES).includes(state)) {
            throw createAgentSessionError(
                ERROR_CODES.INVALID_REQUEST,
                'Invalid session state',
                { state }
            );
        }
        const record = getSession(sessionRef);
        const updatedAt = timestamp();
        const updated = store.writeSession({
            ...record,
            ...patch,
            state,
            updatedAt,
        });
        store.appendEvent({
            type: state === SESSION_STATES.LOST ? SESSION_EVENT_TYPES.LOST : SESSION_EVENT_TYPES.STATE_CHANGED,
            sessionId: updated.sessionId,
            at: updatedAt,
            payload: { state, patch },
        });
        return updated;
    }

    // --- Host-delegating operations -------------------------------------------
    // The service is the only module that knows both the store and the host.
    // These forward to the active SessionHost so callers (CLI, dashboard, nudge)
    // never touch the host directly.

    function stopSession(sessionRef, options = {}) {
        return requireHost('stopSession').stopSession(sessionRef, options);
    }

    function stopEntitySessions(entityRef, options = {}) {
        return requireHost('stopEntitySessions').stopEntitySessions(entityRef, options);
    }

    function isSessionAlive(sessionRef) {
        return requireHost('isSessionAlive').isSessionAlive(sessionRef);
    }

    function getConsoleSnapshot(sessionRef, options = {}) {
        return requireHost('getConsoleSnapshot').getConsoleSnapshot(sessionRef, options);
    }

    function deliverOperatorMessage(sessionRef, message, options = {}) {
        return requireHost('deliverOperatorMessage').deliverOperatorMessage(sessionRef, message, options);
    }

    function openConsole(sessionRef, options = {}) {
        return requireHost('openConsole').openConsole(sessionRef, options);
    }

    /**
     * List live host sessions enriched with entity/orphan metadata.
     * Preserves the dashboard/CLI output shape from worktree.getEnrichedSessions.
     */
    function listLiveSessions() {
        return requireHost('listEnrichedSessions').listEnrichedSessions();
    }

    return {
        startSession,
        getSession,
        listSessions,
        findSession,
        recordSessionEvent,
        updateTranscriptBinding,
        markSessionState,
        stopSession,
        stopEntitySessions,
        isSessionAlive,
        getConsoleSnapshot,
        deliverOperatorMessage,
        openConsole,
        listLiveSessions,
        get host() { return resolveHost(); },
    };
}

module.exports = {
    createAgentSessionService,
};
