'use strict';

const ERROR_CODES = Object.freeze({
    HOST_UNAVAILABLE: 'agent_session_host_unavailable',
    INVALID_RECORD: 'agent_session_invalid_record',
    INVALID_REQUEST: 'agent_session_invalid_request',
    INVALID_EVENT: 'agent_session_invalid_event',
    NOT_FOUND: 'agent_session_not_found',
});

class AgentSessionError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'AgentSessionError';
        this.code = code;
        this.details = details;
    }
}

function createAgentSessionError(code, message, details = {}) {
    return new AgentSessionError(code, message, details);
}

function isAgentSessionError(err, code = null) {
    return err instanceof AgentSessionError && (!code || err.code === code);
}

module.exports = {
    AgentSessionError,
    ERROR_CODES,
    createAgentSessionError,
    isAgentSessionError,
};
