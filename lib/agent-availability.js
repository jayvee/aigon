'use strict';

/**
 * Canonical agent availability resolver (F593).
 *
 * Resolution order in getAgentAvailability() (first match wins):
 * 1. Registry `retired` — absolute; no user/project config can re-enable for new work.
 * 2. User `disabled` — global `disabled` outranks project `active` (v1: project cannot
 *    override a global disable); also matches legacy `agents.<id>.disabled`.
 * 3. `unconfigured` — inferred from missing CLI binary (doctor / getAgentBinMap).
 * 4. Registry `deprecated` — outranks `active` for default/recommended selection;
 *    explicit launch allowed with warning unless `hardBlock` is set.
 * 5. `active`, with `quota_depleted` as a runtime annotation only — it never rewrites
 *    user preference and only blocks usability when `treatQuotaAsBlocked` is requested.
 *
 * Note: a user `disabled` preference is reported before registry `deprecated` so that an
 * operator who turned an agent off sees the actionable "re-enable" path rather than a
 * deprecation warning. Registry `retired` still outranks all user/project config.
 */

const path = require('path');

const agentRegistry = require('./agent-registry');
const { loadGlobalConfig, loadProjectConfig, saveGlobalConfig, saveProjectConfig } = require('./config-core');
const { isBinaryAvailable } = require('./binary-check');

/** @type {Map<string, Set<string>>} repoPath → agentIds currently resolving */
const availabilityInProgress = new Map();

const AVAILABILITY_STATES = Object.freeze([
    'active',
    'disabled',
    'unconfigured',
    'quota_depleted',
    'deprecated',
    'retired',
]);

const KNOWN_DISABLE_REASONS = Object.freeze([
    'subscription-paused',
    'not-installed',
    'prefer-other-agent',
    'cost-control',
    'manual',
]);

function normalizeAgentId(agentId) {
    const id = String(agentId || '').trim().toLowerCase();
    if (!id) return '';
    const aliasMap = agentRegistry.getAgentAliasMap();
    return aliasMap[id] || id;
}

function readRegistryPolicy(agent) {
    const raw = agent?.availability || {};
    const state = String(raw.state || 'active').trim().toLowerCase();
    if (state === 'retired' || raw.retired === true) {
        return { state: 'retired', deprecated: false, hardBlock: true, message: raw.message || null, reason: raw.reason || null };
    }
    if (state === 'deprecated' || raw.deprecated === true) {
        return {
            state: 'deprecated',
            deprecated: true,
            hardBlock: raw.hardBlock === true,
            defaultHidden: raw.defaultHidden === true,
            message: raw.message || null,
            reason: raw.reason || null,
            replacementAgentIds: Array.isArray(raw.replacementAgentIds) ? raw.replacementAgentIds : [],
        };
    }
    return {
        state: 'active',
        deprecated: false,
        hardBlock: false,
        defaultHidden: raw.defaultHidden === true,
        message: null,
        reason: null,
        replacementAgentIds: [],
    };
}

function readUserAvailability(agentId, repoPath) {
    const globalConfig = loadGlobalConfig();
    const projectConfig = loadProjectConfig(repoPath);
    const globalEntry = globalConfig.agents?.[agentId] || {};
    const projectEntry = projectConfig.agents?.[agentId] || {};

    const globalAvail = globalEntry.availability || {};
    const projectAvail = projectEntry.availability || {};

    const globalDisabled = globalEntry.disabled === true
        || String(globalAvail.state || '').toLowerCase() === 'disabled';
    const projectDisabled = projectEntry.disabled === true
        || String(projectAvail.state || '').toLowerCase() === 'disabled';

    const pick = (disabled, avail, scope) => {
        if (!disabled && String(avail.state || '').toLowerCase() !== 'disabled') return null;
        return {
            state: 'disabled',
            scope,
            reason: avail.reason || (disabled ? 'manual' : null),
            note: avail.note || null,
            hidden: avail.hidden !== false,
            updatedAt: avail.updatedAt || null,
        };
    };

    // Global disabled wins over project active (v1: no project override of global disable).
    const global = pick(globalDisabled, globalAvail, 'global');
    if (global) return global;
    return pick(projectDisabled, projectAvail, 'project');
}

function isAgentCliInstalled(agentId) {
    const binMap = agentRegistry.getAgentBinMap();
    const binary = binMap[agentId];
    if (!binary) return false;
    return isBinaryAvailable(binary);
}

function readQuotaAnnotation(agentId, repoPath, modelValue) {
    try {
        const quotaProbe = require('./quota-probe');
        const entry = quotaProbe.isPairDepleted(repoPath, agentId, modelValue);
        if (entry && entry.verdict === 'depleted') {
            return {
                state: 'quota_depleted',
                modelValue: modelValue ?? null,
                resetAt: entry.resetAt || null,
                probedAt: entry.lastProbedAt || null,
            };
        }
    } catch (_) { /* quota optional */ }
    return null;
}

