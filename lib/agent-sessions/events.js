'use strict';

const { ERROR_CODES, createAgentSessionError } = require('./errors');

const SESSION_EVENT_TYPES = Object.freeze({
    REQUESTED: 'agent_session.requested',
    STARTED: 'agent_session.started',
    STATUS_REPORTED: 'agent_session.status_reported',
    AWAITING_OPERATOR: 'agent_session.awaiting_operator',
    TASK_COMPLETED: 'agent_session.task_completed',
    TASK_FAILED: 'agent_session.task_failed',
    EXITED: 'agent_session.exited',
    STATE_CHANGED: 'agent_session.state_changed',
    TRANSCRIPT_BOUND: 'agent_session.transcript_bound',
    OPERATOR_MESSAGE_DELIVERED: 'agent_session.operator_message_delivered',
    STOPPED: 'agent_session.stopped',
    LOST: 'agent_session.lost',
});

function validateSessionEvent(event) {
    const issues = [];
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw createAgentSessionError(ERROR_CODES.INVALID_EVENT, 'Session event must be an object');
    }
    const eventType = event.eventType || event.type;
    if (!Object.values(SESSION_EVENT_TYPES).includes(eventType)) {
        issues.push('type');
    }
    if (!event.sessionId || typeof event.sessionId !== 'string') {
        issues.push('sessionId');
    }
    if (event.id !== undefined && (!event.id || typeof event.id !== 'string')) {
        issues.push('id');
    }
    if (event.entity !== undefined && event.entity !== null) {
        if (!event.entity || typeof event.entity !== 'object' || Array.isArray(event.entity)
            || !event.entity.type || typeof event.entity.type !== 'string'
            || !event.entity.id || typeof event.entity.id !== 'string') {
            issues.push('entity');
        }
    }
    if (event.role !== undefined && event.role !== null && typeof event.role !== 'string') {
        issues.push('role');
    }
    if (event.agent !== undefined && event.agent !== null) {
        const agent = typeof event.agent === 'string' ? { id: event.agent } : event.agent;
        if (!agent || typeof agent !== 'object' || Array.isArray(agent) || !agent.id || typeof agent.id !== 'string') {
            issues.push('agent');
        }
    }
    if (event.status !== undefined && event.status !== null && typeof event.status !== 'string') {
        issues.push('status');
    }
    if (event.at !== undefined && (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at)))) {
        issues.push('at');
    }
    if (event.payload !== undefined && (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload))) {
        issues.push('payload');
    }
    if (issues.length) {
        throw createAgentSessionError(
            ERROR_CODES.INVALID_EVENT,
            'Invalid session event: ' + issues.join(', '),
            { issues }
        );
    }
    const normalizedAgent = event.agent === undefined || event.agent === null
        ? null
        : typeof event.agent === 'string'
            ? { id: event.agent }
            : event.agent;
    return {
        id: event.id || `${event.sessionId}:${eventType}:${event.status || ''}:${event.at || new Date().toISOString()}`,
        type: eventType,
        eventType,
        sessionId: event.sessionId,
        entity: event.entity || null,
        role: event.role || null,
        agent: normalizedAgent,
        status: event.status || null,
        at: event.at || new Date().toISOString(),
        actor: event.actor || null,
        source: event.source || null,
        payload: event.payload || {},
    };
}

module.exports = {
    SESSION_EVENT_TYPES,
    validateSessionEvent,
};
