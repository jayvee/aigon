'use strict';

const ENTITY_UI_CONTRACT_VERSION = 3;
const ENTITY_KINDS = new Set(['feature', 'research', 'feature-set']);
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

// `feature-678-adopt-contracts.md` → `adopt-contracts`. The machine slug is a
// server fact; the renderer gets it rather than re-parsing a path.
function slugFromSpecPath(specPath) {
    if (!specPath) return null;
    const base = String(specPath).split('/').pop().replace(/\.md$/, '');
    const match = base.match(/^(?:feature|research)-(?:\d+-)?(.+)$/);
    return match ? match[1] : base || null;
}

// F678: identity is server-owned. The renderer must never rebuild a display key,
// re-derive a machine slug, or infer set membership from an unrelated field.
function normalizeIdentity(entity) {
    const source = entity && typeof entity === 'object' ? entity : {};
    const kind = source.type || source.kind || null;
    if (!ENTITY_KINDS.has(kind)) {
        throw new Error(`UI contract entity requires a known kind (${[...ENTITY_KINDS].join(', ')}), received: ${JSON.stringify(kind)}`);
    }
    const id = source.id === 0 || source.id ? String(source.id) : '';
    if (!id) throw new Error(`UI contract entity requires an id (kind=${kind})`);

    // Numeric id is the operator-facing number (features/research). Sets are
    // keyed by slug and legitimately have none — null, never a coerced NaN.
    const numericSource = source.numericId !== undefined && source.numericId !== null
        ? source.numericId
        : (kind === 'feature-set' ? null : id);
    const parsedNumeric = numericSource === null ? null : Number.parseInt(String(numericSource), 10);
    const numericId = Number.isFinite(parsedNumeric) ? parsedNumeric : null;

    const set = source.set && typeof source.set === 'object'
        ? { slug: String(source.set.slug || ''), name: source.set.name || null }
        : (source.setSlug ? { slug: String(source.setSlug), name: source.setName || null } : null);
    if (set && !set.slug) throw new Error(`UI contract set membership requires a slug (kind=${kind}, id=${id})`);

    return {
        ...source,
        type: kind,
        kind,
        id,
        numericId,
        displayKey: source.displayKey || null,
        name: source.name || '',
        title: source.title || source.name || '',
        slug: source.slug ? String(source.slug) : null,
        set,
    };
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

// F678: every retained session is inspectable in exactly one place. Live
// sessions resolve to the tmux pane; ended ones to the saved console snapshot.
const SESSION_STATUS_ALIASES = new Map([
    ['running', 'running'],
    ['complete', 'completed'],
    ['completed', 'completed'],
    ['ready', 'completed'],
    ['ended', 'completed'],
    ['stopped', 'stopped'],
    ['lost', 'lost'],
    ['failed', 'failed'],
    ['error', 'failed'],
]);
const INSPECTABLE_SESSION_STATUSES = new Set(['running', 'completed', 'stopped', 'lost', 'failed']);

function normalizeSessionStatus(session, running) {
    const raw = String(session.status || (running ? 'running' : '')).toLowerCase();
    return SESSION_STATUS_ALIASES.get(raw) || (running ? 'running' : (raw || null));
}

function normalizeSessions(sessions, options = {}) {
    const ownedSessionIds = options.ownedSessionIds instanceof Set
        ? options.ownedSessionIds
        : new Set(Array.isArray(options.ownedSessionIds) ? options.ownedSessionIds.map(String) : []);
    const stageOwnerById = options.stageOwnerById instanceof Map ? options.stageOwnerById : new Map();

    return (Array.isArray(sessions) ? sessions : []).map((source) => {
        const session = { ...source };
        const id = sessionIdentity(session);
        const running = session.running === true || session.sessionRunning === true || session.status === 'running';
        const sessionStatus = normalizeSessionStatus(session, running);
        const retained = INSPECTABLE_SESSION_STATUSES.has(sessionStatus)
            || session.consoleAvailable === true
            || session.inspectable === true;
        const inspectable = Boolean(id && session.peekAvailable !== false && retained);
        const target = running ? 'live-pane' : 'console-snapshot';
        const stageOwned = Boolean(id && ownedSessionIds.has(String(id)));
        const inspection = inspectable
            ? {
                available: true,
                actionId: 'peek-session',
                sessionId: id,
                target,
                mode: running ? 'live' : 'snapshot',
                unavailableReason: null,
            }
            : {
                available: false,
                actionId: null,
                sessionId: id,
                target: null,
                mode: null,
                unavailableReason: id
                    ? 'No retained output for this session'
                    : 'Session has no stable identifier',
            };
        return {
            ...session,
            sessionId: id,
            sessionStatus,
            running,
            inspectable,
            stageOwned,
            owningStageType: stageOwned ? (stageOwnerById.get(String(id)) || null) : null,
            inspection,
            affordances: inspectable ? [{
                actionId: 'peek-session',
                label: 'Peek',
                interaction: {
                    surface: 'session',
                    handler: 'peek-session',
                    mode: inspection.mode,
                    target: inspection.target,
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

// A stage owns its worker sessions: they render inside the stage, never again as
// a peer activity row. Ownership is resolved here so every entity kind agrees.
function planSessionOwnership(plan) {
    const ownedSessionIds = new Set();
    const stageOwnerById = new Map();
    const stages = plan && Array.isArray(plan.stages) ? plan.stages : [];
    stages.forEach((stage) => {
        (Array.isArray(stage.sessionIds) ? stage.sessionIds : []).forEach((sessionId) => {
            if (!sessionId) return;
            ownedSessionIds.add(String(sessionId));
            if (!stageOwnerById.has(String(sessionId))) stageOwnerById.set(String(sessionId), stage.type || null);
        });
    });
    return { ownedSessionIds, stageOwnerById };
}

function isInternalSignal(action) {
    return Boolean(action.metadata && action.metadata.uiVisibility === 'internal');
}

function buildEntityUiContract(options) {
    const entity = normalizeIdentity(options.entity);
    const entityType = entity.type;
    const state = { ...options.state };
    const plan = options.plan || null;
    const { ownedSessionIds, stageOwnerById } = planSessionOwnership(plan);
    const sessions = normalizeSessions(options.sessions, {
        lifecycle: state.lifecycle,
        ownedSessionIds,
        stageOwnerById,
    });
    const projected = (Array.isArray(options.actions) ? options.actions : [])
        .map(action => projectAction(action, entityType));
    // Internal workflow signals stay visible to coverage tests via metadata but
    // are never offered to an operator as a decision or a tool.
    const internalSignals = projected.filter(isInternalSignal)
        .map(action => ({ actionId: action.actionId, eventType: action.eventType, metadata: action.metadata }));
    const actions = projected.filter(action => !isInternalSignal(action));
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
        plan,
        internalSignals,
    });
}

// Repaint-relevant only: identity, lifecycle, action availability, session
// inspectability, and plan/member progress. Timestamps and prose stay out so a
// card does not repaint on every poll.
function specCycleFingerprint(specCycle) {
    if (!specCycle) return '';
    return ['review', 'revision'].map((key) => {
        const side = specCycle[key] || {};
        return [
            key,
            side.status || '',
            side.pendingCount || 0,
            side.memberCount || 0,
            side.commitSha || '',
            side.sessionId || (side.session && (side.session.sessionName || side.session.session)) || '',
            side.inspectable ? 1 : 0,
        ].join(':');
    }).join('|');
}

function planFingerprint(plan) {
    if (!plan) return '';
    const controller = plan.controller || {};
    const progress = plan.progress || {};
    const stages = (Array.isArray(plan.stages) ? plan.stages : [])
        .map(stage => `${stage.type || ''}:${stage.status || ''}:${(stage.sessionIds || []).join(',')}`)
        .join('|');
    const members = (Array.isArray(plan.members) ? plan.members : [])
        .map(member => `${member.id || ''}:${member.state || ''}:${member.status || ''}:${member.stage || ''}:${member.isCurrent ? 1 : 0}`)
        .join('|');
    return [
        controller.status || '',
        controller.running ? 1 : 0,
        plan.controllerSessionId || '',
        progress.complete === undefined ? '' : progress.complete,
        progress.total === undefined ? '' : progress.total,
        plan.currentFeature ? `${plan.currentFeature.id || ''}:${plan.currentFeature.stage || ''}` : '',
        stages,
        members,
        plan.presentation ? [
            plan.presentation.suppressProgress ? 1 : 0,
            plan.presentation.suppressMemberList ? 1 : 0,
        ].join(':') : '',
        // A set repaints when its current member's own contract changes.
        plan.currentFeatureContract ? entityUiContractFingerprint(plan.currentFeatureContract) : '',
    ].join(';');
}

function entityUiContractFingerprint(contract) {
    if (!contract) return '';
    const actions = ((contract.decisions && contract.decisions.actions) || []).concat(contract.tools || [])
        .map(action => `${actionIdentity(action)}:${action.disabled ? 1 : 0}`)
        .join('|');
    const sessions = (contract.sessions || [])
        .map(session => [
            session.sessionId || '',
            session.sessionStatus || '',
            session.running ? 1 : 0,
            session.stageOwned ? 1 : 0,
            (session.inspection && session.inspection.target) || '',
            (session.affordances || []).map(a => a.actionId).join(','),
        ].join(':'))
        .join('|');
    const state = contract.state || {};
    const entity = contract.entity || {};
    return [
        contract.contractVersion,
        entity.type,
        entity.id || '',
        entity.set && entity.set.slug || '',
        state.lifecycle,
        state.lane,
        state.severity,
        specCycleFingerprint(state.specCycle),
        contract.decisions && contract.decisions.primaryActionId || '',
        (contract.presentation && contract.presentation.suppressStateLine) ? 1 : 0,
        actions,
        sessions,
        planFingerprint(contract.plan),
        (contract.blockers || []).map(blocker => `${blocker.kind || ''}:${blocker.id || ''}`).join('|'),
    ].join(':');
}

module.exports = {
    ENTITY_UI_CONTRACT_VERSION,
    ENTITY_KINDS,
    actionIdentity,
    buildEntityUiContract,
    entityUiContractFingerprint,
    normalizeIdentity,
    normalizeSessions,
    planSessionOwnership,
    projectAction,
    slugFromSpecPath,
    specCycleFingerprint,
    validateContractActions,
};
