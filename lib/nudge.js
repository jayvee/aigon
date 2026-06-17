'use strict';

const fs = require('fs');
const path = require('path');
const agentRegistry = require('./agent-registry');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowEngine = require('./workflow-core/engine');
const { getEventsPathForEntity } = require('./workflow-core/paths');
const { readEvents } = require('./workflow-core/event-store');
const { buildTmuxSessionName, tmuxSessionExists } = require('./worktree');
const { injectLiteral: tmuxInjectLiteral } = require('./tmux-inject');
const { createTmuxSessionHost } = require('./agent-sessions/hosts');
const signalHealth = require('./signal-health');

const DEFAULT_ROLE = 'do';
const SUPPORTED_ROLES = new Set(['do', 'review', 'spec-review', 'auto']);
const NUDGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const NUDGE_RATE_LIMIT_MAX = 10;
const NUDGE_HISTORY_LIMIT = 20;

function normalizeId(id) {
    return /^\d+$/.test(String(id || '').trim())
        ? String(parseInt(String(id), 10)).padStart(2, '0')
        : String(id || '').trim();
}

function normalizeEntityType(entityType) {
    return entityType === 'research' ? 'research' : 'feature';
}

/** Read agent status JSON without importing agent-status (avoid circular requires via dashboard collectors). */
function readAgentStatusPayload(repoPath, entityType, entityId, agentId) {
    const prefix = normalizeEntityType(entityType);
    const raw = String(entityId || '').trim();
    const ids = /^\d+$/.test(raw)
        ? [...new Set([String(parseInt(raw, 10)).padStart(2, '0'), String(parseInt(raw, 10))])]
        : [raw];
    const stateDir = path.join(repoPath, '.aigon', 'state');
    for (const cid of ids) {
        const fp = path.join(stateDir, `${prefix}-${cid}-${agentId}.json`);
        if (!fs.existsSync(fp)) continue;
        try {
            return JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch (_) {
            return null;
        }
    }
    return null;
}

function parseEntityDesc(entityType, specPath) {
    const file = path.basename(specPath || '');
    const match = entityType === 'research'
        ? file.match(/^research-(?:\d+-)?(.+)\.md$/)
        : file.match(/^feature-(?:\d+-)?(.+)\.md$/);
    return match ? match[1] : null;
}

function resolveEntity(repoPath, rawId, options = {}) {
    const entityTypeHint = options.entityType ? normalizeEntityType(options.entityType) : null;
    const id = normalizeId(rawId);
    const candidates = entityTypeHint ? [entityTypeHint] : ['feature', 'research'];

    for (const entityType of candidates) {
        const resolved = entityType === 'research'
            ? featureSpecResolver.resolveResearchSpec(repoPath, id)
            : featureSpecResolver.resolveFeatureSpec(repoPath, id);
        const workflowSnapshot = resolved && resolved.snapshot ? resolved.snapshot : null;
        if (!resolved || !resolved.path || !workflowSnapshot) continue;
        return {
            entityType,
            entityId: id,
            snapshot: workflowSnapshot,
            specPath: resolved.path,
            desc: parseEntityDesc(entityType, resolved.path),
            repoPath,
        };
    }

    const requested = entityTypeHint || 'feature/research';
    throw new Error(`Could not resolve active ${requested} ${rawId}. If workflow state is missing, run \`aigon doctor --fix\`.`);
}

async function readEntityEvents(repoPath, entityType, entityId, deps = {}) {
    if (typeof deps.readEntityEvents === 'function') {
        return deps.readEntityEvents(repoPath, entityType, entityId);
    }
    return readEvents(getEventsPathForEntity(repoPath, entityType, entityId));
}

function resolveSubmitKey(agentId) {
    const agent = agentRegistry.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent "${agentId}"`);
    const submitKey = agent.cli && Object.prototype.hasOwnProperty.call(agent.cli, 'submitKey')
        ? agent.cli.submitKey
        : 'Enter';
    if (!submitKey) {
        throw new Error(`nudge not supported for ${agentId}`);
    }
    return submitKey;
}

function resolveNudgeTransport(agentId) {
    const agent = agentRegistry.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent "${agentId}"`);
    const cli = agent.cli || {};
    const transport = cli.nudgeTransport && typeof cli.nudgeTransport === 'object'
        ? cli.nudgeTransport
        : {};
    return {
        submitKey: Object.prototype.hasOwnProperty.call(transport, 'submitKey')
            ? transport.submitKey
            : resolveSubmitKey(agentId),
        submitAttempts: Math.max(1, parseInt(transport.submitAttempts, 10) || 1),
        retryDelayMs: Math.max(0, parseInt(transport.retryDelayMs, 10) || 150),
        successPatterns: Array.isArray(transport.successPatterns)
            ? transport.successPatterns.filter(Boolean).map(String)
            : [],
        promptPlaceholder: transport.promptPlaceholder ? String(transport.promptPlaceholder) : '',
        // When true, skip paste-buffer and use send-keys -l + Enter (same as injection subshell).
        // Use for TUIs that don't handle paste-buffer + C-m reliably (e.g. kimi).
        useSendKeys: transport.useSendKeys === true,
    };
}