/**
 * @returns {{
 *   agentId: string,
 *   state: string,
 *   usable: boolean,
 *   pickerVisible: boolean,
 *   recommended: boolean,
 *   scope?: string,
 *   reason?: string|null,
 *   note?: string|null,
 *   message?: string|null,
 *   quota?: object|null,
 *   registryPolicy?: object,
 *   userPreference?: object|null,
 * }}
 */
function getAgentAvailability(agentId, repoPath = process.cwd(), options = {}) {
    const id = normalizeAgentId(agentId);
    const agent = agentRegistry.getAgent(id);
    if (!agent) {
        return {
            agentId: id,
            state: 'unknown',
            usable: false,
            pickerVisible: false,
            recommended: false,
            reason: 'unknown-agent',
        };
    }

    if (!agentRegistry.isAgentLaunchable(id)) {
        return {
            agentId: id,
            state: 'retired',
            usable: false,
            pickerVisible: false,
            recommended: false,
            message: agentRegistry.formatDeactivatedAgentMessage(id),
            registryPolicy: { state: 'retired', deprecated: false, hardBlock: true },
            userPreference: null,
            quota: null,
        };
    }

    const repoKey = path.resolve(repoPath);
    let inProgress = availabilityInProgress.get(repoKey);
    if (!inProgress) {
        inProgress = new Set();
        availabilityInProgress.set(repoKey, inProgress);
    }
    if (inProgress.has(id)) {
        return {
            agentId: id,
            state: 'active',
            usable: true,
            pickerVisible: true,
            recommended: true,
            registryPolicy: { state: 'active', deprecated: false, hardBlock: false },
            userPreference: null,
            quota: null,
            availabilityReentrant: true,
        };
    }
    inProgress.add(id);

    try {
        const registryPolicy = readRegistryPolicy(agent);
        const userPreference = readUserAvailability(id, repoPath);
        const modelValue = options.modelValue;
        const quota = readQuotaAnnotation(id, repoPath, modelValue);

        if (registryPolicy.state === 'retired') {
            return {
                agentId: id,
                state: 'retired',
                usable: false,
                pickerVisible: false,
                recommended: false,
                message: registryPolicy.message,
                registryPolicy,
                userPreference,
                quota,
            };
        }

        if (userPreference) {
            return {
                agentId: id,
                state: 'disabled',
                usable: false,
                pickerVisible: false,
                recommended: false,
                scope: userPreference.scope,
                reason: userPreference.reason,
                note: userPreference.note,
                hidden: userPreference.hidden,
                registryPolicy,
                userPreference,
                quota,
            };
        }

        if (!isAgentCliInstalled(id)) {
            return {
                agentId: id,
                state: 'unconfigured',
                usable: false,
                pickerVisible: false,
                recommended: false,
                reason: 'not-installed',
                registryPolicy,
                userPreference: null,
                quota,
            };
        }

        if (registryPolicy.state === 'deprecated') {
            const explicit = options.explicit === true;
            const blocked = registryPolicy.hardBlock && !options.allowDeprecated;
            return {
                agentId: id,
                state: 'deprecated',
                usable: explicit && !blocked,
                pickerVisible: !registryPolicy.defaultHidden,
                recommended: false,
                message: registryPolicy.message,
                warning: explicit && !blocked,
                registryPolicy,
                userPreference: null,
                quota,
            };
        }

        const base = {
            agentId: id,
            state: 'active',
            usable: true,
            pickerVisible: true,
            recommended: true,
            registryPolicy,
            userPreference: null,
            quota,
        };

        if (quota) {
            base.quotaDepleted = true;
            if (options.treatQuotaAsBlocked) {
                base.usable = false;
                base.state = 'quota_depleted';
            }
        }

        return base;
    } finally {
        inProgress.delete(id);
        if (inProgress.size === 0) availabilityInProgress.delete(repoKey);
    }
}

function getUsableAgents(repoPath = process.cwd(), options = {}) {
    return agentRegistry.getAllAgentIds()
        .map(id => getAgentAvailability(id, repoPath, options))
        .filter(row => row.usable || options.includeAll);
}

function getUsableAgentIds(repoPath = process.cwd(), options = {}) {
    const forPicker = options.forPicker === true;
    return agentRegistry.getAllAgentIds().filter(id => {
        const avail = getAgentAvailability(id, repoPath, options);
        if (forPicker) return avail.pickerVisible && avail.usable;
        if (options.forRecommendation) return avail.recommended;
        return avail.usable;
    });
}

