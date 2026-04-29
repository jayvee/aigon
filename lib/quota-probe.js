'use strict';

const fs = require('fs');
const path = require('path');

const agentRegistry = require('./agent-registry');
const { getEffectiveConfig } = require('./config');
const probeAgent = require('../scripts/probe-agent');

const STATE_PATH = path.join(process.cwd(), '.aigon', 'state', 'quota.json');
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_MAX_BACKOFF_SECONDS = 3600;
const OUTPUT_LIMIT = 500;
const VERDICTS = new Set(['available', 'depleted', 'unknown', 'error']);

function nowIso() {
    return new Date().toISOString();
}

function quotaConfig(repoPath = process.cwd()) {
    const cfg = getEffectiveConfig(repoPath).quota || {};
    return {
        pollIntervalSeconds: Number(cfg.pollIntervalSeconds) > 0 ? Number(cfg.pollIntervalSeconds) : DEFAULT_POLL_INTERVAL_SECONDS,
        maxBackoffSeconds: Number(cfg.maxBackoffSeconds) > 0 ? Number(cfg.maxBackoffSeconds) : DEFAULT_MAX_BACKOFF_SECONDS,
    };
}

function statePath(repoPath = process.cwd()) {
    return path.join(repoPath, '.aigon', 'state', 'quota.json');
}

function emptyState() {
    return { schemaVersion: 1, agents: {} };
}

function readQuotaState(repoPath = process.cwd()) {
    const file = statePath(repoPath);
    if (!fs.existsSync(file)) return emptyState();
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && parsed.schemaVersion === 1 && parsed.agents ? parsed : emptyState();
    } catch (_) {
        return emptyState();
    }
}

function writeQuotaState(state, repoPath = process.cwd()) {
    const file = statePath(repoPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, file);
}

function truncateOutput(value) {
    return String(value || '').replace(/\s+$/g, '').slice(0, OUTPUT_LIMIT);
}

function combinedOutput(result) {
    if (!result) return '';
    return [result.output, result.error, result.stderr, result.stdout]
        .filter(Boolean)
        .join('\n')
        .trim();
}

function compilePattern(pattern) {
    try {
        return new RegExp(pattern, 'ims');
    } catch (_) {
        return null;
    }
}

function parseRelativeReset(match) {
    const amount = Number(match[1]);
    const unit = String(match[2] || '').toLowerCase();
    if (!Number.isFinite(amount)) return null;
    const factor = unit.startsWith('hour') ? 3600 : unit.startsWith('min') ? 60 : 1;
    return new Date(Date.now() + amount * factor * 1000).toISOString();
}

function parseWallClockReset(match) {
    const hhmm = match[1];
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date();
    d.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() < Date.now() - 60_000) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
}