function appendRing(list, entry, limit = NUDGE_HISTORY_LIMIT) {
    return [...(Array.isArray(list) ? list : []), entry].slice(-limit);
}

function collectCandidateAgentIds(entity, role, explicitAgentId) {
    if (role === 'auto') return [null];

    const candidates = [];
    const seen = new Set();
    const push = (agentId) => {
        const value = agentId == null ? null : String(agentId).trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        candidates.push(value);
    };

    push(explicitAgentId);

    const snapshot = entity && entity.snapshot ? entity.snapshot : {};
    const snapshotAgents = Object.keys(snapshot.agents || {});
    if (role === 'do') {
        snapshotAgents.forEach(push);
        return candidates;
    }

    if (role === 'review') {
        push(snapshot.codeReview && snapshot.codeReview.activeReviewerId);
        push(snapshot.pendingCodeReviewer);
    } else if (role === 'spec-review') {
        const specReview = snapshot.specReview || {};
        (Array.isArray(specReview.activeReviewers) ? specReview.activeReviewers : []).forEach(push);
        (Array.isArray(specReview.activeCheckers) ? specReview.activeCheckers : []).forEach(push);
        (Array.isArray(specReview.pendingAgents) ? specReview.pendingAgents : []).forEach(push);
        push(snapshot.pendingSpecReviewer);
    }

    snapshotAgents.forEach(push);
    return candidates;
}

/**
 * Read the durable `tmuxId` for a session from its sidecar so operator-message
 * delivery can route by ID (preferred) and fall back to name only for old
 * sidecars that predate the foreign key (F554 / F351).
 */
function readSessionTmuxId(repoPath, sessionName, deps = {}) {
    if (typeof deps.readSessionTmuxId === 'function') return deps.readSessionTmuxId(repoPath, sessionName);
    if (!repoPath || !sessionName) return null;
    try {
        const sidecarPath = path.join(repoPath, '.aigon', 'sessions', `${sessionName}.json`);
        const raw = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
        return raw && raw.tmuxId ? String(raw.tmuxId) : null;
    } catch (_) {
        return null;
    }
}

function resolveSessions(entity, role, explicitAgentId, deps = {}) {
    const sessionExists = typeof deps.tmuxSessionExists === 'function' ? deps.tmuxSessionExists : tmuxSessionExists;
    const repoOpt = entity.repoPath ? { repo: path.basename(entity.repoPath) } : {};
    const active = collectCandidateAgentIds(entity, role, explicitAgentId)
        .map(agentId => {
            const sessionName = buildTmuxSessionName(entity.entityId, agentId, {
                ...repoOpt,
                desc: entity.desc,
                entityType: entity.entityType === 'research' ? 'r' : 'f',
                role,
            });
            return {
                agentId,
                role,
                sessionName,
                tmuxId: readSessionTmuxId(entity.repoPath, sessionName, deps),
                running: sessionExists(sessionName),
            };
        })
        .filter(entry => entry.running);

    if (explicitAgentId) {
        const match = active.find(entry => entry.agentId === explicitAgentId);
        if (!match) {
            throw new Error(`No active ${role} session for ${entity.entityType} ${entity.entityId} agent ${explicitAgentId}`);
        }
        return match;
    }

    if (active.length === 1) return active[0];
    if (active.length === 0) {
        throw new Error(`No active ${role} sessions found for ${entity.entityType} ${entity.entityId}`);
    }
    const names = active.map(entry => entry.agentId).join(', ');
    throw new Error(`Multiple active ${role} sessions found for ${entity.entityType} ${entity.entityId}: ${names}. Specify an agent.`);
}

async function assertBelowRateLimit(repoPath, entityType, entityId, agentId, role, nowIso, deps = {}) {
    const events = await readEntityEvents(repoPath, entityType, entityId, deps);
    const cutoff = new Date(nowIso).getTime() - NUDGE_RATE_LIMIT_WINDOW_MS;
    const recent = events.filter(event => (
        event.type === 'operator.nudge_sent'
        && event.agentId === agentId
        && (event.role || DEFAULT_ROLE) === role
        && new Date(event.at || event.atISO || 0).getTime() >= cutoff
    ));
    if (recent.length >= NUDGE_RATE_LIMIT_MAX) {
        throw new Error(`Rate limit exceeded for ${agentId} ${role} session: max ${NUDGE_RATE_LIMIT_MAX} nudges per minute`);
    }
}

