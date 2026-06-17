'use strict';

const { ERROR_CODES, createAgentSessionError } = require('./errors');

const SESSION_CATEGORIES = Object.freeze({
    ENTITY: 'entity',
    REPO: 'repo',
});

const SESSION_ROLES = Object.freeze({
    DO: 'do',
    EVAL: 'eval',
    REVIEW: 'review',
    REVISE: 'revise',
    SPEC_REVIEW: 'spec-review',
    SPEC_REVISE: 'spec-revise',
    SPEC_CHECK: 'spec-check',
    CLOSE: 'close',
    AUTO: 'auto',
});

const SESSION_STATES = Object.freeze({
    REQUESTED: 'requested',
    STARTING: 'starting',
    ACTIVE: 'active',
    WAITING: 'waiting',
    STOPPED: 'stopped',
    LOST: 'lost',
    UNKNOWN: 'unknown',
});

const ENTITY_TYPES = Object.freeze({
    FEATURE: 'feature',
    RESEARCH: 'research',
    SET: 'set',
});

const LEGACY_ENTITY_TYPE_MAP = Object.freeze({
    f: ENTITY_TYPES.FEATURE,
    feature: ENTITY_TYPES.FEATURE,
    r: ENTITY_TYPES.RESEARCH,
    research: ENTITY_TYPES.RESEARCH,
    // Set-autonomous conductor sessions ({repo}-s{slug}-auto) carry the legacy
    // 'S' entity type. They are agent-less `auto` sessions (F554).
    s: ENTITY_TYPES.SET,
    S: ENTITY_TYPES.SET,
    set: ENTITY_TYPES.SET,
});

const PROVIDER_BY_AGENT_ID = Object.freeze({
    cc: 'claude',
    cx: 'codex',
    gg: 'gemini',
});

/**
 * @typedef {Object} AgentSpecialistProfile
 * @property {string} id Stable specialist persona id.
 * @property {string=} label Human-readable label.
 * @property {string=} instructionsRef Reference to external instructions.
 * @property {string[]=} skillRefs Optional skill references.
 */

/**
 * @typedef {Object} TranscriptBinding
 * @property {string=} provider Provider/runtime name such as claude, codex, or gemini.
 * @property {string=} providerSessionId Provider-native transcript/session id.
 * @property {string=} path Provider-native transcript path.
 * @property {string=} capturedAt ISO timestamp for when the binding was captured.
 */

/**
 * Aigon-owned runtime record for a long-lived interactive agent process context.
 * It is distinct from workflow-core lifecycle state, provider transcript state,
 * and the external process host. Tmux is represented as one possible host.
 *
 * @typedef {Object} AgentSession
 * @property {string} sessionId Stable Aigon session id. Legacy records use sessionName.
 * @property {'entity'|'repo'} category Session category.
 * @property {{ type: 'feature'|'research', id: string }|null} entity Entity owner, or null for repo sessions.
 * @property {'do'|'eval'|'review'|'revise'|'spec-review'|'spec-revise'|'spec-check'|'close'|'auto'|null} role Session role.
 * @property {{ id: string, slotAgentId?: string, runtimeAgentId?: string }} agent Provider agent slot.
 * @property {AgentSpecialistProfile=} specialist Optional specialist persona.
 * @property {'requested'|'starting'|'active'|'waiting'|'stopped'|'lost'|'unknown'} state Runtime state.
 * @property {{ kind: string, handle: Object }=} host External host binding.
 * @property {{ repoPath?: string, worktreePath?: string, cwd?: string }} paths Session paths.
 * @property {TranscriptBinding=} transcriptBinding Provider transcript binding.
 * @property {string=} createdAt ISO creation timestamp.
 * @property {string=} updatedAt ISO update timestamp.
 * @property {string=} startedAt ISO start timestamp.
 * @property {string=} stoppedAt ISO stop timestamp.
 * @property {Object=} metadata Plain-object future compatibility field.
 */

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function assertPlainObject(value, source) {
    if (!isPlainObject(value)) {
        throw invalidRecord('AgentSession record must be an object', source, ['record']);
    }
}

function invalidRecord(message, source, issues) {
    return createAgentSessionError(ERROR_CODES.INVALID_RECORD, message, { source, issues });
}