function getPickerAgentOptions(repoPath = process.cwd(), options = {}) {
    return getUsableAgentIds(repoPath, { ...options, forPicker: true }).map(id => {
        const agent = agentRegistry.getAgent(id);
        const avail = getAgentAvailability(id, repoPath, options);
        return {
            id,
            displayName: agent?.displayName || agent?.name || id,
            shortName: agent?.shortName || id.toUpperCase(),
            availability: avail,
        };
    });
}

function formatAgentAvailabilityReason(availability, options = {}) {
    const avail = availability || {};
    const id = avail.agentId || 'unknown';
    const reason = avail.reason ? `: ${avail.reason}` : '';
    const lines = [];

    if (avail.state === 'disabled') {
        lines.push(`❌ Agent '${id}' is disabled for this user${reason}.`);
        const scopeFlag = avail.scope === 'project' ? ' --project' : '';
        lines.push(`   Re-enable it with: aigon agent enable ${id}${scopeFlag}`);
    } else if (avail.state === 'retired') {
        lines.push(`❌ Agent '${id}' is retired and cannot be used for new work.`);
        if (avail.message) lines.push(`   ${avail.message}`);
    } else if (avail.state === 'deprecated' && avail.warning) {
        lines.push(`⚠️  Agent '${id}' is deprecated for new work.`);
        if (avail.message) lines.push(`   ${avail.message}`);
    } else if (avail.state === 'unconfigured') {
        const hint = agentRegistry.getAgentInstallHints()[id];
        lines.push(`❌ Agent '${id}' is not configured (CLI not found in PATH).`);
        if (hint) lines.push(`   Install: ${hint}`);
    } else if (avail.state === 'quota_depleted') {
        lines.push(`❌ Agent '${id}' is temporarily quota-depleted.`);
    } else {
        lines.push(`❌ Agent '${id}' is not available for new work.`);
    }

    if (options.suggestStart && options.featureId) {
        const usable = getUsableAgentIds(options.repoPath || process.cwd(), { forPicker: true });
        if (usable[0]) {
            lines.push(`   Or choose another agent: aigon feature-start ${options.featureId} ${usable[0]}`);
        }
    }

    return lines.join('\n');
}

function assertAgentUsable(agentId, repoPath = process.cwd(), options = {}) {
    const id = normalizeAgentId(agentId);
    if (!agentRegistry.getAgent(id)) {
        const err = new Error(`Unknown agent '${agentId}'.`);
        err.code = 'unknown-agent';
        throw err;
    }
    const avail = getAgentAvailability(id, repoPath, { ...options, explicit: options.explicit !== false });
    if (avail.state === 'deprecated' && avail.warning && !options.silentDeprecated) {
        console.warn(formatAgentAvailabilityReason(avail));
    }
    if (!avail.usable && avail.state !== 'deprecated') {
        const err = new Error(formatAgentAvailabilityReason(avail, options));
        err.code = avail.state;
        err.availability = avail;
        throw err;
    }
    if (avail.state === 'deprecated' && !avail.usable) {
        const err = new Error(formatAgentAvailabilityReason(avail, options));
        err.code = 'deprecated';
        err.availability = avail;
        throw err;
    }
    return avail;
}

function tryAssertAgentUsable(agentId, repoPath = process.cwd(), options = {}) {
    try {
        return { ok: true, availability: assertAgentUsable(agentId, repoPath, options) };
    } catch (e) {
        return { ok: false, error: e.message, code: e.code, availability: e.availability };
    }
}

function writeAvailabilityConfig(agentId, patch, { scope = 'global', repoPath = process.cwd() } = {}) {
    const id = normalizeAgentId(agentId);
    if (!agentRegistry.getAgent(id)) {
        throw new Error(`Unknown agent '${agentId}'.`);
    }
    const isGlobal = scope !== 'project';
    const config = isGlobal ? loadGlobalConfig() : loadProjectConfig(repoPath);
    config.agents = config.agents || {};
    config.agents[id] = config.agents[id] || {};
    const entry = config.agents[id];
    delete entry.disabled;
    entry.availability = { ...(entry.availability || {}), ...patch, updatedAt: new Date().toISOString() };
    if (isGlobal) saveGlobalConfig(config);
    else saveProjectConfig(config, repoPath);
    return entry.availability;
}

function disableAgent(agentId, { reason = 'manual', note = null, hidden = true, scope = 'global', repoPath = process.cwd() } = {}) {
    return writeAvailabilityConfig(agentId, {
        state: 'disabled',
        reason: reason || 'manual',
        note: note || undefined,
        hidden: hidden !== false,
    }, { scope, repoPath });
}

