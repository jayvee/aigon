'use strict';

const fs = require('fs');
const path = require('path');
const { filterQuotaStateByAvailability, isAgentQuotaPanelVisible } = require('./agent-availability');

const SCHEMA_VERSION = 1;
const LEGACY_BUDGET_AGENTS = ['cc', 'cx', 'gg', 'km', 'ag'];

function getStatePath(repoPath = process.cwd()) {
    return path.join(repoPath, '.aigon', 'state', 'agent-quota.json');
}

function getLockPath(repoPath = process.cwd()) {
    return `${getStatePath(repoPath)}.lock`;
}

function getLegacyBudgetPath(repoPath = process.cwd()) {
    return path.join(repoPath, '.aigon', 'budget-cache.json');
}

function getLegacyQuotaPath(repoPath = process.cwd()) {
    return path.join(repoPath, '.aigon', 'state', 'quota.json');
}

function emptyState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        lastPollAt: null,
        lastPollPhases: { budget: null, probe: null, provider: null },
        agents: {},
        providers: {},
    };
}

function normalizeState(parsed) {
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const agents = parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {};
    const providers = parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {};
    const lastPollPhases = parsed.lastPollPhases && typeof parsed.lastPollPhases === 'object'
        ? { budget: parsed.lastPollPhases.budget || null, probe: parsed.lastPollPhases.probe || null, provider: parsed.lastPollPhases.provider || null }
        : { budget: null, probe: null, provider: null };
    return {
        schemaVersion: SCHEMA_VERSION,
        lastPollAt: parsed.lastPollAt || null,
        lastPollPhases,
        agents,
        providers,
    };
}

function readLegacyBudget(repoPath) {
    const file = getLegacyBudgetPath(repoPath);
    if (!fs.existsSync(file)) return {};
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch (_) {
        return {};
    }
}

function readLegacyQuota(repoPath) {
    const file = getLegacyQuotaPath(repoPath);
    if (!fs.existsSync(file)) return { agents: {}, providers: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return { agents: {}, providers: {} };
        return {
            agents: parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {},
            providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
        };
    } catch (_) {
        return { agents: {}, providers: {} };
    }
}

function buildFromLegacy(repoPath) {
    const state = emptyState();
    const budget = readLegacyBudget(repoPath);
    const quota = readLegacyQuota(repoPath);

    for (const agentId of LEGACY_BUDGET_AGENTS) {
        if (budget[agentId]) {
            if (!state.agents[agentId]) state.agents[agentId] = {};
            state.agents[agentId].budget = budget[agentId];
        }
    }

    for (const [agentId, agentState] of Object.entries(quota.agents)) {
        if (!state.agents[agentId]) state.agents[agentId] = {};
        state.agents[agentId].models = agentState.models || {};
        if (agentState.agentEnabled != null) state.agents[agentId].agentEnabled = agentState.agentEnabled;
        if (agentState.lastRefreshedAt) state.agents[agentId].lastRefreshedAt = agentState.lastRefreshedAt;
    }

    state.providers = { ...quota.providers };

    const pollTimes = [];
    for (const agentId of LEGACY_BUDGET_AGENTS) {
        const polledAt = budget[agentId] && budget[agentId].polled_at;
        if (polledAt) pollTimes.push(polledAt);
    }
    for (const agentState of Object.values(quota.agents)) {
        if (agentState.lastRefreshedAt) pollTimes.push(agentState.lastRefreshedAt);
    }
    for (const providerState of Object.values(state.providers)) {
        if (providerState && providerState.lastPolledAt) pollTimes.push(providerState.lastPolledAt);
    }
    if (pollTimes.length) {
        state.lastPollAt = pollTimes.sort().pop();
    }

    return state;
}

function readAgentQuotaState(repoPath = process.cwd()) {
    const file = getStatePath(repoPath);
    if (fs.existsSync(file)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            return normalizeState(parsed);
        } catch (_) {
            return buildFromLegacy(repoPath);
        }
    }
    return buildFromLegacy(repoPath);
}

function atomicWriteJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, filePath);
}

function writeAgentQuotaState(state, repoPath = process.cwd()) {
    atomicWriteJSON(getStatePath(repoPath), normalizeState(state));
}

function ensureAgent(state, agentId) {
    if (!state.agents[agentId]) state.agents[agentId] = {};
    return state.agents[agentId];
}

function getAgentBudgetSlice(agentId, repoPath = process.cwd()) {
    const state = readAgentQuotaState(repoPath);
    const agent = state.agents[agentId];
    return agent && agent.budget ? agent.budget : null;
}

function getAgentProbeSlice(agentId, repoPath = process.cwd()) {
    const state = readAgentQuotaState(repoPath);
    const agent = state.agents[agentId];
    return agent && agent.models ? { models: agent.models, agentEnabled: agent.agentEnabled, lastRefreshedAt: agent.lastRefreshedAt } : null;
}

