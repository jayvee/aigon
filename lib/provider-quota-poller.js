'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const providerRegistry = require('./provider-registry');
const quotaProbe = require('./quota-probe');
const { getEffectiveConfig } = require('./config');

const DEFAULT_TIMEOUT_MS = 12_000;
let _httpGetOverride = null;

function nowIso() {
    return new Date().toISOString();
}

function expandHome(filePath) {
    const raw = String(filePath || '');
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return raw;
}

function providerConfig(repoPath, providerId) {
    const cfg = getEffectiveConfig(repoPath).quota || {};
    const providerCfg = (cfg.providers && cfg.providers[providerId]) || {};
    const template = providerRegistry.getProvider(providerId) || {};
    return {
        pollIntervalSeconds: Number(providerCfg.pollIntervalSeconds) > 0
            ? Number(providerCfg.pollIntervalSeconds)
            : (Number(template.pollIntervalSeconds) > 0 ? Number(template.pollIntervalSeconds) : quotaProbe.DEFAULT_POLL_INTERVAL_SECONDS),
        lowThresholdUsd: Number(providerCfg.lowThresholdUsd) > 0
            ? Number(providerCfg.lowThresholdUsd)
            : (Number(template.defaultLowThresholdUsd) > 0 ? Number(template.defaultLowThresholdUsd) : 5),
    };
}

function resolveOpenRouterKey(providerTemplate) {
    const steps = Array.isArray(providerTemplate.keyResolution) ? providerTemplate.keyResolution : [];
    for (const step of steps) {
        if (step.type === 'env' && step.name && process.env[step.name]) {
            const value = String(process.env[step.name]).trim();
            if (value) return value;
        }
        if (step.type === 'opencode-auth') {
            const authPath = expandHome(step.path || '~/.local/share/opencode/auth.json');
            if (!fs.existsSync(authPath)) continue;
            try {
                const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'));
                const field = step.field || 'openrouter.key';
                const parts = field.split('.');
                let cursor = parsed;
                for (const part of parts) {
                    cursor = cursor && typeof cursor === 'object' ? cursor[part] : null;
                }
                const value = cursor != null ? String(cursor).trim() : '';
                if (value) return value;
            } catch (_) { /* ignore malformed auth file */ }
        }
    }
    return null;
}

function resolveApiKey(providerId) {
    const template = providerRegistry.getProvider(providerId);
    if (!template) return null;
    if (providerId === 'openrouter') return resolveOpenRouterKey(template);
    return null;
}

function httpGet(url, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (_httpGetOverride) return _httpGetOverride(url, apiKey, timeoutMs);
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                resolve({ statusCode: res.statusCode || 0, body });
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
        req.on('error', reject);
        req.end();
    });
}

