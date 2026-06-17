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
const workflowSignalBridge = require('./workflow-signal-bridge');
const names = require('./names');
const consoleDto = require('./console');
const { createHost, createTmuxSessionHost, getDefaultHost, DEFAULT_HOST_KIND } = require('./hosts');
const {
    AgentSessionError,
    ERROR_CODES,
    createAgentSessionError,
    isAgentSessionError,
} = require('./errors');

module.exports = {
    AgentSessionError,
    DEFAULT_HOST_KIND,
    ENTITY_TYPES,
    ERROR_CODES,
    SESSION_CATEGORIES,
    SESSION_EVENT_TYPES,
    SESSION_ROLES,
    SESSION_STATES,
    createAgentSessionError,
    createAgentSessionService,
    createAgentSessionStore,
    dispatchSessionSignal: workflowSignalBridge.dispatchSessionSignal,
    mapSessionSignalToWorkflowActions: workflowSignalBridge.mapSessionSignalToWorkflowActions,
    createConsoleSnapshot: consoleDto.createConsoleSnapshot,
    createDeadConsoleSnapshot: consoleDto.createDeadConsoleSnapshot,
    createOperatorMessageResult: consoleDto.createOperatorMessageResult,
    createHost,
    createTmuxSessionHost,
    getDefaultHost,
    isAgentSessionError,
    names,
    normalizeAgentSessionRecord,
    validateAgentSessionStartRequest,
    validateSessionEvent,
    // Re-export naming helpers at the top level for convenience.
    VALID_TMUX_ROLES: names.VALID_TMUX_ROLES,
    buildTmuxSessionName: names.buildTmuxSessionName,
    buildResearchTmuxSessionName: names.buildResearchTmuxSessionName,
    parseTmuxSessionName: names.parseTmuxSessionName,
    matchTmuxSessionByEntityId: names.matchTmuxSessionByEntityId,
    resolveTmuxRepoName: names.resolveTmuxRepoName,
};
