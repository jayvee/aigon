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
        // Normalise output/outputs so callers can always rely on both keys.
        // `outputs` is the canonical array; `output` is kept as a backward-compat alias pointing at outputs[0].
        if (config.outputs && !config.output) {
            config.output = config.outputs[0] || null;
        } else if (config.output && !config.outputs) {
            config.outputs = [config.output];
        }
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

function getShortNames() {
    const map = { solo: 'Drive' };
    for (const a of getAllAgents()) map[a.id] = a.shortName || String(a.id || '').toUpperCase();
    return map;
}

function getPortOffsets() {
    const map = {};
    for (const a of getAllAgents()) if (a.portOffset != null) map[a.id] = a.portOffset;
    return map;
}

function getAgentAliasMap() {
    const map = {};
    for (const agent of getAllAgents()) {
        for (const alias of Array.isArray(agent.aliases) ? agent.aliases : []) {
            map[String(alias).toLowerCase()] = agent.id;
        }
        map[String(agent.id).toLowerCase()] = agent.id;
    }
    return map;
}

function getProviderFamilies() {
    const map = {};
    for (const a of getAllAgents()) if (a.providerFamily) map[a.id] = a.providerFamily;
    return map;
}

/**
 * Agent IDs that can appear in Aigon attribution metadata.
 *
 * This is the canonical set for parsing trailers, notes, and other
 * non-author attribution signals. Keep the legacy email-specific helper
 * below for historical commit compatibility.
 */
function getAttributionAgentIds() {
    return getAllAgentIds();
}

/**
 * Agent IDs that historically used email-based git attribution
 * (e.g. cc@aigon.dev / cc@aigon.build).
 *
 * This remains for backward compatibility with historical commit parsing.
 */
function getAgentEmailIds() {
    return getAllAgents().filter(a => a.git?.hasEmailAttribution).map(a => a.id);
}

/**
 * Always include legacy `aigon.dev` for historical commit attribution.
 * Current domain is read from config and defaults to `aigon.build`.
 */
function getAttributionDomainsForRegex() {
    const domains = new Set(['aigon.dev']);
    try {
        const configuredDomain = require('./config').getAttributionDomain();
        if (configuredDomain) domains.add(String(configuredDomain).trim().toLowerCase());
    } catch (_) {
        domains.add('aigon.build');
    }
    return [...domains];
}

function escapeRegexLiteral(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex matching agent attribution emails: (cc|gg|cx|...)@(aigon.dev|aigon.build)
 */
function getAgentEmailRegex() {
    const emailAgentIds = getAgentEmailIds();
    if (emailAgentIds.length === 0) return /^$/;
    const ids = emailAgentIds.join('|');
    const domains = getAttributionDomainsForRegex().map(escapeRegexLiteral).join('|');
    return new RegExp(`^(${ids})(?:\\+[-\\w.]+)?@(?:${domains})$`, 'i');
}

/**
 * All known agent IDs including 'solo' pseudo-agent.
 */
function getKnownAgentIds() {
    return new Set([...getAllAgentIds(), 'solo']);
}

// --- Model / effort options ---

/**
 * An option is quarantined when its `quarantined` field is set (object with
 * since/reason/evidence). Quarantined entries stay in the JSON for audit, but
 * are filtered out of any picker surface by default.
 */
function isModelOptionQuarantined(opt) {
    return Boolean(opt && opt.quarantined);
}

/**
 * Return the fully-qualified model-option list for an agent's picker.
 * Shape: [{ value: string|null, label: string }, ...]
 * An empty list means "agent doesn't expose a model picker" (e.g. cu).
 * Quarantined entries are excluded — pass { includeQuarantined: true } to see them.
 */
function getModelOptions(agentId, { includeQuarantined = false } = {}) {
    const agent = getAgent(agentId);
    const options = agent?.cli?.modelOptions;
    if (!Array.isArray(options)) return [];
    const filtered = includeQuarantined ? options : options.filter(o => !isModelOptionQuarantined(o));
    return filtered.map(opt => ({ ...opt }));
}

/**
 * Return the effort-option list for an agent's picker.
 * Shape: [{ value: string|null, label: string }, ...]
 * An empty list means effort is not selectable for this agent.
 */
function getEffortOptions(agentId) {
    const agent = getAgent(agentId);
    const options = agent?.cli?.effortOptions;
    return Array.isArray(options) ? options.map(opt => ({ ...opt })) : [];
}

function getModelFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.modelFlag || null;
}

function getEffortFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.effortFlag || null;
}

function getEffortEnv(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.effortEnv || null;
}

function getPromptFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.promptFlag || null;
}

// --- Default config generation (for DEFAULT_GLOBAL_CONFIG.agents) ---

function buildDefaultAgentConfigs() {
    const configs = {};
    for (const a of getAllAgents()) {
        configs[a.id] = {
            cli: a.cli.command,
            implementFlag: a.cli.implementFlag || '',
            planFlag: a.cli.planFlag ?? null,
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

function _escapeTomlBasicString(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function _buildTomlProjectEntry(projectPath, trustLevel) {
    return `[projects."${_escapeTomlBasicString(projectPath)}"]\ntrust_level = "${trustLevel}"\n`;
}

function _removeTomlProjectEntry(config, projectPath) {
    const escapedPath = _escapeTomlBasicString(projectPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\n?\\[projects\\."${escapedPath}"\\]\\ntrust_level = "[^"\\n]*"\\n?`, 'g');
    return String(config || '').replace(pattern, '\n');
}

/**
 * Cursor Agent CLI stores trust separately from VS Code's security.workspace.trust.*
 * as ~/.cursor/projects/<slug>/.workspace-trusted (JSON with workspacePath).
 * Slug = absolute path segments joined by '-', with leading dots stripped from each segment
 * (e.g. /Users/me/.aigon/wt → Users-me-aigon-wt).
 */
function cursorAgentProjectSlug(absWorkspacePath) {
    const n = path.resolve(absWorkspacePath);
    const parts = n.split(path.sep).filter(Boolean);
    return parts.map(seg => {
        const stripped = seg.replace(/^\.+/, '');
        return stripped.length ? stripped : seg;
    }).join('-');
}

/** @returns {boolean} true if any marker was created or updated */
function ensureCursorAgentWorkspaceTrustedMarkers(projectsRoot, paths) {
    const root = _resolvePath(projectsRoot);
    let any = false;
    const cwd = process.cwd();
    for (const p of paths) {
        const workspacePath = path.resolve(cwd, p);
        const slug = cursorAgentProjectSlug(workspacePath);
        const markerPath = path.join(root, slug, '.workspace-trusted');
        const payloadObj = { trustedAt: new Date().toISOString(), workspacePath };
        const payload = `${JSON.stringify(payloadObj, null, 2)}\n`;
        let needWrite = true;
        if (fs.existsSync(markerPath)) {
            try {
                const prev = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
                if (prev && prev.workspacePath === workspacePath) needWrite = false;
            } catch (_) { /* rewrite corrupt marker */ }
        }
        if (needWrite) {
            _safeWrite(markerPath, payload);
            any = true;
        }
    }
    return any;
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
                const pathsToTrust = [...new Set([process.cwd(), ...paths].map(p => path.resolve(p)))];
                let added = false;
                for (const tp of pathsToTrust) {
                    const entry = `[projects."${tp}"]`;
                    if (config.includes(entry)) continue;
                    if (config.length > 0 && !config.endsWith('\n')) config += '\n';
                    config += `\n${_buildTomlProjectEntry(tp, trust.trustLevel)}`;
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
            // Cursor Agent CLI still prompts per cwd until ~/.cursor/projects/<slug>/.workspace-trusted exists.
            if (trust.cursorProjectsRoot && paths && paths.length > 0) {
                try {
                    const wrote = ensureCursorAgentWorkspaceTrustedMarkers(trust.cursorProjectsRoot, paths);
                    if (wrote) {
                        console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} Agent workspace trust marker(s)`);
                    }
                } catch (e) {
                    console.warn(`\u26A0\uFE0F  Could not write ${agent.displayName || agent.name} Agent workspace trust markers: ${e.message}`);
                }
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
        return;
    }

    if (agent.trust.type === 'toml-project') {
        const trustPath = _resolvePath(agent.trust.path);
        try {
            if (!fs.existsSync(trustPath)) return;
            let config = fs.readFileSync(trustPath, 'utf8');
            const resolvedPaths = [...new Set(paths.map(p => path.resolve(process.cwd(), p)))];
            resolvedPaths.forEach(projectPath => {
                config = _removeTomlProjectEntry(config, projectPath);
            });
            fs.writeFileSync(trustPath, config.replace(/^\n+/, ''));
        } catch (e) { /* Silent fail on cleanup */ }
        return;
    }

    if (agent.trust.type === 'vscode-settings-bool' && agent.trust.cursorProjectsRoot) {
        try {
            const root = _resolvePath(agent.trust.cursorProjectsRoot);
            const cwd = process.cwd();
            for (const p of paths) {
                const workspacePath = path.resolve(cwd, p);
                const slug = cursorAgentProjectSlug(workspacePath);
                const marker = path.join(root, slug, '.workspace-trusted');
                if (fs.existsSync(marker)) fs.unlinkSync(marker);
            }
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

// Defaults to false (fail-closed): an agent that does not declare native
// slash-command resolution must not receive slash-command-shaped directives
// in mid-session tmux injections — they would arrive as unrunnable phantoms.
function isSlashCommandInvocable(agentId) {
    const agent = getAgent(agentId);
    return agent?.capabilities?.resolvesSlashCommands === true;
}

function getTokenExhaustionDetectors(agentId) {
    const agent = getAgent(agentId);
    const raw = agent?.failureDetectors?.tokenExhaustion;
    if (!raw || typeof raw !== 'object') {
        return { exitCodes: [], stderrPatterns: [] };
    }
    return {
        exitCodes: Array.isArray(raw.exitCodes) ? raw.exitCodes.map(Number).filter(Number.isFinite) : [],
        stderrPatterns: Array.isArray(raw.stderrPatterns) ? raw.stderrPatterns.map(String).filter(Boolean) : [],
    };
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

function describeImplementMode(agent) {
    const flag = String(agent?.cli?.implementFlag || '').trim();
    if (flag.includes('acceptEdits')) return 'Auto-edits, prompts for risky Bash';
    if (flag.includes('--yolo')) return 'Auto-approves all';
    if (flag.includes('--force')) return 'Auto-approves commands (yolo mode)';
    if (!flag) return 'Workspace-write, smart approval';
    return flag;
}

function getAgentCliMappingRows() {
    return getAllAgents()
        .slice()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(agent => ({
            id: agent.id,
            displayName: agent.displayName || agent.name,
            command: [agent.cli?.command, agent.cli?.implementFlag].filter(Boolean).join(' ').trim(),
            mode: describeImplementMode(agent),
        }));
}

function getRegistryBackedAgentGroups() {
    const slashCommandAgentIds = [];
    const skillAgentIds = [];
    for (const agent of getAllAgents()) {
        if (agent?.capabilities?.resolvesSlashCommands === true) {
            slashCommandAgentIds.push(agent.id);
        } else {
            skillAgentIds.push(agent.id);
        }
    }
    return { slashCommandAgentIds, skillAgentIds };
}

function getDashboardAgents() {
    return getAllAgents()
        .slice()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(agent => ({
            id: agent.id,
            displayName: agent.displayName || agent.name,
            shortName: agent.shortName || String(agent.id || '').toUpperCase(),
            autonomousEligible: agent?.signals?.shellTrap === true,
            defaultFleetAgent: agent.defaultFleetAgent === true,
            slashCommandInvocable: agent?.capabilities?.resolvesSlashCommands === true,
            cmdPrefix: agent?.placeholders?.CMD_PREFIX || '/aigon:',
            modelOptions: Array.isArray(agent?.cli?.modelOptions)
                ? agent.cli.modelOptions
                    .filter(o => !isModelOptionQuarantined(o))
                    .map(o => {
                        // Strip matrix-specific fields (notes, score, pricing, lastRefreshAt)
                        // — those are served by /api/agent-matrix, not the bootstrap payload.
                        const { notes: _n, score: _s, pricing: _p, lastRefreshAt: _r, ...rest } = o;
                        return rest;
                    })
                : [],
            effortOptions: Array.isArray(agent?.cli?.effortOptions)
                ? agent.cli.effortOptions.map(o => ({ ...o }))
                : [],
            supportsModelPicker: Array.isArray(agent?.cli?.modelOptions)
                && agent.cli.modelOptions.some(o => !isModelOptionQuarantined(o)),
            supportsEffortPicker: Array.isArray(agent?.cli?.effortOptions) && agent.cli.effortOptions.length > 0,
        }));
}

function getLegacyAgentConfigs() {
    const configs = {};
    for (const agent of getAllAgents()) {
        configs[agent.id] = {
            id: agent.id,
            name: agent.displayName || agent.name,
            rootFile: agent.rootFile || null,
            supportsAgentsMd: agent.supportsAgentsMd === true,
            agentFile: agent.agentFile,
            templatePath: agent.templatePath,
            port: agent.portOffset != null ? 3000 + Number(agent.portOffset) : null,
            terminalColor: agent.terminalColor || 'blue',
            bannerColor: agent.bannerColor || '#888888',
        };
    }
    return configs;
}

// --- Legacy detection paths (for setup install-agent detection) ---

function getLegacyPaths(agentId) {
    const agent = getAgent(agentId);
    return agent?.legacy || {};
}

// --- Runtime capabilities (data-driven dispatch for per-agent behaviour) ---

function getAgentRuntime(agentId) {
    const agent = getAgent(agentId);
    return agent?.runtime || {};
}

function getSessionStrategy(agentId) {
    return getAgentRuntime(agentId).sessionStrategy || null;
}

function getTelemetryStrategy(agentId) {
    return getAgentRuntime(agentId).telemetryStrategy || null;
}

function getTrustInstallScope(agentId) {
    return getAgentRuntime(agentId).trustInstallScope || 'worktree-base';
}

function getResumeConfig(agentId) {
    return getAgentRuntime(agentId).resume || null;
}

function getCapturableAgentIds() {
    return getAllAgents()
        .filter(a => a?.runtime?.sessionStrategy)
        .map(a => a.id);
}

module.exports = {
    getAgent,
    getAllAgentIds,
    getAllAgents,
    getDisplayNames,
    getShortNames,
    getPortOffsets,
    getAgentAliasMap,
    getProviderFamilies,
    getAttributionAgentIds,
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
    isSlashCommandInvocable,
    getTokenExhaustionDetectors,
    getSortedAgentIds,
    getDefaultFleetAgents,
    getAgentBinMap,
    getAgentInstallHints,
    getAgentCliMappingRows,
    getRegistryBackedAgentGroups,
    getDashboardAgents,
    getLegacyAgentConfigs,
    getLegacyPaths,
    getModelOptions,
    isModelOptionQuarantined,
    getEffortOptions,
    getModelFlag,
    getEffortFlag,
    getEffortEnv,
    getPromptFlag,
    getAgentRuntime,
    getSessionStrategy,
    getTelemetryStrategy,
    getTrustInstallScope,
    getResumeConfig,
    getCapturableAgentIds,
    // For test overrides
    _resetCache: () => { _agents = null; },
    _test: {
        cursorAgentProjectSlug,
        ensureCursorAgentWorkspaceTrustedMarkers,
    },
};
