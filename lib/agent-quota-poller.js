'use strict';

/**
 * Unified agent-quota poller (F616).
 * Single timer orchestrating budget scrape → headless probe → provider HTTP.
 */

const fs = require('fs');
const agentRegistry = require('./agent-registry');
const agentQuotaRead = require('./agent-quota-read');
const budgetPoller = require('./budget-poller');
const quotaProbe = require('./quota-probe');
const providerQuotaPoller = require('./provider-quota-poller');
const { getEffectiveConfig } = require('./config');
const { tryWithFeatureLock } = require('./workflow-core/lock');

const MIN_REFRESH_GAP_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 10_000;
function probePaceMs() {
    return process.env.AIGON_QUOTA_TEST === '1' ? 0 : 1000;
}

function shouldSkipQuotaProbe(agent) {
    if (!agent) return true;
    if (agent.skipQuotaProbe === true) return true;
    if (agent.authCheck && agent.authCheck.skipQuotaProbe === true) return true;
    return false;
}

function refreshProbesAllModels(repoPath) {
    const quota = getEffectiveConfig(repoPath).quota || {};
    return quota.probeAllModelsOnRefresh === true;
}

let _timer = null;
let _pollInFlight = false;
let _lastCompletedAt = 0;
let _lastRefreshRejectedAt = 0;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getPollIntervalMs(repoPath) {
    const quota = getEffectiveConfig(repoPath).quota || {};
    const seconds = Number(quota.pollIntervalSeconds) > 0
        ? Number(quota.pollIntervalSeconds)
        : quotaProbe.DEFAULT_POLL_INTERVAL_SECONDS;
    return Math.max(MIN_INTERVAL_MS, Math.min(seconds * 1000, 60 * 60 * 1000));
}

function cacheIsFresh(state, pollIntervalMs) {
    if (!state.lastPollAt) return false;
    const last = new Date(state.lastPollAt).getTime();
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < pollIntervalMs;
}

function shouldRunRefresh({ force = false } = {}) {
    if (force) return true;
    if (!_lastCompletedAt) return true;
    return Date.now() - _lastCompletedAt >= MIN_REFRESH_GAP_MS;
}

function phaseOutcome(ok, skipped = false) {
    if (skipped) return 'skipped';
    return ok ? 'ok' : 'error';
}

async function phaseBudget({ repoPath, log, force }) {
    const logger = log || (() => {});
    const outcomes = { outcome: 'ok', budgetByAgent: {} };
    // ag (Antigravity) is deliberately excluded: scraping its budget launches
    // interactive `agy`, which opens a Google sign-in tab in the browser. It is
    // never polled automatically — only launched by an explicit feature assignment.
    const budgetAgents = ['cc', 'cx', 'km'];
    let anyOk = false;
    let anyError = false;

    for (const agentId of budgetAgents) {
        if (!budgetPoller.shouldPollBudgetAgent(agentId, repoPath)) continue;
        try {
            let result = null;
            if (agentId === 'cc') {
                result = await budgetPoller.pollClaudeBudget({ log: logger });
            } else if (agentId === 'cx') {
                result = await budgetPoller.pollCodexBudget({ log: logger });
            } else if (agentId === 'km') {
                result = await budgetPoller.pollKimiBudget({ log: logger });
            }
            if (result) {
                outcomes.budgetByAgent[agentId] = result;
                anyOk = true;
            }
        } catch (e) {
            anyError = true;
            outcomes.budgetByAgent[agentId] = {
                probeMethod: 'error',
                verdict: 'error',
                lastError: e && e.message ? e.message : 'budget scrape failed',
                erroredAt: new Date().toISOString(),
            };
            logger(`[agent-quota-poller] budget/${agentId}: ${e && e.message}`);
        }
    }

    if (anyError && !anyOk) outcomes.outcome = 'error';
    else if (!anyOk && !anyError) outcomes.outcome = 'skipped';
    return outcomes;
}

