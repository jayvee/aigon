'use strict';

// Agent-aware config composition — sits above config-core and agent-registry.
// config.js imports this module instead of agent-registry directly to break the
// static require cycle between the facade and the registry.

const configCore = require('./config-core');
const agentRegistry = require('./agent-registry');

let _defaultGlobalConfigCache = null;

function buildDefaultGlobalConfig() {
    if (!_defaultGlobalConfigCache) {
        _defaultGlobalConfigCache = {
            ...configCore.buildDefaultGlobalConfigBase(),
            agents: agentRegistry.buildDefaultAgentConfigs(),
        };
    }
    return _defaultGlobalConfigCache;
}

function normalizeConfiguredAgentId(rawAgentId, { launchableOnly = false } = {}) {
    const normalized = String(rawAgentId || '').trim().toLowerCase();
    if (!normalized) return null;
    if (!agentRegistry.getAllAgentIds().includes(normalized)) return null;
    if (launchableOnly && !agentRegistry.isAgentLaunchable(normalized)) return null;
    return normalized;
}

function getDefaultAgent(repoPath = process.cwd()) {
    const projectConfig = configCore.loadProjectConfig(repoPath);
    const projectAgent = normalizeConfiguredAgentId(projectConfig.defaultAgent, { launchableOnly: true });
    if (projectAgent) return projectAgent;

    const globalConfig = configCore.loadGlobalConfig({
        mergeDefaults: { agents: agentRegistry.buildDefaultAgentConfigs() },
    });
    const globalAgent = normalizeConfiguredAgentId(globalConfig.defaultAgent, { launchableOnly: true });
    if (globalAgent) return globalAgent;

    const builtInAgent = normalizeConfiguredAgentId(buildDefaultGlobalConfig().defaultAgent, { launchableOnly: true });
    if (builtInAgent) return builtInAgent;

    const registeredAgents = agentRegistry.getLaunchableAgentIds();
    return registeredAgents[0] || 'cc';
}

function isSameProviderFamily(agentA, agentB) {
    const families = agentRegistry.getProviderFamilies();
    const familyA = families[agentA];
    const familyB = families[agentB];
    if (!familyA || !familyB) return false;
    if (familyA === 'varies' || familyB === 'varies') return false;
    return familyA === familyB;
}

module.exports = {
    buildDefaultGlobalConfig,
    normalizeConfiguredAgentId,
    getDefaultAgent,
    isSameProviderFamily,
    getProviderFamilies: () => agentRegistry.getProviderFamilies(),
    getProcessDetectionMap: () => agentRegistry.getProcessDetectionMap(),
    isKnownModelValue: (...args) => agentRegistry.isKnownModelValue(...args),
    getAgent: (agentId) => agentRegistry.getAgent(agentId),
};
