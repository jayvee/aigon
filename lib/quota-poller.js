'use strict';

const agentRegistry = require('./agent-registry');
const quotaProbe = require('./quota-probe');
const { getEffectiveConfig } = require('./config');

const DEFAULT_INTERVAL_MS = 60 * 1000;
let _timer = null;
let _inflight = null;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getPollIntervalMs(repoPath) {
    const quota = getEffectiveConfig(repoPath).quota || {};
    const seconds = Number(quota.pollIntervalSeconds) > 0 ? Number(quota.pollIntervalSeconds) : quotaProbe.DEFAULT_POLL_INTERVAL_SECONDS;
    return Math.max(30_000, Math.min(seconds * 1000, 10 * 60 * 1000));
}

async function pollOnce({ repoPath = process.cwd(), log, onRefresh } = {}) {
    const logger = log || (() => {});
    const events = [];
    for (const agent of agentRegistry.getAllAgents()) {
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
                const result = quotaProbe.probePair({ repoPath, agentId: agent.id, modelValue, modelLabel, force: false });
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
