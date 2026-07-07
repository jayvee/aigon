'use strict';

const agentRegistry = require('./agent-registry');
const quotaProbe = require('./quota-probe');
const providerQuotaPoller = require('./provider-quota-poller');
const { getEffectiveConfig } = require('./config');

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
let _timer = null;
let _inflight = null;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getPollIntervalMs(repoPath) {
    const quota = getEffectiveConfig(repoPath).quota || {};
    const seconds = Number(quota.pollIntervalSeconds) > 0 ? Number(quota.pollIntervalSeconds) : quotaProbe.DEFAULT_POLL_INTERVAL_SECONDS;
    return Math.max(30_000, Math.min(seconds * 1000, 60 * 60 * 1000));
}

async function pollOnce({ repoPath = process.cwd(), log, onRefresh, includeDisabled = false } = {}) {
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
            targets = quotaProbe.listTargets(agent.id, { allModels: true });
        } catch (e) {
            logger(`[quota-poller] ${agent.id}: ${e.message}`);
            continue;
        }
        for (const target of targets) {
            const modelValue = target.value || null;
            const modelLabel = target.label || target.value || '(agent default)';
            try {
                const result = await quotaProbe.probePairAsync({ repoPath, agentId: agent.id, modelValue, modelLabel, force: false });
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
    return events;
}

function startQuotaPoller({ repoPath = process.cwd(), intervalMs, log, onRefresh } = {}) {
    const interval = intervalMs || getPollIntervalMs(repoPath) || DEFAULT_INTERVAL_MS;
    const logger = log || (() => {});

    async function tick() {
        if (_inflight) return _inflight;
        _inflight = pollOnce({ repoPath, log: logger, onRefresh })
            .catch(e => { logger(`[quota-poller] tick error: ${e && e.message}`); return null; })
            .finally(() => { _inflight = null; });
        return _inflight;
    }

    tick();
    _timer = setInterval(tick, interval);
    if (typeof _timer.unref === 'function') _timer.unref();

    return {
        stop() {
            if (_timer) { clearInterval(_timer); _timer = null; }
        },
        refresh: tick,
    };
}

function triggerRefresh({ repoPath = process.cwd(), log, onRefresh } = {}) {
    if (_inflight) return _inflight;
    _inflight = pollOnce({ repoPath, log: log || (() => {}), onRefresh })
        .catch(() => null)
        .finally(() => { _inflight = null; });
    return _inflight;
}

module.exports = {
    startQuotaPoller,
    triggerRefresh,
    pollOnce,
};