// F554: paste-buffer / send-keys / capture-pane orchestration moved into the
// TmuxSessionHost (lib/agent-sessions/hosts/tmux.js). nudge now resolves the
// session + transport and delegates delivery to host.deliverOperatorMessage.

async function recordNudgeEvent(repoPath, entity, session, message, atISO, deps = {}) {
    const event = {
        type: 'operator.nudge_sent',
        [entity.entityType === 'research' ? 'researchId' : 'featureId']: entity.entityId,
        agentId: session.agentId,
        role: session.role,
        text: message,
        at: atISO,
        atISO,
    };
    const persistEntityEvents = typeof deps.persistEntityEvents === 'function'
        ? deps.persistEntityEvents
        : workflowEngine.persistEntityEvents;
    await persistEntityEvents(repoPath, entity.entityType, entity.entityId, [event]);
    return event;
}

async function sendNudge(repoPath, rawId, message, options = {}) {
    const deps = options._deps || {};
    const text = String(message || '');
    if (!text.trim()) {
        throw new Error('Nudge message is required');
    }

    const role = String(options.role || DEFAULT_ROLE).trim() || DEFAULT_ROLE;
    if (!SUPPORTED_ROLES.has(role)) {
        throw new Error(`Unsupported role "${role}". Supported roles: ${[...SUPPORTED_ROLES].join(', ')}`);
    }

    const entity = (typeof deps.resolveEntity === 'function' ? deps.resolveEntity : resolveEntity)(repoPath, rawId, options);
    const explicitAgentId = options.agentId ? String(options.agentId).trim() : null;
    const session = (typeof deps.resolveSessions === 'function'
        ? deps.resolveSessions
        : resolveSessions)(entity, role, explicitAgentId, deps);
    const transport = session.agentId
        ? (typeof deps.resolveNudgeTransport === 'function' ? deps.resolveNudgeTransport : resolveNudgeTransport)(session.agentId)
        : { submitKey: 'Enter', submitAttempts: 1, retryDelayMs: 0, successPatterns: [], promptPlaceholder: '' };
    const atISO = new Date().toISOString();

    await (typeof deps.assertBelowRateLimit === 'function'
        ? deps.assertBelowRateLimit(repoPath, entity.entityType, entity.entityId, session.agentId, session.role, atISO)
        : assertBelowRateLimit(repoPath, entity.entityType, entity.entityId, session.agentId, session.role, atISO, deps));

    // Delivery is routed through the TmuxSessionHost (F554). The host prefers the
    // durable tmuxId target and owns the paste-buffer / send-keys orchestration;
    // nudge keeps resolution, rate-limiting, and event recording. Inject deps.runTmux
    // into the host so unit tests stay hermetic; production uses worktree's runTmux.
    const host = (typeof deps.host === 'object' && deps.host)
        ? deps.host
        : createTmuxSessionHost(typeof deps.runTmux === 'function' ? { runTmux: deps.runTmux } : {});
    const sessionRef = { sessionName: session.sessionName, tmuxId: session.tmuxId || null };
    const delivery = host.deliverOperatorMessage(sessionRef, text, {
        transport,
        injectLiteral: typeof deps.injectLiteral === 'function' ? deps.injectLiteral : tmuxInjectLiteral,
        injectDeps: typeof deps.runTmux === 'function' ? { runTmux: deps.runTmux } : undefined,
    });
    const submitPaneTail = delivery && delivery.paneTail ? delivery.paneTail : '';

    const event = await recordNudgeEvent(repoPath, entity, session, text, atISO, deps);
    const statusPayload = readAgentStatusPayload(repoPath, entity.entityType, entity.entityId, session.agentId);
    const stuckStatus = statusPayload && statusPayload.status;
    if (stuckStatus) {
        signalHealth.writeNudgeRecoveryPending(repoPath, {
            entityType: entity.entityType,
            entityId: entity.entityId,
            agent: session.agentId,
            stuckStatus,
            sessionName: session.sessionName,
        });
    }
    return {
        ok: true,
        entityType: entity.entityType,
        entityId: entity.entityId,
        agentId: session.agentId,
        role: session.role,
        sessionName: session.sessionName,
        event,
        paneTail: submitPaneTail,
    };
}

module.exports = {
    DEFAULT_ROLE,
    NUDGE_HISTORY_LIMIT,
    resolveSubmitKey,
    resolveNudgeTransport,
    resolveEntity,
    resolveSessions,
    sendNudge,
    appendRing,
};
