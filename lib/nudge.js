'use strict';

const path = require('path');
const agentRegistry = require('./agent-registry');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowEngine = require('./workflow-core/engine');
const { getEventsPathForEntity } = require('./workflow-core/paths');
const { readEvents } = require('./workflow-core/event-store');
const { buildTmuxSessionName, tmuxSessionExists, runTmux } = require('./worktree');

const DEFAULT_ROLE = 'do';
const SUPPORTED_ROLES = new Set(['do', 'review', 'spec-review', 'auto']);
const NUDGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const NUDGE_RATE_LIMIT_MAX = 10;
const NUDGE_HISTORY_LIMIT = 20;
const CAPTURE_PANE_LINES = 60;

function normalizeId(id) {
    return /^\d+$/.test(String(id || '').trim())
        ? String(parseInt(String(id), 10)).padStart(2, '0')
        : String(id || '').trim();
}

function normalizeEntityType(entityType) {
    return entityType === 'research' ? 'research' : 'feature';
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
        };
    }

    const requested = entityTypeHint || 'feature/research';
    throw new Error(`Could not resolve active ${requested} ${rawId}. If workflow state is missing, run \`aigon doctor --fix\`.`);
}

async function readEntityEvents(repoPath, entityType, entityId) {
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

function appendRing(list, entry, limit = NUDGE_HISTORY_LIMIT) {
    return [...(Array.isArray(list) ? list : []), entry].slice(-limit);
}

function resolveSessions(entity, role, explicitAgentId) {
    const snapshotAgents = Object.keys((entity.snapshot && entity.snapshot.agents) || {});
    const active = snapshotAgents
        .map(agentId => {
            const sessionName = buildTmuxSessionName(entity.entityId, agentId, {
                desc: entity.desc,
                entityType: entity.entityType === 'research' ? 'r' : 'f',
                role,
            });
            return {
                agentId,
                role,
                sessionName,
                running: tmuxSessionExists(sessionName),
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

async function assertBelowRateLimit(repoPath, entityType, entityId, agentId, role, nowIso) {
    const events = await readEntityEvents(repoPath, entityType, entityId);
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

function loadBuffer(message) {
    const result = runTmux(['load-buffer', '-'], {
        input: message,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux load-buffer failed').trim());
    }
}

function pasteBuffer(sessionName) {
    const result = runTmux(['paste-buffer', '-t', sessionName, '-p'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux paste-buffer failed').trim());
    }
}

function sendSubmitKey(sessionName, submitKey) {
    const result = runTmux(['send-keys', '-t', sessionName, submitKey], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux send-keys failed').trim());
    }
}

function capturePane(sessionName) {
    const result = runTmux(['capture-pane', '-p', '-t', sessionName, '-S', `-${CAPTURE_PANE_LINES}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux capture-pane failed').trim());
    }
    return String(result.stdout || '');
}

function sleepMs(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // Busy wait keeps this helper synchronous without extra process churn.
    }
}

function confirmDelivery(sessionName, message) {
    let paneTail = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) sleepMs(80);
        paneTail = capturePane(sessionName);
        if (paneTail.includes(message)) {
            return { ok: true, paneTail };
        }
    }
    return { ok: false, paneTail };
}

async function recordNudgeEvent(repoPath, entity, session, message, atISO) {
    const event = {
        type: 'operator.nudge_sent',
        [entity.entityType === 'research' ? 'researchId' : 'featureId']: entity.entityId,
        agentId: session.agentId,
        role: session.role,
        text: message,
        at: atISO,
        atISO,
    };
    await workflowEngine.persistEntityEvents(repoPath, entity.entityType, entity.entityId, [event]);
    return event;
}

async function sendNudge(repoPath, rawId, message, options = {}) {
    const text = String(message || '');
    if (!text.trim()) {
        throw new Error('Nudge message is required');
    }

    const role = String(options.role || DEFAULT_ROLE).trim() || DEFAULT_ROLE;
    if (!SUPPORTED_ROLES.has(role)) {
        throw new Error(`Unsupported role "${role}". Supported roles: ${[...SUPPORTED_ROLES].join(', ')}`);
    }

    const entity = resolveEntity(repoPath, rawId, options);
    const explicitAgentId = options.agentId ? String(options.agentId).trim() : null;
    const session = resolveSessions(entity, role, explicitAgentId);
    const submitKey = resolveSubmitKey(session.agentId);
    const atISO = new Date().toISOString();

    await assertBelowRateLimit(repoPath, entity.entityType, entity.entityId, session.agentId, session.role, atISO);

    loadBuffer(text);
    pasteBuffer(session.sessionName);
    sendSubmitKey(session.sessionName, submitKey);

    const confirmation = confirmDelivery(session.sessionName, text);
    if (!confirmation.ok) {
        const error = new Error('Nudge text not found in pane after delivery');
        error.paneTail = confirmation.paneTail;
        throw error;
    }

    const event = await recordNudgeEvent(repoPath, entity, session, text, atISO);
    return {
        ok: true,
        entityType: entity.entityType,
        entityId: entity.entityId,
        agentId: session.agentId,
        role: session.role,
        sessionName: session.sessionName,
        event,
        paneTail: confirmation.paneTail,
    };
}

module.exports = {
    DEFAULT_ROLE,
    NUDGE_HISTORY_LIMIT,
    resolveSubmitKey,
    resolveEntity,
    resolveSessions,
    sendNudge,
    appendRing,
};
