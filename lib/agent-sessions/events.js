'use strict';

const { ERROR_CODES, createAgentSessionError } = require('./errors');

const SESSION_EVENT_TYPES = Object.freeze({
    REQUESTED: 'agent_session.requested',
    STARTED: 'agent_session.started',
    STATE_CHANGED: 'agent_session.state_changed',
    TRANSCRIPT_BOUND: 'agent_session.transcript_bound',
    STOPPED: 'agent_session.stopped',
    LOST: 'agent_session.lost',
});

function validateSessionEvent(event) {
    const issues = [];
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw createAgentSessionError(ERROR_CODES.INVALID_EVENT, 'Session event must be an object');
    }
    if (!Object.values(SESSION_EVENT_TYPES).includes(event.type)) {
        issues.push('type');
    }
    if (!event.sessionId || typeof event.sessionId !== 'string') {
        issues.push('sessionId');
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
    return {
        type: event.type,
        sessionId: event.sessionId,
        at: event.at || new Date().toISOString(),
        actor: event.actor || null,
        payload: event.payload || {},
    };
}

module.exports = {
    SESSION_EVENT_TYPES,
    validateSessionEvent,
};
