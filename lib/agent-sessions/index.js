'use strict';

const {
    ENTITY_TYPES,
    SESSION_CATEGORIES,
    SESSION_ROLES,
    SESSION_STATES,
    normalizeAgentSessionRecord,
    validateAgentSessionStartRequest,
} = require('./model');
const { SESSION_EVENT_TYPES, validateSessionEvent } = require('./events');
const { createAgentSessionService } = require('./service');
const { createAgentSessionStore } = require('./store');
const {
    AgentSessionError,
    ERROR_CODES,
    createAgentSessionError,
    isAgentSessionError,
} = require('./errors');

module.exports = {
    AgentSessionError,
    ENTITY_TYPES,
    ERROR_CODES,
    SESSION_CATEGORIES,
    SESSION_EVENT_TYPES,
    SESSION_ROLES,
    SESSION_STATES,
    createAgentSessionError,
    createAgentSessionService,
    createAgentSessionStore,
    isAgentSessionError,
    normalizeAgentSessionRecord,
    validateAgentSessionStartRequest,
    validateSessionEvent,
};