function validateTimestamp(value, field, source) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw invalidRecord('Malformed timestamp: ' + field, source, [field]);
    }
    return value;
}

function normalizeEntity(entityType, entityId, category, source) {
    if (category === SESSION_CATEGORIES.REPO) return null;
    const mappedType = LEGACY_ENTITY_TYPE_MAP[entityType];
    if (!mappedType) {
        throw invalidRecord('Invalid entity type', source, ['entity.type']);
    }
    if (!entityId || typeof entityId !== 'string') {
        throw invalidRecord('Missing entity id', source, ['entity.id']);
    }
    return { type: mappedType, id: entityId };
}

function normalizeAgent(rawAgent, fallbackAgent, source, raw = {}, allowAnonymous = false) {
    const hasRaw = rawAgent !== undefined && rawAgent !== null && rawAgent !== '';
    const hasFallback = fallbackAgent !== undefined && fallbackAgent !== null && fallbackAgent !== '';
    // Agent-less sessions (set-autonomous + per-entity `auto` conductors) carry
    // `agent: null` on disk. They are legitimate, not malformed, so permit a null
    // agent when the caller flags the record as anonymous (role 'auto').
    if (!hasRaw && !hasFallback) {
        if (allowAnonymous) return null;
        throw invalidRecord('Missing agent id', source, ['agent.id']);
    }
    const agent = typeof rawAgent === 'string'
        ? { id: rawAgent }
        : isPlainObject(rawAgent) ? rawAgent : { id: fallbackAgent };
    if (!agent.id || typeof agent.id !== 'string') {
        throw invalidRecord('Missing agent id', source, ['agent.id']);
    }
    // The sidecar persists `agent` as a bare string id (legacy readers require it),
    // so recover the slot fields from their top-level siblings on read-back.
    return compactObject({
        id: agent.id,
        slotAgentId: agent.slotAgentId !== undefined ? agent.slotAgentId : raw.slotAgentId,
        runtimeAgentId: agent.runtimeAgentId !== undefined ? agent.runtimeAgentId : raw.runtimeAgentId,
    });
}

function normalizeSpecialist(rawSpecialist, source) {
    if (rawSpecialist === undefined || rawSpecialist === null) return undefined;
    if (!isPlainObject(rawSpecialist) || !rawSpecialist.id || typeof rawSpecialist.id !== 'string') {
        throw invalidRecord('Invalid specialist profile', source, ['specialist']);
    }
    const normalized = compactObject({
        id: rawSpecialist.id,
        label: rawSpecialist.label,
        instructionsRef: rawSpecialist.instructionsRef,
        skillRefs: rawSpecialist.skillRefs,
    });
    if (normalized.skillRefs !== undefined && !Array.isArray(normalized.skillRefs)) {
        throw invalidRecord('Invalid specialist skillRefs', source, ['specialist.skillRefs']);
    }
    return normalized;
}

function normalizeHost(raw, source) {
    if (raw.host !== undefined) {
        if (!isPlainObject(raw.host) || !raw.host.kind || typeof raw.host.kind !== 'string') {
            throw invalidRecord('Invalid host binding', source, ['host']);
        }
        return {
            kind: raw.host.kind,
            handle: isPlainObject(raw.host.handle) ? raw.host.handle : {},
        };
    }
    if (raw.tmuxId !== undefined || raw.shellPid !== undefined) {
        return {
            kind: 'tmux',
            handle: compactObject({
                tmuxId: raw.tmuxId,
                shellPid: raw.shellPid,
                sessionName: raw.sessionName,
            }),
        };
    }
    return undefined;
}

function inferTranscriptProvider(raw, agent) {
    if (raw.transcriptBinding && raw.transcriptBinding.provider) return raw.transcriptBinding.provider;
    if (raw.agentSessionProvider) return raw.agentSessionProvider;
    return PROVIDER_BY_AGENT_ID[agent && agent.id] || undefined;
}