function getProviderSlice(providerId, repoPath = process.cwd()) {
    const state = readAgentQuotaState(repoPath);
    return state.providers && state.providers[providerId] ? state.providers[providerId] : null;
}

function isPairStartable(agentId, modelValue, repoPath = process.cwd()) {
    const state = readAgentQuotaState(repoPath);
    const modelKey = modelValue || '__default__';
    const entry = state.agents[agentId] && state.agents[agentId].models
        ? state.agents[agentId].models[modelKey]
        : null;
    if (!entry) return true;
    return entry.verdict !== 'depleted';
}

function projectBudgetApi(state, repoPath = process.cwd()) {
    const out = { cc: null, cx: null, gg: null, km: null, ag: null };
    for (const agentId of LEGACY_BUDGET_AGENTS) {
        if (!isAgentQuotaPanelVisible(agentId, repoPath)) continue;
        const budget = state.agents[agentId] && state.agents[agentId].budget;
        out[agentId] = budget || null;
    }
    return out;
}

function projectQuotaApi(state, repoPath = process.cwd()) {
    const agents = {};
    for (const [agentId, agentState] of Object.entries(state.agents || {})) {
        if (!isAgentQuotaPanelVisible(agentId, repoPath)) continue;
        agents[agentId] = {
            models: agentState.models || {},
            agentEnabled: agentState.agentEnabled,
            lastRefreshedAt: agentState.lastRefreshedAt,
        };
    }
    return {
        schemaVersion: 2,
        agents,
        providers: state.providers || {},
    };
}

function readFilteredAgentQuotaState(repoPath = process.cwd()) {
    const state = readAgentQuotaState(repoPath);
    const filteredAgents = {};
    for (const [agentId, agentState] of Object.entries(state.agents || {})) {
        if (!isAgentQuotaPanelVisible(agentId, repoPath)) continue;
        filteredAgents[agentId] = agentState;
    }
    return { ...state, agents: filteredAgents };
}

function mergeLegacyFiles(repoPath = process.cwd()) {
    const unifiedPath = getStatePath(repoPath);
    if (fs.existsSync(unifiedPath)) {
        const unifiedMtime = fs.statSync(unifiedPath).mtimeMs;
        const legacyPaths = [getLegacyBudgetPath(repoPath), getLegacyQuotaPath(repoPath)].filter(fs.existsSync);
        if (legacyPaths.length === 0) return false;
        const maxLegacy = Math.max(...legacyPaths.map(p => fs.statSync(p).mtimeMs));
        if (unifiedMtime >= maxLegacy) return false;
    }

    const hasLegacy = fs.existsSync(getLegacyBudgetPath(repoPath)) || fs.existsSync(getLegacyQuotaPath(repoPath));
    if (!hasLegacy && fs.existsSync(unifiedPath)) return false;

    const merged = buildFromLegacy(repoPath);
    writeAgentQuotaState(merged, repoPath);
    return true;
}

function updateProbeEntry(repoPath, agentId, modelKey, entry, agentEnabledFn) {
    const state = readAgentQuotaState(repoPath);
    const agent = ensureAgent(state, agentId);
    if (!agent.models) agent.models = {};
    agent.models[modelKey] = entry;
    agent.lastRefreshedAt = entry.lastProbedAt;
    if (typeof agentEnabledFn === 'function') {
        agent.agentEnabled = agentEnabledFn(agent);
    }
    writeAgentQuotaState(state, repoPath);
    return state;
}

function updateProviderEntry(repoPath, providerId, entry) {
    const state = readAgentQuotaState(repoPath);
    if (!state.providers) state.providers = {};
    state.providers[providerId] = entry;
    writeAgentQuotaState(state, repoPath);
    return state;
}

function updateBudgetSlices(repoPath, budgetByAgent) {
    const state = readAgentQuotaState(repoPath);
    for (const [agentId, budget] of Object.entries(budgetByAgent || {})) {
        const agent = ensureAgent(state, agentId);
        agent.budget = budget;
    }
    writeAgentQuotaState(state, repoPath);
    return state;
}

function patchAgentQuotaState(repoPath, patchFn) {
    const state = readAgentQuotaState(repoPath);
    const next = patchFn(state) || state;
    writeAgentQuotaState(next, repoPath);
    return next;
}

module.exports = {
    SCHEMA_VERSION,
    getStatePath,
    getLockPath,
    getLegacyBudgetPath,
    getLegacyQuotaPath,
    emptyState,
    normalizeState,
    readAgentQuotaState,
    writeAgentQuotaState,
    readFilteredAgentQuotaState,
    getAgentBudgetSlice,
    getAgentProbeSlice,
    getProviderSlice,
    isPairStartable,
    projectBudgetApi,
    projectQuotaApi,
    mergeLegacyFiles,
    updateProbeEntry,
    updateProviderEntry,
    updateBudgetSlices,
    patchAgentQuotaState,
    buildFromLegacy,
    filterQuotaStateByAvailability,
};
