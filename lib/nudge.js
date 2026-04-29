'use strict';

const path = require('path');
const agentRegistry = require('./agent-registry');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowEngine = require('./workflow-core/engine');
const { getEventsPathForEntity } = require('./workflow-core/paths');
const { readEvents } = require('./workflow-core/event-store');
const { buildTmuxSessionName, tmuxSessionExists, runTmux } = require('./worktree');
const { recordSignalEvent } = require('./signal-health');

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

function loadBuffer(message, deps = {}) {
    const tmux = typeof deps.runTmux === 'function' ? deps.runTmux : runTmux;
    const result = tmux(['load-buffer', '-'], {
        input: message,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux load-buffer failed').trim());
    }
}

function pasteBuffer(sessionName, deps = {}) {
    const tmux = typeof deps.runTmux === 'function' ? deps.runTmux : runTmux;
    const result = tmux(['paste-buffer', '-t', sessionName, '-p'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux paste-buffer failed').trim());
    }
}

function sendSubmitKey(sessionName, submitKey, deps = {}) {
    const tmux = typeof deps.runTmux === 'function' ? deps.runTmux : runTmux;
    const normalizedSubmitKey = String(submitKey || '').trim() === 'Enter' ? 'C-m' : submitKey;
    const result = tmux(['send-keys', '-t', sessionName, normalizedSubmitKey], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
        throw new Error((result.stderr || (result.error && result.error.message) || 'tmux send-keys failed').trim());
    }
}

function capturePane(sessionName, deps = {}) {
    const tmux = typeof deps.runTmux === 'function' ? deps.runTmux : runTmux;
    const result = tmux(['capture-pane', '-p', '-t', sessionName, '-S', `-${CAPTURE_PANE_LINES}`], {
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

function extractLastPromptLine(paneTail) {
    const lines = String(paneTail || '').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (/^>/.test(line)) return line;
    }
    return '';
}

function paneMatchesAny(paneTail, patterns) {
    return patterns.some(pattern => String(paneTail || '').includes(pattern));
}

function promptStillContainsMessage(paneTail, message) {
    const promptLine = extractLastPromptLine(paneTail);
    return !!promptLine && promptLine.includes(String(message || ''));
}

function promptShowsPlaceholder(paneTail, placeholder) {
    if (!placeholder) return false;
    const promptLine = extractLastPromptLine(paneTail);
    return !!promptLine && promptLine.includes(placeholder);
}

function confirmDelivery(sessionName, message, deps = {}) {
    let paneTail = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) sleepMs(80);
        paneTail = capturePane(sessionName, deps);
        if (paneTail.includes(message)) {
            return { ok: true, paneTail };
        }
    }
    return { ok: false, paneTail };
}

function submitNudge(sessionName, text, transport, deps = {}) {
    const attempts = Math.max(1, transport && transport.submitAttempts || 1);
    const retryDelayMs = Math.max(0, transport && transport.retryDelayMs || 0);
    let paneTail = '';

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        sendSubmitKey(sessionName, transport.submitKey, deps);
        if (retryDelayMs > 0) sleepMs(retryDelayMs);
        paneTail = capturePane(sessionName, deps);

        const sawSuccess = paneMatchesAny(paneTail, transport.successPatterns || [])
            || promptShowsPlaceholder(paneTail, transport.promptPlaceholder || '');
        if (sawSuccess) {
            return { ok: true, paneTail };
        }

        if (!promptStillContainsMessage(paneTail, text)) {
            return { ok: true, paneTail };
        }
    }

    return { ok: false, paneTail };
}

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

    loadBuffer(text, deps);
    pasteBuffer(session.sessionName, deps);
    const confirmation = confirmDelivery(session.sessionName, text, deps);
    if (!confirmation.ok) {
        const error = new Error('Nudge text not found in pane after delivery');
        error.paneTail = confirmation.paneTail;
        throw error;
    }
    const submit = submitNudge(session.sessionName, text, transport, deps);
    if (!submit.ok) {
        const error = new Error('Nudge submit did not complete');
        error.paneTail = submit.paneTail;
        throw error;
    }

    const event = await recordNudgeEvent(repoPath, entity, session, text, atISO, deps);
    recordSignalEvent({
        repoPath,
        kind: 'signal-recovered-via-nudge',
        agent: session.agentId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        role: session.role,
        sessionName: session.sessionName,
        source: 'aigon nudge',
    });
    return {
        ok: true,
        entityType: entity.entityType,
        entityId: entity.entityId,
        agentId: session.agentId,
        role: session.role,
        sessionName: session.sessionName,
        event,
        paneTail: submit.paneTail,
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