function probeSubprocessFailed(probeResult) {
    if (!probeResult || probeResult.skipped) return false;
    if (probeResult.exitCode != null && probeResult.exitCode !== 0) return true;
    if (probeResult.status != null && probeResult.status !== 0) return true;
    return false;
}

async function phaseProbe({ repoPath, log, onRefresh, allModels = false, force = false }) {
    const logger = log || (() => {});
    const events = [];
    let anyOk = false;
    let anyError = false;
    const agentAvailability = require('./agent-availability');

    for (const agent of agentRegistry.getAllAgents()) {
        // ag (Antigravity) is never probed automatically — a headless `agy` probe
        // opens a Google sign-in tab in the browser. Skip it entirely.
        if (agent.id === 'ag') continue;
        // op (OpenCode) loads full project context per `opencode run` (~30k+ tokens)
        // and OpenRouter may fan out to multiple paid providers per probe. Wallet
        // balance is polled via the free OpenRouter HTTP API instead (quotaProviders).
        if (shouldSkipQuotaProbe(agent)) continue;
        const avail = agentAvailability.getAgentAvailability(agent.id, repoPath);
        if (avail.state === 'disabled' || avail.state === 'retired') continue;

        let targets = [];
        try {
            targets = quotaProbe.listTargets(agent.id, { allModels });
        } catch (e) {
            anyError = true;
            logger(`[agent-quota-poller] probe/${agent.id}: ${e.message}`);
            continue;
        }

        for (const target of targets) {
            const modelValue = target.value || null;
            const modelLabel = target.label || target.value || '(agent default)';
            const modelKey = modelValue || '__default__';
            try {
                const result = await quotaProbe.probePairAsync({
                    repoPath,
                    agentId: agent.id,
                    modelValue,
                    modelLabel,
                    force,
                });
                if (probeSubprocessFailed(result.result)) {
                    anyError = true;
                    const exitCode = result.result.exitCode != null ? result.result.exitCode : result.result.status;
                    agentQuotaRead.patchAgentQuotaState(repoPath, (state) => {
                        const agentState = state.agents[agent.id] || {};
                        if (!agentState.models) agentState.models = {};
                        const prev = agentState.models[modelKey] || {};
                        agentState.models[modelKey] = {
                            ...prev,
                            verdict: 'error',
                            probeMethod: 'error',
                            lastError: result.result.error || `probe exited ${exitCode}`,
                            erroredAt: new Date().toISOString(),
                            lastProbedAt: new Date().toISOString(),
                        };
                        state.agents[agent.id] = agentState;
                        return state;
                    });
                } else {
                    anyOk = true;
                }
                if (result.changed && typeof onRefresh === 'function') {
                    const event = {
                        type: 'quota.refreshed',
                        agentId: agent.id,
                        modelValue,
                        verdict: result.entry.verdict,
                        resetAt: result.entry.resetAt || null,
                        probedAt: result.entry.lastProbedAt,
                    };
                    events.push(event);
                    onRefresh(event);
                }
            } catch (e) {
                anyError = true;
                agentQuotaRead.patchAgentQuotaState(repoPath, (state) => {
                    const agentState = state.agents[agent.id] || {};
                    if (!agentState.models) agentState.models = {};
                    const prev = agentState.models[modelKey] || {};
                    agentState.models[modelKey] = {
                        ...prev,
                        verdict: 'error',
                        probeMethod: 'error',
                        lastError: e && e.message ? e.message : 'probe failed',
                        erroredAt: new Date().toISOString(),
                        lastProbedAt: new Date().toISOString(),
                    };
                    state.agents[agent.id] = agentState;
                    return state;
                });
                logger(`[agent-quota-poller] probe/${agent.id}/${modelValue || 'default'}: ${e.message}`);
            }
            await sleep(probePaceMs());
        }
    }

    return { outcome: phaseOutcome(anyOk, !anyOk && !anyError), events };
}

