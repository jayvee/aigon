'use strict';

const ENTITY_UI_CONTRACT_VERSION = 2;
const TOOL_CATEGORIES = new Set(['session', 'infra', 'view', 'agent-control']);
const TOOL_ACTIONS = new Set([
    'feature-push', 'feature-nudge', 'research-nudge', 'feature-reset', 'research-reset',
    'feature-stop', 'research-stop', 'feature-delete', 'research-delete', 'open-session',
    'open-eval-session', 'view-eval', 'view-findings', 'view-work', 'dev-server-poke',
    'reconcile-spec-drift', 'mark-submitted', 'reopen-agent', 'switch-agent',
    'restart-agent', 'force-agent-ready', 'drop-agent', 'peek-session',
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
}

function actionGroup(action) {
    if (action.group) return action.group;
    const actionId = action.actionId || action.action;
    if (TOOL_CATEGORIES.has(action.category) || TOOL_ACTIONS.has(actionId)) return 'tool';
    if (action.metadata && (action.metadata.recovery || action.metadata.recoverySurface)) return 'recovery';
    return 'decision';
}

function interactionFor(action) {
    if (action.interaction) return { ...action.interaction };
    const metadata = action.metadata || {};
    return {
        surface: action.agentId ? 'agent' : (metadata.clientAction || action.requiresInput || 'dispatch'),
        handler: metadata.apiEndpoint || metadata.clientAction || action.actionId || action.action,
        requiredInput: action.requiresInput || null,
        confirmation: metadata.confirmationMessage || null,
        destructive: Boolean(metadata.destructive),
    };
}

function projectAction(action, defaultScope) {
    const actionId = action.actionId || action.action;
    if (!actionId) throw new Error('UI contract action requires actionId');
    const group = actionGroup(action);
    return {
        actionId,
        label: action.label || actionId,
        group,
        order: Number.isFinite(action.order)
            ? action.order
            : (Number.isFinite(action.recommendedOrder) ? action.recommendedOrder : 999),
        intent: action.intent || (action.priority === 'high'
            ? 'primary'
            : (action.metadata && action.metadata.destructive ? 'danger' : 'default')),
        scope: action.scope || (action.sessionId || action.sessionName
            ? 'session'
            : (action.agentId ? 'agent' : defaultScope)),
        entityId: action.entityId || null,
        agentId: action.agentId || null,
        sessionId: action.sessionId || action.sessionName || null,
        eventType: action.eventType || null,
        transition: action.transition || (action.type === 'transition' ? { to: action.to || null } : null),
        disabled: Boolean(action.disabled),
        unavailableReason: action.unavailableReason || action.disabledReason || null,
        interaction: interactionFor(action),
        metadata: { ...(action.metadata || {}) },
    };
}

function sessionIdentity(session) {
    return session && (session.sessionId || session.sessionName || session.session || session.tmuxId) || null;
}

function normalizeSessions(sessions, options = {}) {
    return (Array.isArray(sessions) ? sessions : []).map((source) => {
        const session = { ...source };
        const id = sessionIdentity(session);
        const running = session.running === true || session.sessionRunning === true || session.status === 'running';
        const normalizedStatus = String(session.status || (running ? 'running' : '')).toLowerCase();
        const inspectableStatus = ['running', 'complete', 'completed', 'ready', 'failed', 'error', 'lost', 'ended', 'stopped'].includes(normalizedStatus);
        const inspectable = Boolean(id && session.peekAvailable !== false && (
            running || inspectableStatus || session.consoleAvailable === true || session.inspectable === true
        ));
        return {
            ...session,
            sessionId: id,
            running,
            inspectable,
            affordances: inspectable ? [{
                actionId: 'peek-session',
                label: 'Peek',
                interaction: {
                    surface: 'session',
                    handler: 'peek-session',
                    mode: running ? 'live' : 'snapshot',
                },
            }] : [],
        };
    });
}

function actionIdentity(action) {
    return [action.actionId, action.scope || '', action.entityId || '', action.agentId || '', action.sessionId || ''].join(':');
}

function validateContractActions(actions, primaryActionId) {
    const identities = new Set();
    actions.forEach((action) => {
        const identity = actionIdentity(action);
        if (identities.has(identity)) throw new Error(`Duplicate UI contract action identity: ${identity}`);
        identities.add(identity);
        if (action.disabled && !action.unavailableReason) {
            throw new Error(`Disabled UI contract action requires unavailableReason: ${identity}`);
        }
        if (!action.interaction || !action.interaction.handler) {
            throw new Error(`UI contract action requires interaction handler: ${identity}`);
        }
    });
    if (primaryActionId) {
        const matching = actions.filter(action => action.actionId === primaryActionId && !action.disabled);
        if (matching.length !== 1) {
            throw new Error(`Primary UI action must identify exactly one enabled action: ${primaryActionId}`);
        }
    }
}

function buildEntityUiContract(options) {
    const entity = { ...options.entity };
    const entityType = entity.type;
    const state = { ...options.state };
    const sessions = normalizeSessions(options.sessions, { lifecycle: state.lifecycle });
    const projected = (Array.isArray(options.actions) ? options.actions : [])
        .map(action => projectAction(action, entityType));
    const actions = projected;
    const decisions = actions.filter(action => action.group !== 'tool');
    const tools = actions.filter(action => action.group === 'tool');
    const primaryActionId = options.primaryActionId || null;
    validateContractActions(actions, primaryActionId);

    return deepFreeze({
        contractVersion: ENTITY_UI_CONTRACT_VERSION,
        entity,
        state,
        presentation: { ...(options.presentation || {}) },
        decisions: { primaryActionId, actions: decisions },
        tools,
        blockers: Array.isArray(options.blockers) ? options.blockers.slice() : [],
        allowedDrops: decisions
            .filter(action => action.transition && action.transition.to)
            .map(action => ({ actionId: action.actionId, lane: action.transition.to })),
        history: Array.isArray(options.history) ? options.history.slice() : [],
        agents: Array.isArray(options.agents) ? options.agents.slice() : [],
        sessions,
        plan: options.plan || null,
    });
}

function entityUiContractFingerprint(contract) {
    if (!contract) return '';
    const actions = (contract.decisions.actions || []).concat(contract.tools || [])
        .map(action => `${actionIdentity(action)}:${action.disabled ? 1 : 0}`)
        .join('|');
    const sessions = (contract.sessions || [])
        .map(session => `${session.sessionId || ''}:${session.running ? 1 : 0}:${(session.affordances || []).map(a => a.actionId).join(',')}`)
        .join('|');
    const plan = contract.plan ? JSON.stringify(contract.plan) : '';
    return [
        contract.contractVersion,
        contract.entity && contract.entity.type,
        contract.state && contract.state.lifecycle,
        contract.state && contract.state.lane,
        contract.state && contract.state.severity,
        contract.decisions && contract.decisions.primaryActionId || '',
        actions,
        sessions,
        plan,
    ].join(':');
}

module.exports = {
    ENTITY_UI_CONTRACT_VERSION,
    actionIdentity,
    buildEntityUiContract,
    entityUiContractFingerprint,
    normalizeSessions,
    projectAction,
    validateContractActions,
};