function normalizeTranscriptBinding(raw, agent, source) {
    const binding = raw.transcriptBinding || {};
    const providerSessionId = binding.providerSessionId || raw.agentSessionId;
    const transcriptPath = binding.path || raw.agentSessionPath;
    if (!providerSessionId && !transcriptPath && !binding.provider && !binding.capturedAt) return undefined;
    if (binding.capturedAt !== undefined) validateTimestamp(binding.capturedAt, 'transcriptBinding.capturedAt', source);
    return compactObject({
        provider: inferTranscriptProvider(raw, agent),
        providerSessionId,
        path: transcriptPath,
        capturedAt: binding.capturedAt || raw.agentSessionCapturedAt,
    });
}

function normalizePaths(raw) {
    const paths = raw.paths || {};
    return compactObject({
        repoPath: paths.repoPath || raw.repoPath,
        worktreePath: paths.worktreePath || raw.worktreePath,
        cwd: paths.cwd || raw.cwd,
    });
}

function normalizeAgentSessionRecord(raw, source = 'record') {
    assertPlainObject(raw, source);
    const sessionId = raw.sessionId || raw.sessionName;
    if (!sessionId || typeof sessionId !== 'string') {
        throw invalidRecord('Missing session id', source, ['sessionId']);
    }

    const category = raw.category || (raw.entity || raw.entityType ? SESSION_CATEGORIES.ENTITY : SESSION_CATEGORIES.REPO);
    if (!Object.values(SESSION_CATEGORIES).includes(category)) {
        throw invalidRecord('Invalid session category', source, ['category']);
    }

    const role = category === SESSION_CATEGORIES.REPO ? null : raw.role;
    if (role !== null && !Object.values(SESSION_ROLES).includes(role)) {
        throw invalidRecord('Invalid session role', source, ['role']);
    }

    const entity = raw.entity
        ? normalizeEntity(raw.entity.type, raw.entity.id, category, source)
        : normalizeEntity(raw.entityType, raw.entityId, category, source);
    // `auto` conductor sessions (per-entity and set-autonomous) are agent-less.
    const allowAnonymousAgent = role === SESSION_ROLES.AUTO;
    const agent = normalizeAgent(raw.agent, raw.agentId, source, raw, allowAnonymousAgent);
    const state = raw.state || SESSION_STATES.UNKNOWN;
    if (!Object.values(SESSION_STATES).includes(state)) {
        throw invalidRecord('Invalid session state', source, ['state']);
    }

    const normalized = {
        ...raw,
        sessionId,
        sessionName: raw.sessionName || sessionId,
        category,
        entity,
        entityType: raw.entityType || (entity && entity.type),
        entityId: raw.entityId || (entity && entity.id),
        role,
        agent,
        specialist: normalizeSpecialist(raw.specialist, source),
        state,
        host: normalizeHost(raw, source),
        paths: normalizePaths(raw),
        transcriptBinding: normalizeTranscriptBinding(raw, agent, source),
        createdAt: validateTimestamp(raw.createdAt, 'createdAt', source),
        updatedAt: validateTimestamp(raw.updatedAt, 'updatedAt', source),
        startedAt: validateTimestamp(raw.startedAt, 'startedAt', source),
        stoppedAt: validateTimestamp(raw.stoppedAt, 'stoppedAt', source),
        metadata: raw.metadata === undefined ? undefined : raw.metadata,
    };

    if (normalized.metadata !== undefined && !isPlainObject(normalized.metadata)) {
        throw invalidRecord('Invalid metadata', source, ['metadata']);
    }
    return compactObject(normalized);
}

function validateAgentSessionStartRequest(request) {
    try {
        if (!isPlainObject(request)) {
            throw invalidRecord('AgentSession start request must be an object', 'startRequest', ['request']);
        }
        const category = request && request.category ? request.category : SESSION_CATEGORIES.ENTITY;
        const raw = {
            ...request,
            category,
            state: request.state || SESSION_STATES.REQUESTED,
        };
        return normalizeAgentSessionRecord(raw, 'startRequest');
    } catch (err) {
        if (err && err.code === ERROR_CODES.INVALID_RECORD) {
            throw createAgentSessionError(ERROR_CODES.INVALID_REQUEST, err.message, err.details);
        }
        throw err;
    }
}

module.exports = {
    ENTITY_TYPES,
    SESSION_CATEGORIES,
    SESSION_ROLES,
    SESSION_STATES,
    normalizeAgentSessionRecord,
    validateAgentSessionStartRequest,
};
