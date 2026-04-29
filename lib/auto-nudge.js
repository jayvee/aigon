'use strict';

const { loadProjectConfig } = require('./config');
const { sendNudge } = require('./nudge');
const signalHealth = require('./signal-health');

const DEFAULT_AUTO_NUDGE = Object.freeze({
    enabled: false,
    idleVisibleSec: 60,
    idleAutoNudgeSec: 180,
    idleEscalateSec: 300,
    message: 'You appear idle at the prompt. Continue the task, or report the blocker and the next action needed.',
    perAgent: {},
});

const sessionState = new Map();
const pausedSessions = new Set();

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConfig(repoPath, agentId, deps = {}) {
    const loadConfig = typeof deps.loadProjectConfig === 'function' ? deps.loadProjectConfig : loadProjectConfig;
    const projectConfig = loadConfig(repoPath) || {};
    const root = projectConfig.autoNudge && typeof projectConfig.autoNudge === 'object'
        ? projectConfig.autoNudge
        : {};
    const perAgentRoot = root.perAgent && typeof root.perAgent === 'object' ? root.perAgent : {};
    const perAgent = perAgentRoot[agentId] && typeof perAgentRoot[agentId] === 'object'
        ? perAgentRoot[agentId]
        : {};
    const merged = { ...DEFAULT_AUTO_NUDGE, ...root, ...perAgent };
    return {
        enabled: root.enabled === true,
        agentEnabled: perAgent.enabled !== false,
        idleVisibleSec: parsePositiveInt(merged.idleVisibleSec, DEFAULT_AUTO_NUDGE.idleVisibleSec),
        idleAutoNudgeSec: parsePositiveInt(merged.idleAutoNudgeSec, DEFAULT_AUTO_NUDGE.idleAutoNudgeSec),
        idleEscalateSec: parsePositiveInt(merged.idleEscalateSec, DEFAULT_AUTO_NUDGE.idleEscalateSec),
        message: String(merged.message || DEFAULT_AUTO_NUDGE.message),
    };
}

function keyFor(input = {}) {
    return [
        input.repoPath || '',
        input.entityType === 'research' ? 'research' : 'feature',
        input.entityId || '',
        input.agentId || '',
        input.sessionName || '',
    ].join(':');
}

function getIdleSec(input, nowMs) {
    if (!input.tmuxRunning || !input.idleAtPrompt) return 0;
    const statusMs = new Date(input.updatedAt || 0).getTime();
    const promptMs = new Date(input.idleAtPromptDetectedAt || 0).getTime();
    if (!Number.isFinite(statusMs) || statusMs <= 0) return 0;
    if (!Number.isFinite(promptMs) || promptMs <= 0) return 0;
    return Math.max(0, Math.floor((nowMs - Math.max(statusMs, promptMs)) / 1000));
}

function isQuotaPaused(input = {}) {
    const status = String(input.status || '').toLowerCase();
    const flags = input.flags && typeof input.flags === 'object' ? input.flags : {};
    return status === 'quota-paused'
        || flags.quotaPaused === true
        || flags.quota === 'paused'
        || flags.tokenExhausted === true;
}

function recordOnce(state, field, event) {
    if (state[field]) return;
    state[field] = true;
    signalHealth.recordSignalEvent(event);
}

function maybeDispatchNudge(repoPath, input, cfg, state, deps = {}) {
    if (state.nudged || state.nudgeInFlight || state.paused || !cfg.enabled || !cfg.agentEnabled) return;
    state.nudged = true;
    state.nudgeInFlight = true;
    state.nudgedAt = new Date().toISOString();
    const nudgeFn = typeof deps.sendNudge === 'function' ? deps.sendNudge : sendNudge;
    Promise.resolve(nudgeFn(repoPath, input.entityId, cfg.message, {
        agentId: input.agentId,
        role: input.role || 'do',
        entityType: input.entityType || 'feature',
    })).catch(error => {
        signalHealth.recordSignalEvent({
            repoPath,
            kind: 'signal-abandoned',
            agent: input.agentId,
            entityType: input.entityType,
            entityId: input.entityId,
            sessionName: input.sessionName,
            source: 'auto-nudge-dispatch-failed',
            reason: error && error.message ? error.message : 'auto-nudge failed',
        });
    }).finally(() => {
        state.nudgeInFlight = false;
    });
}

function computeIdleLadder(repoPath, input = {}, deps = {}) {
    const nowMs = deps.nowMs || Date.now();
    const cfg = resolveConfig(repoPath, input.agentId, deps);
    const sessionKey = keyFor({ repoPath, ...input });
    let state = sessionState.get(sessionKey);
    if (!state) {
        state = { nudged: false, escalated: false, visibleRecorded: false };
        sessionState.set(sessionKey, state);
    }
    state.paused = pausedSessions.has(sessionKey);

    if (isQuotaPaused(input)) {
        return { state: 'active', idleSec: 0, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, paused: state.paused, skipped: 'quota-paused' };
    }

    const idleSec = getIdleSec(input, nowMs);
    if (idleSec < cfg.idleVisibleSec) {
        return { state: 'active', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, paused: state.paused };
    }

    recordOnce(state, 'visibleRecorded', {
        repoPath,
        kind: 'signal-emitted',
        agent: input.agentId,
        entityType: input.entityType,
        entityId: input.entityId,
        sessionName: input.sessionName,
        source: 'auto-nudge-idle-visible',
        elapsedSec: idleSec,
        status: input.status || null,
    });

    if (idleSec >= cfg.idleEscalateSec) {
        recordOnce(state, 'escalated', {
            repoPath,
            kind: 'signal-abandoned',
            agent: input.agentId,
            entityType: input.entityType,
            entityId: input.entityId,
            sessionName: input.sessionName,
            source: 'auto-nudge-escalated',
            elapsedSec: idleSec,
            reason: state.nudged ? 'no-signal-after-auto-nudge' : 'idle-threshold-reached',
        });
        return { state: 'needs-attention', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, paused: state.paused, nudged: state.nudged };
    }

    if (idleSec >= cfg.idleAutoNudgeSec) {
        maybeDispatchNudge(repoPath, input, cfg, state, deps);
        return { state: state.nudged ? 'idle-nudged' : 'idle-visible', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, paused: state.paused, nudged: state.nudged };
    }

    return { state: 'idle-visible', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, paused: state.paused };
}

function pauseAutoNudgeForSession(repoPath, input = {}) {
    const key = keyFor({ repoPath, ...input });
    pausedSessions.add(key);
    const state = sessionState.get(key) || {};
    state.paused = true;
    sessionState.set(key, state);
    return { ok: true, key };
}

function _resetForTests() {
    sessionState.clear();
    pausedSessions.clear();
}

module.exports = {
    DEFAULT_AUTO_NUDGE,
    computeIdleLadder,
    pauseAutoNudgeForSession,
    _resetForTests,
};