function enableAgent(agentId, { scope = 'global', repoPath = process.cwd() } = {}) {
    const id = normalizeAgentId(agentId);
    const isGlobal = scope !== 'project';
    const config = isGlobal ? loadGlobalConfig() : loadProjectConfig(repoPath);
    config.agents = config.agents || {};
    if (!config.agents[id]) return null;
    delete config.agents[id].disabled;
    if (config.agents[id].availability) {
        delete config.agents[id].availability;
        if (Object.keys(config.agents[id]).length === 0) delete config.agents[id];
    }
    if (isGlobal) saveGlobalConfig(config);
    else saveProjectConfig(config, repoPath);
    return getAgentAvailability(id, repoPath);
}

function isAgentDisabled(agentId, repoPath = process.cwd()) {
    const avail = getAgentAvailability(agentId, repoPath);
    return avail.state === 'disabled';
}

function groupAvailabilityReport(repoPath = process.cwd(), { includeAll = false } = {}) {
    const groups = {
        active: [],
        disabled: [],
        unconfigured: [],
        deprecated: [],
        retired: [],
    };
    for (const id of agentRegistry.getAllAgentIds()) {
        const avail = getAgentAvailability(id, repoPath);
        if (!includeAll && avail.state === 'disabled' && avail.hidden) {
            groups.disabled.push(avail);
            continue;
        }
        if (groups[avail.state]) groups[avail.state].push(avail);
        else if (includeAll) groups.active.push(avail);
    }
    return groups;
}

function formatAvailabilityReport(repoPath = process.cwd(), { includeAll = false } = {}) {
    const groups = groupAvailabilityReport(repoPath, { includeAll });
    const lines = [];
    const section = (title, items, formatter) => {
        if (!items.length) return;
        lines.push(`\n${title}`);
        lines.push('─'.repeat(title.length));
        for (const item of items) lines.push(formatter(item));
    };
    section('Active agents', groups.active, a => `  ✅ ${a.agentId}`);
    section('Disabled agents', groups.disabled, a => {
        const reason = a.reason ? ` (${a.reason})` : '';
        return `  ⏸  ${a.agentId}${reason}`;
    });
    section('Unconfigured agents', groups.unconfigured, a => `  ·  ${a.agentId} — CLI not installed`);
    section('Deprecated agents', groups.deprecated, a => `  ⚠️  ${a.agentId}${a.message ? ` — ${a.message}` : ''}`);
    section('Retired agents', groups.retired, a => `  🚫 ${a.agentId}${a.message ? ` — ${a.message}` : ''}`);
    if (!lines.length) lines.push('No agents registered.');
    return lines.join('\n').trim() + '\n';
}

/** Whether an agent should appear in the dashboard quota/budget panel (F593). */
function isAgentQuotaPanelVisible(agentId, repoPath = process.cwd()) {
    const id = normalizeAgentId(agentId);
    if (!agentRegistry.isAgentLaunchable(id)) return false;
    const agent = agentRegistry.getAgent(id);
    if (!agent) return false;
    if (readRegistryPolicy(agent).state === 'retired') return false;
    if (readUserAvailability(id, repoPath)) return false;
    return true;
}

function filterQuotaStateByAvailability(state, repoPath = process.cwd()) {
    if (!state || !state.agents || typeof state.agents !== 'object') return state;
    const agents = { ...state.agents };
    for (const id of Object.keys(agents)) {
        if (!isAgentQuotaPanelVisible(id, repoPath)) delete agents[id];
    }
    return { ...state, agents };
}

function getDefaultFleetAgents(repoPath = process.cwd()) {
    const fleet = agentRegistry.getAllAgents().filter(a => a.defaultFleetAgent);
    const candidates = (fleet.length ? fleet : agentRegistry.getAllAgents())
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(a => a.id);
    const usable = candidates.filter(id => {
        const avail = getAgentAvailability(id, repoPath, { forRecommendation: true });
        return avail.recommended && avail.usable;
    });
    if (usable.length === 0) {
        const err = new Error(
            'No usable default fleet agents remain after availability filtering. '
            + 'Enable an agent with `aigon agent enable <id>` or install a supported CLI.'
        );
        err.code = 'no-usable-fleet-agents';
        throw err;
    }
    return usable;
}

module.exports = {
    AVAILABILITY_STATES,
    KNOWN_DISABLE_REASONS,
    getAgentAvailability,
    getUsableAgents,
    getUsableAgentIds,
    getPickerAgentOptions,
    assertAgentUsable,
    tryAssertAgentUsable,
    formatAgentAvailabilityReason,
    disableAgent,
    enableAgent,
    isAgentDisabled,
    groupAvailabilityReport,
    formatAvailabilityReport,
    getDefaultFleetAgents,
    normalizeAgentId,
    isAgentQuotaPanelVisible,
    filterQuotaStateByAvailability,
};