function parseJsonBody(body) {
    try {
        return JSON.parse(body);
    } catch (_) {
        return null;
    }
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function computeVerdict(balanceUsd, lowThresholdUsd) {
    if (balanceUsd == null || !Number.isFinite(balanceUsd)) return 'unknown';
    if (balanceUsd <= 0) return 'depleted';
    if (balanceUsd < lowThresholdUsd) return 'low';
    return 'available';
}

function buildProviderEntry({
    providerTemplate,
    keyData,
    creditsData,
    creditsStatus,
    polledAt,
    lowThresholdUsd,
    lastError,
}) {
    const displayName = providerTemplate.displayName || providerTemplate.id;
    const usageDailyUsd = toNumber(keyData && keyData.usage_daily);
    const usageWeeklyUsd = toNumber(keyData && keyData.usage_weekly);
    const usageMonthlyUsd = toNumber(keyData && keyData.usage_monthly);
    const keyLimitUsd = toNumber(keyData && keyData.limit);
    const keyLimitRemainingUsd = toNumber(keyData && keyData.limit_remaining);
    const keyLimitReset = keyData && keyData.limit_reset != null ? String(keyData.limit_reset) : null;

    let walletUsd = null;
    if (creditsData) {
        const totalCredits = toNumber(creditsData.total_credits);
        const totalUsage = toNumber(creditsData.total_usage);
        if (totalCredits != null && totalUsage != null) walletUsd = totalCredits - totalUsage;
        else if (totalCredits != null) walletUsd = totalCredits;
    } else if (creditsStatus === 401 || creditsStatus === 403) {
        walletUsd = null;
    }

    let balanceUsd = null;
    if (walletUsd != null) balanceUsd = walletUsd;
    else if (keyLimitRemainingUsd != null) balanceUsd = keyLimitRemainingUsd;

    const verdict = lastError && balanceUsd == null
        ? 'error'
        : computeVerdict(balanceUsd, lowThresholdUsd);

    return {
        displayName,
        verdict,
        balanceUsd,
        walletUsd,
        keyLimitUsd,
        keyLimitRemainingUsd,
        keyLimitReset,
        usageDailyUsd,
        usageWeeklyUsd,
        usageMonthlyUsd,
        remainingUnit: balanceUsd != null ? 'usd' : null,
        remaining: balanceUsd,
        lastPolledAt: polledAt,
        probeMethod: 'openrouter-api',
        lastError: lastError || null,
    };
}

async function pollOpenRouter({ repoPath = process.cwd(), force = true } = {}) {
    const providerId = 'openrouter';
    const providerTemplate = providerRegistry.getProvider(providerId);
    if (!providerTemplate) throw new Error(`Unknown provider: ${providerId}`);

    const cfg = providerConfig(repoPath, providerId);
    const state = quotaProbe.readQuotaState(repoPath);
    const prev = state.providers && state.providers[providerId];
    if (!force && prev && !quotaProbe.shouldProbeProvider(prev, cfg.pollIntervalSeconds)) {
        return { entry: prev, changed: false, skipped: true };
    }

    const apiKey = resolveApiKey(providerId);
    const polledAt = nowIso();
    if (!apiKey) {
        const entry = buildProviderEntry({
            providerTemplate,
            keyData: null,
            creditsData: null,
            creditsStatus: null,
            polledAt,
            lowThresholdUsd: cfg.lowThresholdUsd,
            lastError: 'no API key found',
        });
        entry.verdict = 'unknown';
        return quotaProbe.mergeProviderEntry(repoPath, providerId, entry, prev);
    }

    let keyData = null;
    let creditsData = null;
    let creditsStatus = null;
    let lastError = null;

    try {
        const keyRes = await httpGet(providerTemplate.endpoints.key, apiKey);
        if (keyRes.statusCode >= 200 && keyRes.statusCode < 300) {
            const parsed = parseJsonBody(keyRes.body);
            keyData = parsed && parsed.data ? parsed.data : null;
        } else {
            lastError = `key endpoint HTTP ${keyRes.statusCode}`;
        }
    } catch (e) {
        lastError = e && e.message ? e.message : 'key endpoint failed';
    }

    try {
        const creditsRes = await httpGet(providerTemplate.endpoints.credits, apiKey);
        creditsStatus = creditsRes.statusCode;
        if (creditsRes.statusCode >= 200 && creditsRes.statusCode < 300) {
            const parsed = parseJsonBody(creditsRes.body);
            creditsData = parsed && parsed.data ? parsed.data : null;
        }
    } catch (_) { /* credits poll is best-effort */ }

    const entry = buildProviderEntry({
        providerTemplate,
        keyData,
        creditsData,
        creditsStatus,
        polledAt,
        lowThresholdUsd: cfg.lowThresholdUsd,
        lastError,
    });
    return quotaProbe.mergeProviderEntry(repoPath, providerId, entry, prev);
}

async function pollProvider(providerId, opts = {}) {
    if (providerId === 'openrouter') return pollOpenRouter(opts);
    throw new Error(`Unknown provider: ${providerId}`);
}

async function pollAllProviders({ repoPath = process.cwd(), force = false, log, onRefresh } = {}) {
    const logger = log || (() => {});
    const events = [];
    const providerIds = providerRegistry.getAllProviderIds();
    for (const providerId of providerIds) {
        try {
            const result = await pollProvider(providerId, { repoPath, force });
            if (result.changed && typeof onRefresh === 'function') {
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
            logger(`[provider-quota-poller] ${providerId}: ${e && e.message}`);
        }
    }
    return events;
}

function formatProviderStartGateMessage({ providerId, entry, agentId, featureId }) {
    const providerTemplate = providerRegistry.getProvider(providerId) || {};
    const name = entry.displayName || providerTemplate.displayName || providerId;
    const balance = entry.balanceUsd != null ? `$${entry.balanceUsd.toFixed(2)}` : 'unknown';
    const topUp = providerTemplate.topUpUrl || 'https://openrouter.ai/settings/credits';
    return `❌ ${name} balance depleted (${balance} remaining) — ${agentId} routes through this provider.\n   Top up: ${topUp}\n   Force start anyway: aigon feature-start ${featureId} ${agentId} --skip-quota-check`;
}

function auditDoctor(repoPath = process.cwd()) {
    const agentRegistry = require('./agent-registry');
    const issues = [];
    const warnings = [];

    const linked = new Set();
    for (const agent of agentRegistry.getLaunchableAgents()) {
        const ids = Array.isArray(agent.quotaProviders) ? agent.quotaProviders : [];
        ids.forEach(id => linked.add(id));
    }

    for (const providerId of linked) {
        const template = providerRegistry.getProvider(providerId);
        if (!template) {
            warnings.push(`linked provider '${providerId}' has no template`);
            continue;
        }
        const key = resolveApiKey(providerId);
        const entry = quotaProbe.getProviderEntry(repoPath, providerId);
        const cfg = providerConfig(repoPath, providerId);

        if (!key) {
            issues.push(`missing ${template.displayName || providerId} API key (required for linked agents)`);
            continue;
        }
        if (entry && entry.lastPolledAt) {
            const ageMs = Date.now() - new Date(entry.lastPolledAt).getTime();
            if (Number.isFinite(ageMs) && ageMs > cfg.pollIntervalSeconds * 2000) {
                warnings.push(`${template.displayName || providerId} poll stale (${Math.round(ageMs / 60000)}m old)`);
            }
        } else {
            warnings.push(`${template.displayName || providerId} has never been polled`);
        }
        if (entry && entry.verdict === 'depleted') {
            warnings.push(`${template.displayName || providerId} balance depleted`);
        } else if (entry && entry.verdict === 'low') {
            warnings.push(`${template.displayName || providerId} balance low`);
        }
    }

    return { issues, warnings };
}

module.exports = {
    resolveApiKey,
    pollOpenRouter,
    pollProvider,
    pollAllProviders,
    formatProviderStartGateMessage,
    auditDoctor,
    providerConfig,
    _setHttpGetForTests: (fn) => { _httpGetOverride = fn; },
};