async function phaseProvider({ repoPath, log, onRefresh, force = false }) {
    const logger = log || (() => {});
    let anyOk = false;
    let anyError = false;
    const events = [];
    const providerIds = require('./provider-registry').getAllProviderIds();

    for (const providerId of providerIds) {
        try {
            const result = await Promise.race([
                providerQuotaPoller.pollProvider(providerId, { repoPath, force }),
                sleep(PROVIDER_TIMEOUT_MS).then(() => { throw new Error('provider HTTP timeout'); }),
            ]);
            if (result && result.entry) anyOk = true;
            if (result && result.changed && typeof onRefresh === 'function') {
                const event = {
                    type: 'quota.refreshed',
                    scope: 'provider',
                    providerId,
                    verdict: result.entry.verdict,
                    balanceUsd: result.entry.balanceUsd,
                    polledAt: result.entry.lastPolledAt,
                };
                events.push(event);
                onRefresh(event);
            }
        } catch (e) {
            anyError = true;
            const polledAt = new Date().toISOString();
            agentQuotaRead.patchAgentQuotaState(repoPath, (state) => {
                if (!state.providers) state.providers = {};
                const prev = state.providers[providerId] || {};
                state.providers[providerId] = {
                    ...prev,
                    verdict: 'error',
                    probeMethod: 'error',
                    lastError: e && e.message ? e.message : 'provider poll failed',
                    erroredAt: polledAt,
                    lastPolledAt: polledAt,
                };
                return state;
            });
            logger(`[agent-quota-poller] provider/${providerId}: ${e && e.message}`);
        }
    }

    return { outcome: phaseOutcome(anyOk, !anyOk && !anyError), events };
}

async function runTick({ repoPath = process.cwd(), log, onRefresh, force = false, allModels = false, skipCacheGate = false } = {}) {
    const logger = log || (() => {});
    const pollIntervalMs = getPollIntervalMs(repoPath);
    const state = agentQuotaRead.readAgentQuotaState(repoPath);

    if (!force && !skipCacheGate && cacheIsFresh(state, pollIntervalMs)) {
        logger('[agent-quota-poller] cache fresh — skipping tick');
        return { skipped: true, state };
    }

    if (!shouldRunRefresh({ force })) {
        logger(`[agent-quota-poller] refresh gap — skipped (${MIN_REFRESH_GAP_MS / 1000}s)`);
        return { skipped: true, rateLimited: true, state };
    }

    const now = new Date().toISOString();
    const lastPollPhases = { ...(state.lastPollPhases || { budget: null, probe: null, provider: null }) };

    const budgetPhase = await phaseBudget({ repoPath, log: logger, force });
    if (Object.keys(budgetPhase.budgetByAgent).length) {
        agentQuotaRead.patchAgentQuotaState(repoPath, (s) => {
            for (const [agentId, slice] of Object.entries(budgetPhase.budgetByAgent)) {
                if (!s.agents[agentId]) s.agents[agentId] = {};
                if (slice.probeMethod === 'skipped-interactive-auth' || slice.probeMethod === 'error') {
                    if (!s.agents[agentId].budget) s.agents[agentId].budget = null;
                    s.agents[agentId].budgetMeta = slice;
                } else if (slice.polled_at) {
                    s.agents[agentId].budget = slice;
                    delete s.agents[agentId].budgetMeta;
                }
            }
            return s;
        });
    }
    lastPollPhases.budget = now;

    const probePhase = await phaseProbe({ repoPath, log: logger, onRefresh, allModels, force });
    lastPollPhases.probe = now;

    const providerPhase = await phaseProvider({ repoPath, log: logger, onRefresh, force });
    lastPollPhases.provider = now;

    agentQuotaRead.patchAgentQuotaState(repoPath, (s) => {
        s.lastPollAt = now;
        s.lastPollPhases = {
            budget: budgetPhase.outcome === 'ok' || budgetPhase.outcome === 'error' ? now : lastPollPhases.budget,
            probe: probePhase.outcome === 'ok' || probePhase.outcome === 'error' ? now : lastPollPhases.probe,
            provider: providerPhase.outcome === 'ok' || providerPhase.outcome === 'error' ? now : lastPollPhases.provider,
        };
        s.lastPollPhaseOutcomes = {
            budget: budgetPhase.outcome,
            probe: probePhase.outcome,
            provider: providerPhase.outcome,
        };
        return s;
    });

    _lastCompletedAt = Date.now();
    return {
        skipped: false,
        lastPollPhases: lastPollPhases,
        events: [...(probePhase.events || []), ...(providerPhase.events || [])],
    };
}

