'use strict';

const agentRegistry = require('./agent-registry');
const quotaProbe = require('./quota-probe');
const providerQuotaPoller = require('./provider-quota-poller');
const { getEffectiveConfig } = require('./config');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 5 * 60 * 1000;
let _timer = null;
let _startupTimer = null;
let _inflight = null;
let _lastCompletedAt = 0;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getPollIntervalMs(repoPath) {
    const quota = getEffectiveConfig(repoPath).quota || {};
    const seconds = Number(quota.pollIntervalSeconds) > 0 ? Number(quota.pollIntervalSeconds) : quotaProbe.DEFAULT_POLL_INTERVAL_SECONDS;
    return Math.max(MIN_INTERVAL_MS, Math.min(seconds * 1000, 60 * 60 * 1000));
}

function shouldRunPoll() {
    if (!_lastCompletedAt) return true;
    return Date.now() - _lastCompletedAt >= MIN_REFRESH_GAP_MS;
}

async function pollOnce({ repoPath = process.cwd(), log, onRefresh, includeDisabled = false, allModels = false, force = false } = {}) {
    if (!shouldRunPoll()) {
        (log || (() => {}))(`[quota-poller] skipped — last poll ${Math.round((Date.now() - _lastCompletedAt) / 1000)}s ago (min gap ${MIN_REFRESH_GAP_MS / 1000}s)`);
        return [];
    }

    const logger = log || (() => {});
    const events = [];
    const agentAvailability = require('./agent-availability');
    for (const agent of agentRegistry.getAllAgents()) {
        if (!includeDisabled) {
            const avail = agentAvailability.getAgentAvailability(agent.id, repoPath);
            if (avail.state === 'disabled' || avail.state === 'retired') continue;
        }
        let targets = [];
        try {
            targets = quotaProbe.listTargets(agent.id, { allModels });
        } catch (e) {
            logger(`[quota-poller] ${agent.id}: ${e.message}`);
            continue;
        }
        for (const target of targets) {
            const modelValue = target.value || null;
            const modelLabel = target.label || target.value || '(agent default)';
            try {
                const result = await quotaProbe.probePairAsync({
                    repoPath,
                    agentId: agent.id,
                    modelValue,
                    modelLabel,
                    force,
                });
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
                logger(`[quota-poller] ${agent.id}/${modelValue || 'default'}: ${e.message}`);
            }
            await sleep(1000);
        }
    }
    const providerEvents = await providerQuotaPoller.pollAllProviders({
        repoPath,
        force: false,
        log: logger,
        onRefresh,
    });
    events.push(...providerEvents);
    _lastCompletedAt = Date.now();
    return events;
}

function startQuotaPoller({ repoPath = process.cwd(), intervalMs, log, onRefresh } = {}) {
    const interval = intervalMs || getPollIntervalMs(repoPath) || DEFAULT_INTERVAL_MS;
    const logger = log || (() => {});

    async function tick(options = {}) {
        if (_inflight) return _inflight;
        _inflight = pollOnce({ repoPath, log: logger, onRefresh, allModels: false, ...options })
            .catch(e => { logger(`[quota-poller] tick error: ${e && e.message}`); return null; })
            .finally(() => { _inflight = null; });
        return _inflight;
    }

    if (_startupTimer) clearTimeout(_startupTimer);
    _startupTimer = setTimeout(() => tick(), STARTUP_DELAY_MS);
    if (typeof _startupTimer.unref === 'function') _startupTimer.unref();

    _timer = setInterval(() => tick(), interval);
    if (typeof _timer.unref === 'function') _timer.unref();

    return {
        stop() {
            if (_timer) { clearInterval(_timer); _timer = null; }
            if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null; }
        },
        refresh: () => tick({ force: true, allModels: true }),
    };
}

function triggerRefresh({ repoPath = process.cwd(), log, onRefresh } = {}) {
    if (_inflight) return _inflight;
    _inflight = pollOnce({
        repoPath,
        log: log || (() => {}),
        onRefresh,
        allModels: true,
        force: true,
    })
        .catch(() => null)
        .finally(() => { _inflight = null; });
    return _inflight;
}

module.exports = {
    startQuotaPoller,
    triggerRefresh,
    pollOnce,
    MIN_REFRESH_GAP_MS,
    STARTUP_DELAY_MS,
};
