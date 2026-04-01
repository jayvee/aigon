'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'templates');
const AGENTS_DIR = path.join(TEMPLATES_ROOT, 'agents');

// --- Agent config cache (loaded once at require-time) ---
let _agents = null;

function _loadAll() {
    if (_agents) return _agents;
    _agents = {};
    if (!fs.existsSync(AGENTS_DIR)) return _agents;
    for (const file of fs.readdirSync(AGENTS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const config = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8'));
        _agents[config.id] = config;
    }
    return _agents;
}

// --- Lookup functions ---

function getAgent(id) { return _loadAll()[id] || null; }
function getAllAgentIds() { return Object.keys(_loadAll()); }
function getAllAgents() { return Object.values(_loadAll()); }

function getDisplayNames() {
    const map = {};
    for (const a of getAllAgents()) map[a.id] = a.displayName || a.name;
    return map;
}

function getPortOffsets() {
    const map = {};
    for (const a of getAllAgents()) if (a.portOffset != null) map[a.id] = a.portOffset;
    return map;
}

function getProviderFamilies() {
    const map = {};
    for (const a of getAllAgents()) if (a.providerFamily) map[a.id] = a.providerFamily;
    return map;
}

/**
 * Agent IDs that use email-based git attribution (e.g. cc@aigon.dev).
 * Used to build commit-parsing regexes.
 */
function getAgentEmailIds() {
    return getAllAgents().filter(a => a.git?.hasEmailAttribution).map(a => a.id);
}

/**
 * Regex matching agent attribution emails: (cc|gg|cx|...)@aigon.dev
 */
function getAgentEmailRegex() {
    const ids = getAgentEmailIds().join('|');
    return new RegExp(`^(${ids})(?:\\+[-\\w.]+)?@aigon\\.dev$`, 'i');
}

/**
 * All known agent IDs including 'solo' pseudo-agent.
 */
function getKnownAgentIds() {
    return new Set([...getAllAgentIds(), 'solo']);
}

// --- Default config generation (for DEFAULT_GLOBAL_CONFIG.agents) ---

function buildDefaultAgentConfigs() {
    const configs = {};
    for (const a of getAllAgents()) {
        configs[a.id] = {
            cli: a.cli.command,
            implementFlag: a.cli.implementFlag || '',
            models: { ...a.cli.models },
        };
    }
    return configs;
}

// --- Process detection map (for detectActiveAgentSession) ---

function getProcessDetectionMap() {
    const map = {};
    for (const a of getAllAgents()) {
        map[a.cli.command] = { agentId: a.id, agentName: a.displayName || a.name };
    }
    return map;
}

// --- Trust setup ---

function _safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

function _resolvePath(p) {
    return p.replace(/^~/, os.homedir());
}

/**
 * Ensure workspace trust for an agent across multiple paths.
 * For json-kv type (Gemini), trusts the parent directory of the first path.
 * No-op if the agent has no trust config.
 */
function ensureAgentTrust(agentId, paths) {
    const agent = getAgent(agentId);
    if (!agent?.trust) return;

    const trust = agent.trust;
    const trustPath = _resolvePath(trust.path);

    switch (trust.type) {
        case 'claude-json': {
            try {
                let config = {};
                if (fs.existsSync(trustPath)) {
                    config = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                }
                if (!config.projects) config.projects = {};
                const cwd = process.cwd();
                let changed = false;
                for (const p of paths) {
                    const abs = path.resolve(cwd, p);
                    if (!config.projects[abs]) config.projects[abs] = {};
                    if (!config.projects[abs][trust.projectKey]) {
                        config.projects[abs][trust.projectKey] = true;
                        changed = true;
                    }
                }
                if (changed) {
                    fs.writeFileSync(trustPath, JSON.stringify(config, null, 2));
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} workspace trust for worktree(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'json-kv': {
            try {
                let trusted = {};
                if (fs.existsSync(trustPath)) {
                    trusted = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                }
                let changed = false;
                if (paths.length > 0) {
                    const parentDir = path.dirname(path.resolve(process.cwd(), paths[0]));
                    if (!trusted[parentDir]) {
                        trusted[parentDir] = trust.parentValue || trust.value;
                        changed = true;
                    }
                }
                if (changed) {
                    _safeWrite(trustPath, JSON.stringify(trusted, null, 2));
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} workspace trust for worktree(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'toml-project': {
            try {
                let config = '';
                if (fs.existsSync(trustPath)) {
                    config = fs.readFileSync(trustPath, 'utf8');
                }
                const pathsToTrust = [process.cwd(), ...paths].map(p => path.resolve(p));
                let added = false;
                for (const tp of pathsToTrust) {
                    const entry = `[projects."${tp}"]`;
                    if (config.includes(entry)) continue;
                    if (config.length > 0 && !config.endsWith('\n')) config += '\n';
                    config += `\n${entry}\ntrust_level = "${trust.trustLevel}"\n`;
                    added = true;
                }
                if (added) {
                    _safeWrite(trustPath, config);
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} project trust for ${pathsToTrust.length} path(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'vscode-settings-bool': {
            // Sets a boolean in a VSCode/Cursor global settings JSON file.
            // Used to disable workspace trust globally (security.workspace.trust.enabled = false).
            try {
                let settings = {};
                if (fs.existsSync(trustPath)) {
                    settings = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                }
                if (settings[trust.key] !== trust.value) {
                    settings[trust.key] = trust.value;
                    _safeWrite(trustPath, JSON.stringify(settings, null, 2));
                    console.log(`\uD83D\uDD13 Configured ${agent.displayName || agent.name} workspace trust setting`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not configure ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
    }
}

/**
 * Register a single worktree path as trusted for an agent.
 * For json-kv type, uses the direct value (TRUST_FOLDER) rather than parent.
 */
function ensureSinglePathTrust(agentId, worktreePath) {
    const agent = getAgent(agentId);
    if (!agent?.trust) return;

    const trust = agent.trust;
    const trustFilePath = _resolvePath(trust.path);

    if (trust.type === 'json-kv') {
        try {
            let trusted = {};
            if (fs.existsSync(trustFilePath)) {
                trusted = JSON.parse(fs.readFileSync(trustFilePath, 'utf8'));
            }
            if (!trusted[worktreePath]) {
                trusted[worktreePath] = trust.value;
                _safeWrite(trustFilePath, JSON.stringify(trusted, null, 4));
                console.log(`   \uD83D\uDD13 Pre-registered ${agent.displayName || agent.name} trusted folder`);
            }
        } catch (e) { /* non-fatal */ }
    } else {
        ensureAgentTrust(agentId, [worktreePath]);
    }
}

/**
 * Remove trust entries for paths (used during worktree cleanup).
 */
function removeAgentTrust(agentId, paths) {
    const agent = getAgent(agentId);
    if (!agent?.trust) return;

    if (agent.trust.type === 'claude-json') {
        const trustPath = _resolvePath(agent.trust.path);
        try {
            if (!fs.existsSync(trustPath)) return;
            const config = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
            if (!config.projects) return;
            const cwd = process.cwd();
            for (const p of paths) {
                delete config.projects[path.resolve(cwd, p)];
            }
            fs.writeFileSync(trustPath, JSON.stringify(config, null, 2));
        } catch (e) { /* Silent fail on cleanup */ }
    }
}

// --- Worktree environment ---

function _shellQuote(s) {
    if (/^[A-Za-z0-9_./:=-]+$/.test(s)) return s;
    return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build shell export statements for agent-specific worktree env vars.
 * Returns empty string if the agent has no worktreeEnv config.
 * Includes trailing ' && ' when non-empty.
 */
function getWorktreeEnvExports(agentId, worktreePath) {
    const agent = getAgent(agentId);
    if (!agent?.worktreeEnv || Object.keys(agent.worktreeEnv).length === 0) return '';

    const exports = [];
    for (const [key, template] of Object.entries(agent.worktreeEnv)) {
        const value = template.replace('{worktreePath}', worktreePath);
        exports.push(`export ${key}=${_shellQuote(value)}`);
    }
    return exports.join(' && ') + ' && ';
}

// --- Agent capability checks ---

function supportsModelFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.capabilities?.supportsModelFlag !== false;
}

function supportsTranscriptTelemetry(agentId) {
    const agent = getAgent(agentId);
    return agent?.capabilities?.transcriptTelemetry === true;
}

// --- Sort order (by portOffset) ---

function getSortedAgentIds() {
    return getAllAgents()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(a => a.id);
}

// --- Default fleet agents ---

function getDefaultFleetAgents() {
    const agents = getAllAgents().filter(a => a.defaultFleetAgent);
    if (agents.length === 0) return getAllAgentIds().slice(0, 2); // fallback
    return agents.sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99)).map(a => a.id);
}

// --- Install hints (for doctor command) ---

function getAgentBinMap() {
    const map = {};
    for (const a of getAllAgents()) map[a.id] = a.cli.command;
    return map;
}

function getAgentInstallHints() {
    const map = {};
    for (const a of getAllAgents()) if (a.installHint) map[a.id] = a.installHint;
    return map;
}

// --- Legacy detection paths (for setup install-agent detection) ---

function getLegacyPaths(agentId) {
    const agent = getAgent(agentId);
    return agent?.legacy || {};
}

module.exports = {
    getAgent,
    getAllAgentIds,
    getAllAgents,
    getDisplayNames,
    getPortOffsets,
    getProviderFamilies,
    getAgentEmailIds,
    getAgentEmailRegex,
    getKnownAgentIds,
    buildDefaultAgentConfigs,
    getProcessDetectionMap,
    ensureAgentTrust,
    ensureSinglePathTrust,
    removeAgentTrust,
    getWorktreeEnvExports,
    supportsModelFlag,
    supportsTranscriptTelemetry,
    getSortedAgentIds,
    getDefaultFleetAgents,
    getAgentBinMap,
    getAgentInstallHints,
    getLegacyPaths,
    // For test overrides
    _resetCache: () => { _agents = null; },
};