async function refreshWithLock({ repoPath = process.cwd(), log, onRefresh, force = false, allModels = false } = {}) {
    if (_pollInFlight) {
        const err = new Error('agent-quota refresh already in flight');
        err.code = 'REFRESH_IN_FLIGHT';
        throw err;
    }

    const lockPath = agentQuotaRead.getLockPath(repoPath);
    const lockResult = await tryWithFeatureLock(lockPath, async () => {
        _pollInFlight = true;
        try {
            return await runTick({ repoPath, log, onRefresh, force, allModels, skipCacheGate: force });
        } finally {
            _pollInFlight = false;
        }
    });

    if (lockResult.kind === 'busy') {
        const err = new Error('agent-quota lock held');
        err.code = 'REFRESH_IN_FLIGHT';
        throw err;
    }
    return lockResult.value;
}

function startAgentQuotaPoller({ repoPath = process.cwd(), intervalMs, log, onRefresh } = {}) {
    const interval = intervalMs || getPollIntervalMs(repoPath);
    const logger = log || (() => {});

    async function tick(options = {}) {
        if (_pollInFlight) return null;
        try {
            return await refreshWithLock({ repoPath, log: logger, onRefresh, ...options });
        } catch (e) {
            if (e && e.code === 'REFRESH_IN_FLIGHT') {
                logger('[agent-quota-poller] tick skipped — refresh in flight');
                return null;
            }
            logger(`[agent-quota-poller] tick error: ${e && e.message}`);
            return null;
        }
    }

    const pollOnStart = process.env.AIGON_QUOTA_POLL_ON_START === '1';
    if (pollOnStart) {
        tick().catch(() => {});
    } else {
        const state = agentQuotaRead.readAgentQuotaState(repoPath);
        if (!cacheIsFresh(state, interval)) {
            tick().catch(() => {});
        } else {
            logger('[agent-quota-poller] startup — serving cached agent-quota.json');
        }
    }

    _timer = setInterval(() => tick(), interval);
    if (typeof _timer.unref === 'function') _timer.unref();

    return {
        stop() {
            if (_timer) { clearInterval(_timer); _timer = null; }
        },
        refresh: (opts = {}) => refreshWithLock({
            repoPath,
            log: logger,
            onRefresh,
            force: true,
            allModels: refreshProbesAllModels(repoPath),
            ...opts,
        }),
        isInFlight: () => _pollInFlight,
    };
}

function triggerRefresh({ repoPath = process.cwd(), log, onRefresh, force = false } = {}) {
    if (!shouldRunRefresh({ force })) {
        const err = new Error('refresh rate limited');
        err.code = 'RATE_LIMITED';
        _lastRefreshRejectedAt = Date.now();
        throw err;
    }
    return refreshWithLock({
        repoPath,
        log: log || (() => {}),
        onRefresh,
        force: true,
        allModels: refreshProbesAllModels(repoPath),
    });
}

function _resetForTests() {
    _pollInFlight = false;
    _lastCompletedAt = 0;
    _lastRefreshRejectedAt = 0;
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
    startAgentQuotaPoller,
    triggerRefresh,
    runTick,
    refreshWithLock,
    getPollIntervalMs,
    cacheIsFresh,
    MIN_REFRESH_GAP_MS,
    _resetForTests,
    _isInFlight: () => _pollInFlight,
};