function extractResetAt(text, pattern) {
    if (!pattern || !pattern.resetExtractor) return null;
    const rx = compilePattern(pattern.resetExtractor);
    if (!rx) return null;
    const match = rx.exec(text);
    if (!match) return null;

    if (pattern.resetUnit === 'iso8601') {
        const raw = match[1] || match[0];
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (pattern.resetUnit === 'relative-seconds') {
        const secs = Number(match[1]);
        return Number.isFinite(secs) ? new Date(Date.now() + secs * 1000).toISOString() : null;
    }

    const relative = String(match[0]).match(/in\s+(\d+)\s*(hour|min|second)s?/i);
    if (relative) return parseRelativeReset(relative);
    const wall = String(match[0]).match(/\b(\d{1,2}:\d{2})\b/);
    if (wall) return parseWallClockReset(wall);
    const d = new Date(match[1] || match[0]);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function classifyProbeResult(agentConfig, probeResult) {
    const quota = agentConfig.quota || {};
    const text = combinedOutput(probeResult);
    const successPatterns = Array.isArray(quota.successPatterns) ? quota.successPatterns : ['PONG', 'pong'];
    if (probeResult && probeResult.ok) {
        const matchedSuccess = successPatterns.find(pattern => {
            const rx = compilePattern(pattern);
            return rx && rx.test(text);
        });
        if (matchedSuccess) {
            return {
                verdict: 'available',
                confidence: 'high',
                matchedPatternId: `success:${matchedSuccess}`,
                resetAt: null,
                probeOk: true,
            };
        }
    }

    for (const pattern of Array.isArray(quota.errorPatterns) ? quota.errorPatterns : []) {
        const rx = compilePattern(pattern.match);
        if (!rx || !rx.test(text)) continue;
        const verdict = VERDICTS.has(pattern.verdict) ? pattern.verdict : 'error';
        return {
            verdict,
            confidence: pattern.confidence || 'medium',
            matchedPatternId: pattern.id || null,
            resetAt: extractResetAt(text, pattern),
            probeOk: verdict === 'available',
        };
    }

    if (probeResult && probeResult.skipped) {
        return { verdict: 'unknown', confidence: 'high', matchedPatternId: null, resetAt: null, probeOk: false };
    }

    const unknownPolicy = quota.unknownPolicy || 'permit';
    return {
        verdict: unknownPolicy === 'block' ? 'error' : 'unknown',
        confidence: 'low',
        matchedPatternId: null,
        resetAt: null,
        probeOk: Boolean(probeResult && probeResult.ok),
    };
}

function toQuotaEntry(agentConfig, modelValue, modelLabel, probeResult, probedAt = nowIso()) {
    const classified = classifyProbeResult(agentConfig, probeResult);
    return {
        verdict: classified.verdict,
        remainingUnit: null,
        remaining: classified.verdict === 'depleted' ? 0 : null,
        resetAt: classified.resetAt,
        lastProbedAt: probedAt,
        probeMethod: probeResult && probeResult.skipped ? 'not-probeable' : 'cli-stdout-pattern',
        probeOk: classified.probeOk,
        lastProbeOutput: truncateOutput(combinedOutput(probeResult)),
        matchedPatternId: classified.matchedPatternId,
        confidence: classified.confidence,
        modelLabel: modelLabel || modelValue || '(agent default)',
    };
}

function agentEnabled(agentState) {
    const models = Object.values((agentState && agentState.models) || {});
    if (models.length === 0) return true;
    return models.some(m => m.verdict === 'available' || m.verdict === 'unknown');
}

function isPairDepleted(repoPath, agentId, modelValue) {
    const state = readQuotaState(repoPath);
    const modelKey = modelValue || '__default__';
    const entry = state.agents?.[agentId]?.models?.[modelKey];
    return entry && entry.verdict === 'depleted' ? entry : null;
}

function shouldProbe(entry, cfg = quotaConfig()) {
    if (!entry || !entry.lastProbedAt) return true;
    const last = new Date(entry.lastProbedAt).getTime();
    if (!Number.isFinite(last)) return true;
    const now = Date.now();
    if (entry.verdict === 'depleted' && entry.resetAt) {
        const reset = new Date(entry.resetAt).getTime();
        if (Number.isFinite(reset) && now < reset - 30_000) return false;
    }
    if (entry.verdict === 'depleted' && !entry.resetAt) {
        const prior = Math.max(cfg.pollIntervalSeconds, Number(entry.backoffSeconds || cfg.pollIntervalSeconds));
        return now - last >= Math.min(prior * 2, cfg.maxBackoffSeconds) * 1000;
    }
    return now - last >= cfg.pollIntervalSeconds * 1000;
}

function probePair({ repoPath = process.cwd(), agentId, modelValue = null, modelLabel = null, force = true } = {}) {
    const agentConfig = agentRegistry.getAgent(agentId);
    if (!agentConfig) throw new Error(`Unknown agent: ${agentId}`);
    const state = readQuotaState(repoPath);
    if (!state.agents[agentId]) state.agents[agentId] = { models: {} };
    const modelKey = modelValue || '__default__';
    const prev = state.agents[agentId].models[modelKey];
    if (!force && !shouldProbe(prev, quotaConfig(repoPath))) return { entry: prev, changed: false, skipped: true };

    const result = probeAgent.runProbe(agentConfig, modelValue, modelLabel || modelValue);
    const entry = toQuotaEntry(agentConfig, modelValue, modelLabel, result);
    if (entry.verdict === 'depleted' && !entry.resetAt) {
        const cfg = quotaConfig(repoPath);
        entry.backoffSeconds = Math.min(Math.max(cfg.pollIntervalSeconds, Number(prev?.backoffSeconds || cfg.pollIntervalSeconds) * 2), cfg.maxBackoffSeconds);
    }
    state.agents[agentId].models[modelKey] = entry;
    state.agents[agentId].lastRefreshedAt = entry.lastProbedAt;
    state.agents[agentId].agentEnabled = agentEnabled(state.agents[agentId]);
    const changed = JSON.stringify(prev || null) !== JSON.stringify(entry);
    writeQuotaState(state, repoPath);
    return { entry, changed, result };
}

function listTargets(agentId, { allModels = false, explicitModel = null } = {}) {
    const agentConfig = agentRegistry.getAgent(agentId);
    if (!agentConfig) throw new Error(`Unknown agent: ${agentId}`);
    return probeAgent.resolveTargets(agentConfig, { explicitModel, allModels });
}

function formatReset(entry) {
    if (!entry || !entry.resetAt) return 'unknown';
    return entry.resetAt;
}

function formatStartGateMessage({ agentId, modelValue, entry, featureId }) {
    const reset = entry.resetAt ? new Date(entry.resetAt) : null;
    const resetLine = reset && !Number.isNaN(reset.getTime())
        ? `   Resets at ${reset.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}.`
        : '   Reset time unknown.';
    const scheduleAt = reset && !Number.isNaN(reset.getTime())
        ? new Date(reset.getTime() + 60_000).toISOString()
        : null;
    const scheduleLine = scheduleAt
        ? `   Schedule for after reset: aigon schedule "feature-start ${featureId} ${agentId}" --at "${scheduleAt}"`
        : '   Schedule for after reset: unavailable until reset time is known.';
    return `❌ ${agentId}/${modelValue || 'default'} is out of quota.\n${resetLine}\n${scheduleLine}\n   Force start anyway: aigon feature-start ${featureId} ${agentId} --skip-quota-check`;
}

/**
 * F446 mid-run pane scan: classify output with classifyProbeResult, then merge a
 * depleted verdict into quota.json alongside the cron probe writer.
 * @returns {{ entry: object, changed: boolean }}
 */
function mergeMidRunDepletion(repoPath, agentId, modelValue, modelLabel, paneText, classified) {
    if (!agentRegistry.getAgent(agentId)) throw new Error(`Unknown agent: ${agentId}`);
    if (!classified || classified.verdict !== 'depleted') {
        return { entry: null, changed: false };
    }

    const state = readQuotaState(repoPath);
    if (!state.agents[agentId]) state.agents[agentId] = { models: {} };
    const modelKey = modelValue || '__default__';
    const prev = state.agents[agentId].models[modelKey];

    const probedAt = nowIso();
    const entry = {
        verdict: 'depleted',
        remainingUnit: null,
        remaining: 0,
        resetAt: classified.resetAt || null,
        lastProbedAt: probedAt,
        probeMethod: 'tmux-pane-pattern',
        probeOk: false,
        lastProbeOutput: truncateOutput(paneText),
        matchedPatternId: classified.matchedPatternId,
        confidence: classified.confidence || 'medium',
        modelLabel: modelLabel || modelValue || '(agent default)',
    };
    if (entry.verdict === 'depleted' && !entry.resetAt) {
        const cfg = quotaConfig(repoPath);
        entry.backoffSeconds = Math.min(
            Math.max(cfg.pollIntervalSeconds, Number(prev?.backoffSeconds || cfg.pollIntervalSeconds) * 2),
            cfg.maxBackoffSeconds,
        );
    }

    const prevLean = prev
        ? {
            verdict: prev.verdict,
            resetAt: prev.resetAt || null,
            matchedPatternId: prev.matchedPatternId || null,
            lastProbeOutput: prev.lastProbeOutput || null,
        }
        : null;
    const nextLean = {
        verdict: entry.verdict,
        resetAt: entry.resetAt || null,
        matchedPatternId: entry.matchedPatternId || null,
        lastProbeOutput: entry.lastProbeOutput || null,
    };
    const changed = JSON.stringify(prevLean) !== JSON.stringify(nextLean);

    state.agents[agentId].models[modelKey] = entry;
    state.agents[agentId].lastRefreshedAt = entry.lastProbedAt;
    state.agents[agentId].agentEnabled = agentEnabled(state.agents[agentId]);
    if (changed) writeQuotaState(state, repoPath);
    return { entry, changed };
}

module.exports = {
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEFAULT_MAX_BACKOFF_SECONDS,
    classifyProbeResult,
    toQuotaEntry,
    readQuotaState,
    writeQuotaState,
    probePair,
    listTargets,
    agentEnabled,
    isPairDepleted,
    shouldProbe,
    formatReset,
    formatStartGateMessage,
    statePath,
    mergeMidRunDepletion,
};
