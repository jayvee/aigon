'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// --- Editor Detection & Auto-Open ---

function detectEditor() {
    // 1. Explicit override (AIGON_EDITOR=code, or AIGON_EDITOR=none to disable)
    const override = process.env.AIGON_EDITOR;
    if (override) {
        if (override === 'none' || override === 'false' || override === '0') {
            return null;
        }
        return override;
    }

    // 2. Detect IDE from environment (order matters - check forks before VS Code)

    // Cursor (VS Code fork)
    if (process.env.CURSOR_TRACE_ID) {
        return 'cursor';
    }

    // Windsurf (VS Code fork)
    if (process.env.TERM_PROGRAM === 'windsurf') {
        return 'windsurf';
    }

    // VS Code (check after forks)
    if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_IPC_HOOK_CLI) {
        return 'code';
    }

    // Zed
    if (process.env.TERM_PROGRAM === 'zed') {
        return 'zed';
    }

    // No IDE detected - don't auto-open (avoid hijacking terminal with vim/nano)
    return null;
}

function openInEditor(filePath) {
    const editor = detectEditor();
    if (!editor) return;

    try {
        spawnSync(editor, [filePath], { stdio: 'ignore' });
    } catch (e) {
        // Silently fail - opening editor is nice-to-have, not critical
    }
}

/**
 * Detect whether Aigon is currently running inside an active agent session
 * (Claude Code, Gemini CLI, Codex CLI, Cursor, or similar agent host).
 *
 * Returns { detected: boolean, agentId: string|null, agentName: string|null }
 *
 * This shared helper is used by shell-launch commands (e.g. feature-do)
 * to avoid spawning nested agent sessions.
 */
function detectActiveAgentSession() {
    // Walk up the process tree looking for a known agent process.
    // Env-var-only checks (especially CLAUDECODE) can leak into child shells,
    // so process ancestry remains the primary signal.
    const agentProcesses = {
        claude: { agentId: 'cc', agentName: 'Claude Code' },
        gemini: { agentId: 'gg', agentName: 'Gemini CLI' },
        codex: { agentId: 'cx', agentName: 'Codex CLI' },
    };
    const processHints = [
        { key: 'claude', info: agentProcesses.claude },
        { key: 'gemini', info: agentProcesses.gemini },
        { key: 'codex', info: agentProcesses.codex },
    ];

    try {
        let pid = process.ppid;
        for (let depth = 0; depth < 10 && pid && pid > 1; depth++) {
            const commRaw = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim().toLowerCase();
            const argsRaw = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' }).trim().toLowerCase();
            const ppidRaw = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf8' }).trim();
            const commBase = path.basename(commRaw);

            if (agentProcesses[commBase]) {
                return { detected: true, ...agentProcesses[commBase] };
            }

            for (const hint of processHints) {
                if (argsRaw.includes(hint.key)) {
                    return { detected: true, ...hint.info };
                }
            }

            const nextPid = parseInt(ppidRaw, 10);
            if (!Number.isInteger(nextPid) || nextPid <= 1) break;
            pid = nextPid;
        }
    } catch (_) {
        // Silently ignore if parent process detection fails
    }

    // Cursor sets CURSOR_TRACE_ID — env var is fine here because Cursor
    // is a GUI app and won't leak the var to unrelated terminal tabs.
    if (process.env.CURSOR_TRACE_ID) {
        return { detected: true, agentId: 'cu', agentName: 'Cursor' };
    }

    // Fallback for non-interactive invocations where ancestry may be hidden
    // (e.g. Codex --full-auto command execution). Avoid CLAUDECODE here
    // because it is known to leak into spawned terminal tabs.
    if (!process.stdin.isTTY) {
        if (process.env.OPENAI_CODEX_CLI || process.env.CODEX) {
            return { detected: true, agentId: 'cx', agentName: 'Codex CLI' };
        }
        if (process.env.GEMINI_CLI) {
            return { detected: true, agentId: 'gg', agentName: 'Gemini CLI' };
        }
    }

    return { detected: false, agentId: null, agentName: null };
}

/**
 * Print a warning when an agent-required command is run from a bare shell.
 * No-ops if running inside a recognised agent session.
 *
 * @param {string} commandName  e.g. 'feature-do'
 * @param {string|undefined} id  The feature/research ID (for the suggested command)
 */
function printAgentContextWarning(commandName, id) {
    const session = detectActiveAgentSession();
    if (session.detected) return;

    const idPart = id ? ` ${id}` : '';
    const hasRalph = commandName === 'feature-do';

    console.log('');
    console.log(`⚠️  This command is meant to run inside an AI agent session.`);
    console.log('');
    console.log(`Running 'aigon ${commandName}' from the terminal will print instructions`);
    console.log(`that an agent should read — but without an agent, nothing will happen.`);
    console.log('');
    console.log(`Open your agent (Claude Code, Cursor, Gemini, Codex) and run:`);
    console.log(`  /aigon:${commandName}${idPart}`);
    if (hasRalph) {
        console.log('');
        console.log(`Or, run in Autopilot mode:`);
        console.log(`  aigon ${commandName}${idPart} --autonomous`);
    }
    console.log('');
}

// --- Mode Normalization (legacy alias resolution) ---
function normalizeMode(mode) {
    const aliases = { solo: 'drive', arena: 'fleet', 'solo-wt': 'drive-wt' };
    return aliases[mode] || mode;
}

// --- Provider Family Map (for self-evaluation bias detection) ---
const PROVIDER_FAMILIES = {
    cc: 'anthropic',
    cu: 'varies',   // Cursor proxies multiple providers
    gg: 'google',
    cx: 'openai',
};

/**
 * Check if two agents are from the same provider family.
 * Returns true when both are known AND their families match.
 * 'varies' (Cursor) never triggers the warning.
 */
function isSameProviderFamily(agentA, agentB) {
    const familyA = PROVIDER_FAMILIES[agentA];
    const familyB = PROVIDER_FAMILIES[agentB];
    if (!familyA || !familyB) return false;
    if (familyA === 'varies' || familyB === 'varies') return false;
    return familyA === familyB;
}

// --- Configuration ---
const SPECS_ROOT = path.join(process.cwd(), 'docs', 'specs');
const ROOT_DIR = path.join(__dirname, '..');
const CLI_ENTRY_PATH = path.join(ROOT_DIR, 'aigon-cli.js');
const TEMPLATES_ROOT = path.join(ROOT_DIR, 'templates');
const CLAUDE_SETTINGS_PATH = path.join(process.cwd(), '.claude', 'settings.json');
const HOOKS_FILE_PATH = path.join(process.cwd(), 'docs', 'aigon-hooks.md');

// --- Project Configuration ---
const PROJECT_CONFIG_PATH = path.join(process.cwd(), '.aigon', 'config.json');

// --- Global User Configuration ---
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.aigon');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');
const RADAR_DEFAULT_PORT = 4321;
const RADAR_PID_FILE = path.join(GLOBAL_CONFIG_DIR, 'radar.pid');
const RADAR_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'radar.log');
const RADAR_META_FILE = path.join(GLOBAL_CONFIG_DIR, 'radar.json');

const DEFAULT_GLOBAL_CONFIG = {
    terminal: 'warp',
    tmuxApp: 'terminal',  // Terminal app for tmux attach: 'terminal' (Terminal.app) or 'iterm2' (iTerm2)
    agents: {
        cc: { cli: 'claude', implementFlag: '--permission-mode acceptEdits' },
        cu: { cli: 'agent', implementFlag: '--force' },
        gg: { cli: 'gemini', implementFlag: '--yolo' },
        cx: { cli: 'codex', implementFlag: '' }
    }
};

/**
 * Load global Aigon configuration from ~/.aigon/config.json
 * @returns {Object} Merged config (defaults + user overrides)
 */
function loadGlobalConfig() {
    let userConfig = {};
    const configExists = fs.existsSync(GLOBAL_CONFIG_PATH);
    
    if (configExists) {
        try {
            userConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        } catch (e) {
            console.warn(`⚠️  Could not parse ~/.aigon/config.json: ${e.message}`);
        }
    }

    // Only use DEFAULT_GLOBAL_CONFIG if config file exists (user has initialized config)
    // If no config file exists, return empty object so template defaults are used
    if (!configExists) {
        // Environment variable override for terminal still works
        const result = {};
        if (process.env.AIGON_TERMINAL) {
            result.terminal = process.env.AIGON_TERMINAL;
        }
        return result;
    }

    // Deep merge: user config overrides defaults
    const merged = { ...DEFAULT_GLOBAL_CONFIG };
    if (userConfig.terminal) merged.terminal = userConfig.terminal;
    if (userConfig.agents) {
        merged.agents = { ...DEFAULT_GLOBAL_CONFIG.agents };
        Object.entries(userConfig.agents).forEach(([key, value]) => {
            merged.agents[key] = { ...merged.agents[key], ...value };
        });
    }
    // Merge other user config keys (tmuxApp, etc.)
    Object.keys(userConfig).forEach(key => {
        if (key !== 'terminal' && key !== 'agents') {
            merged[key] = userConfig[key];
        }
    });

    // Environment variable override for terminal
    if (process.env.AIGON_TERMINAL) {
        merged.terminal = process.env.AIGON_TERMINAL;
    }

    return merged;
}

// --- Project Profile System ---

const PROFILE_PRESET_STRING_FILES = {
    testInstructions: 'test-instructions.md',
    manualTestingGuidance: 'manual-testing-guidance.md',
    depCheck: 'dep-check.md'
};

function loadProfilePresetStrings(profileName) {
    const profileDir = path.join(TEMPLATES_ROOT, 'profiles', profileName);
    const readField = fileName => {
        const fieldPath = path.join(profileDir, fileName);
        if (!fs.existsSync(fieldPath)) return '';
        return fs.readFileSync(fieldPath, 'utf8').trimEnd();
    };

    return {
        testInstructions: readField(PROFILE_PRESET_STRING_FILES.testInstructions),
        manualTestingGuidance: readField(PROFILE_PRESET_STRING_FILES.manualTestingGuidance),
        depCheck: readField(PROFILE_PRESET_STRING_FILES.depCheck)
    };
}

const PROFILE_PRESETS = {
    web: {
        devServer: {
            enabled: true,
            ports: { cc: 3001, gg: 3002, cx: 3003, cu: 3004 }
        },
        setupEnvLine: '- Set up `.env.local` with agent-specific PORT (worktree modes)'
    },
    api: {
        devServer: {
            enabled: true,
            ports: { cc: 8001, gg: 8002, cx: 8003, cu: 8004 }
        },
        setupEnvLine: '- Set up `.env.local` with agent-specific PORT (worktree modes)'
    },
    ios: {
        devServer: { enabled: false, ports: {} },
        setupEnvLine: ''
    },
    android: {
        devServer: { enabled: false, ports: {} },
        setupEnvLine: ''
    },
    library: {
        devServer: { enabled: false, ports: {} },
        setupEnvLine: ''
    },
    generic: {
        devServer: { enabled: false, ports: {} },
        setupEnvLine: ''
    }
};

Object.entries(PROFILE_PRESETS).forEach(([profileName, preset]) => {
    Object.assign(preset, loadProfilePresetStrings(profileName));
});

/**
 * Load project-level Aigon config from .aigon/config.json
 * @returns {Object} Project config or empty object if not found
 */
function loadProjectConfig() {
    if (!fs.existsSync(PROJECT_CONFIG_PATH)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(PROJECT_CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.warn(`⚠️  Could not parse .aigon/config.json: ${e.message}`);
        return {};
    }
}

/**
 * Save project-level Aigon config to .aigon/config.json
 * @param {Object} config - Config object to save
 */
function saveProjectConfig(config) {
    safeWrite(PROJECT_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Save global Aigon config to ~/.aigon/config.json
 * @param {Object} config - Config object to save
 */
function saveGlobalConfig(config) {
    safeWrite(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Resolve config key aliases (new names → legacy internal names)
 * @param {string} path - Config key path (e.g., "fleet.testInstructions")
 * @returns {string} Resolved path (e.g., "arena.testInstructions")
 */
function resolveConfigKeyAlias(path) {
    const aliases = { fleet: 'arena', autonomous: 'ralph' };
    const parts = path.split('.');
    if (aliases[parts[0]]) {
        parts[0] = aliases[parts[0]];
    }
    return parts.join('.');
}

/**
 * Get a nested value from an object using dot-notation path
 * @param {Object} obj - Object to get value from
 * @param {string} path - Dot-notation path (e.g., "fleet.testInstructions")
 * @returns {any} Value at path, or undefined if not found
 */
function getNestedValue(obj, path) {
    path = resolveConfigKeyAlias(path);
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = current[key];
    }
    return current;
}

/**
 * Set a nested value in an object using dot-notation path
 * @param {Object} obj - Object to set value in
 * @param {string} path - Dot-notation path (e.g., "fleet.testInstructions")
 * @param {any} value - Value to set
 */
function setNestedValue(obj, path, value) {
    path = resolveConfigKeyAlias(path);
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

/**
 * Determine config scope from command arguments
 * @param {string[]} args - Command arguments
 * @returns {{scope: 'global'|'project', remainingArgs: string[]}} Scope and remaining args
 */
function parseConfigScope(args) {
    const scopeIndex = args.indexOf('--global');
    if (scopeIndex !== -1) {
        return { scope: 'global', remainingArgs: args.filter((_, i) => i !== scopeIndex) };
    }
    const projectIndex = args.indexOf('--project');
    if (projectIndex !== -1) {
        return { scope: 'project', remainingArgs: args.filter((_, i) => i !== projectIndex) };
    }
    // Default to project scope
    return { scope: 'project', remainingArgs: args };
}

/**
 * Get effective config value with provenance tracking
 * Precedence: project config > global config > defaults
 * @param {string} key - Dot-notation key path
 * @returns {{value: any, source: 'project'|'global'|'default', path: string}} Value with provenance
 */
function getConfigValueWithProvenance(key) {
    const projectConfig = loadProjectConfig();

    // Read raw global config (not merged with defaults) for accurate provenance
    let rawGlobalConfig = {};
    try {
        if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
            rawGlobalConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        }
    } catch (e) { /* ignore parse errors */ }

    // Check project config first (highest priority)
    const projectValue = getNestedValue(projectConfig, key);
    if (projectValue !== undefined) {
        return { value: projectValue, source: 'project', path: PROJECT_CONFIG_PATH };
    }

    // Check raw global config (only values the user actually set)
    const globalValue = getNestedValue(rawGlobalConfig, key);
    if (globalValue !== undefined) {
        return { value: globalValue, source: 'global', path: GLOBAL_CONFIG_PATH };
    }

    // Check defaults
    const defaultValue = getNestedValue(DEFAULT_GLOBAL_CONFIG, key);
    if (defaultValue !== undefined) {
        return { value: defaultValue, source: 'default', path: 'default' };
    }

    return { value: undefined, source: 'none', path: 'none' };
}

/**
 * Get merged effective config from all levels
 * @returns {Object} Merged config object
 */
function getEffectiveConfig() {
    const projectConfig = loadProjectConfig();
    const globalConfig = loadGlobalConfig();
    
    // Deep merge: project > global > defaults
    const merged = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_CONFIG));
    
    // Merge global config
    if (globalConfig.terminal) merged.terminal = globalConfig.terminal;
    if (globalConfig.agents) {
        merged.agents = { ...merged.agents };
        Object.entries(globalConfig.agents).forEach(([key, value]) => {
            merged.agents[key] = { ...merged.agents[key], ...value };
        });
    }
    // Merge other global config keys (deep copy to avoid reference issues)
    Object.keys(globalConfig).forEach(key => {
        if (key !== 'terminal' && key !== 'agents') {
            if (typeof globalConfig[key] === 'object' && globalConfig[key] !== null && !Array.isArray(globalConfig[key])) {
                merged[key] = { ...merged[key], ...globalConfig[key] };
            } else {
                merged[key] = globalConfig[key];
            }
        }
    });
    
    // Merge project config (highest priority)
    Object.keys(projectConfig).forEach(key => {
        if (key === 'agents' && projectConfig.agents) {
            if (!merged.agents) merged.agents = {};
            Object.entries(projectConfig.agents).forEach(([agentId, agentConfig]) => {
                merged.agents[agentId] = { ...merged.agents[agentId], ...agentConfig };
            });
        } else {
            merged[key] = projectConfig[key];
        }
    });
    
    return merged;
}

/**
 * Read PORT from env files in the project root.
 * Checks .env.local first (local overrides), then .env (shared defaults).
 * @returns {{port: number, source: string}|null}
 */
function readBasePort() {
    const envFiles = ['.env.local', '.env'];
    for (const file of envFiles) {
        const envPath = path.join(process.cwd(), file);
        if (!fs.existsSync(envPath)) continue;
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/^PORT=(\d+)/m);
            if (match) return { port: parseInt(match[1], 10), source: file };
        } catch (e) { /* ignore read errors */ }
    }
    return null;
}

/**
 * Display port configuration summary.
 * Shows base port from env files and derived arena ports.
 */
function showPortSummary() {
    const profile = getActiveProfile();
    if (!profile.devServer.enabled) return;

    const result = readBasePort();
    const ports = profile.devServer.ports;
    const portsStr = Object.entries(ports).map(([k, v]) => `${k}=${v}`).join(', ');

    if (result) {
        console.log(`\n📋 Ports (from ${result.source} PORT=${result.port}):`);
        console.log(`   Main:  ${result.port}`);
        console.log(`   Fleet: ${portsStr}`);
    } else {
        console.log(`\n⚠️  No PORT found in .env.local or .env`);
        console.log(`   Using defaults — Main: 3000, Fleet: ${portsStr}`);
        console.log(`   💡 Add PORT=<number> to .env to avoid clashes with other projects`);
    }
}

// --- Dev Proxy System ---

const DEV_PROXY_DIR = path.join(os.homedir(), '.aigon', 'dev-proxy');
const DEV_PROXY_REGISTRY = path.join(DEV_PROXY_DIR, 'servers.json');
const DEV_PROXY_CADDYFILE = path.join(DEV_PROXY_DIR, 'Caddyfile');
const DEV_PROXY_LOGS_DIR = path.join(DEV_PROXY_DIR, 'logs');

// --- Global Port Registry ---
const PORT_REGISTRY_PATH = path.join(os.homedir(), '.aigon', 'ports.json');

/**
 * Sanitize a string for use as a DNS label.
 * Lowercase, strip npm scope, replace non-alphanumeric with hyphens.
 * @param {string} name - Raw name
 * @returns {string} DNS-safe label
 */
function sanitizeForDns(name) {
    return name
        .toLowerCase()
        .replace(/^@[^/]+\//, '')          // strip npm scope
        .replace(/[^a-z0-9]+/g, '-')       // replace non-alphanumeric
        .replace(/^-+|-+$/g, '')           // trim leading/trailing hyphens
        .replace(/-{2,}/g, '-');           // collapse multiple hyphens
}

/**
 * Get the app ID for dev proxy URLs.
 * Priority: .aigon/config.json appId > package.json name > main repo dirname (worktree) > dirname
 * @returns {string} DNS-safe app ID
 */
function getAppId() {
    // 1. Explicit config
    const projectConfig = loadProjectConfig();
    if (projectConfig.appId) return sanitizeForDns(projectConfig.appId);

    // 2. package.json name
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.name) return sanitizeForDns(pkg.name);
        } catch (e) { /* ignore */ }
    }

    // 3. If in a git worktree, use the main repo's directory name
    // git rev-parse --git-common-dir returns an absolute path in worktrees, relative '.git' in main repo
    try {
        const commonDir = execSync('git rev-parse --git-common-dir', { stdio: 'pipe' }).toString().trim();
        if (path.isAbsolute(commonDir)) {
            return sanitizeForDns(path.basename(path.dirname(commonDir)));
        }
    } catch (e) { /* not in git */ }

    // 4. Directory name
    return sanitizeForDns(path.basename(process.cwd()));
}

/**
 * Check if a port is available by attempting to listen on it.
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if available
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Find an available port, starting from preferred.
 * @param {number} preferred - Preferred port to try first
 * @returns {Promise<number>} Available port
 */
async function allocatePort(preferred) {
    for (let port = preferred; port < preferred + 100; port++) {
        if (await isPortAvailable(port)) return port;
    }
    throw new Error(`No available port found in range ${preferred}-${preferred + 99}`);
}

/**
 * Check if the dev proxy (Caddy + dnsmasq) is available.
 * @returns {boolean} True if Caddy is installed and the Caddyfile symlink is in place
 */
function isProxyAvailable() {
    try {
        execSync('caddy version', { stdio: 'pipe' });
        // Check that our Caddyfile symlink is in place (proxy has been set up)
        return fs.existsSync(DEV_PROXY_CADDYFILE);
    } catch (e) {
        return false;
    }
}

/**
 * Load the dev proxy server registry.
 * @returns {Object} Registry object { appId: { serverId: { port, worktree, pid, started } } }
 */
function loadProxyRegistry() {
    if (!fs.existsSync(DEV_PROXY_REGISTRY)) return {};
    try {
        return JSON.parse(fs.readFileSync(DEV_PROXY_REGISTRY, 'utf8'));
    } catch (e) {
        return {};
    }
}

/**
 * Save the dev proxy server registry.
 * @param {Object} registry - Registry object
 */
function saveProxyRegistry(registry) {
    if (!fs.existsSync(DEV_PROXY_DIR)) {
        fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    }
    fs.writeFileSync(DEV_PROXY_REGISTRY, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Load the global port registry.
 * @returns {Object} Registry object { name: { basePort, path } }
 */
function loadPortRegistry() {
    if (!fs.existsSync(PORT_REGISTRY_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(PORT_REGISTRY_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

/**
 * Save the global port registry.
 * @param {Object} registry - Registry object
 */
function savePortRegistry(registry) {
    const dir = path.dirname(PORT_REGISTRY_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PORT_REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Register a project's base port in the global registry.
 * Warns if another project is already using the same port range.
 * @param {string} name - Project name
 * @param {number} basePort - Base port number
 * @param {string} repoPath - Absolute path to the repo
 * @returns {string[]} Names of conflicting projects (empty if none)
 */
function registerPort(name, basePort, repoPath) {
    const registry = loadPortRegistry();
    const conflicts = [];

    for (const [existingName, entry] of Object.entries(registry)) {
        if (existingName === name) continue;
        // Conflict if port ranges overlap (each project claims base + 0..4)
        if (Math.abs(entry.basePort - basePort) < 5) {
            conflicts.push(existingName);
        }
    }

    registry[name] = { basePort, path: repoPath };
    savePortRegistry(registry);

    if (conflicts.length > 0) {
        console.warn(`\n⚠️  Port conflict: ${name} (port ${basePort}) overlaps with: ${conflicts.join(', ')}`);
        console.warn(`   Run \`aigon doctor\` to see all port assignments.`);
    }

    return conflicts;
}

/**
 * Deregister a project from the global port registry.
 * @param {string} name - Project name to remove
 */
function deregisterPort(name) {
    const registry = loadPortRegistry();
    if (registry[name]) {
        delete registry[name];
        savePortRegistry(registry);
    }
}

/**
 * Scan filesystem for projects with port configurations.
 * Checks sibling directories for .aigon/config.json and .env.local/.env files.
 * @param {string} [scanDir] - Directory to scan (default: parent of cwd)
 * @returns {Array<{name: string, basePort: number, path: string, source: string}>}
 */
function scanPortsFromFilesystem(scanDir) {
    scanDir = scanDir || path.dirname(process.cwd());
    const results = [];

    let entries;
    try {
        entries = fs.readdirSync(scanDir, { withFileTypes: true });
    } catch (e) {
        return results;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(scanDir, entry.name);

        // Check .aigon/config.json for devProxy.basePort
        const aigonConfigPath = path.join(dirPath, '.aigon', 'config.json');
        if (fs.existsSync(aigonConfigPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(aigonConfigPath, 'utf8'));
                if (config.devProxy?.basePort) {
                    results.push({
                        name: entry.name,
                        basePort: config.devProxy.basePort,
                        path: dirPath,
                        source: '.aigon/config.json'
                    });
                    continue; // Config takes precedence, skip env files
                }
            } catch (e) { /* ignore parse errors */ }
        }

        // Check .env.local and .env for PORT=
        for (const envFile of ['.env.local', '.env']) {
            const envPath = path.join(dirPath, envFile);
            if (!fs.existsSync(envPath)) continue;
            try {
                const content = fs.readFileSync(envPath, 'utf8');
                const match = content.match(/^PORT=(\d+)/m);
                if (match) {
                    results.push({
                        name: entry.name,
                        basePort: parseInt(match[1], 10),
                        path: dirPath,
                        source: envFile
                    });
                    break; // .env.local takes precedence over .env
                }
            } catch (e) { /* ignore read errors */ }
        }
    }

    return results;
}

/**
 * Generate a Caddyfile from the registry.
 * @param {Object} registry - Registry object
 * @returns {string} Caddyfile content
 */
function generateCaddyfile(registry) {
    let caddyfile = '# Auto-generated by aigon — do not edit manually\n';
    caddyfile += '{\n    auto_https off\n}\n';

    for (const [appId, servers] of Object.entries(registry)) {
        if (Object.keys(servers).length === 0) continue;
        caddyfile += `\n# ${appId}\n`;
        for (const [serverId, info] of Object.entries(servers)) {
            const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
            caddyfile += `http://${hostname} {\n    reverse_proxy localhost:${info.port}\n}\n`;
        }
    }

    return caddyfile;
}

/**
 * Write Caddyfile and reload Caddy.
 * @param {Object} registry - Registry object to generate from
 * @returns {boolean} True if reload succeeded
 */
function reloadCaddy(registry) {
    if (!fs.existsSync(DEV_PROXY_DIR)) {
        fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    }
    const caddyfile = generateCaddyfile(registry);
    fs.writeFileSync(DEV_PROXY_CADDYFILE, caddyfile);

    try {
        // Try admin API reload first (works when Caddy is running)
        execSync(`caddy reload --config "${DEV_PROXY_CADDYFILE}"`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        // Fall back to brew services restart (sudo for port 80)
        try {
            execSync('sudo brew services restart caddy', { stdio: 'pipe' });
            return true;
        } catch (e2) {
            console.warn(`⚠️  Could not reload Caddy: ${e2.message}`);
            return false;
        }
    }
}

/**
 * Register a dev server with the proxy.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier (e.g., "cc-119" or "" for main)
 * @param {number} port - Port number
 * @param {string} worktreePath - Worktree or repo path
 * @param {number} pid - Process ID (0 if not started yet)
 */
function registerDevServer(appId, serverId, port, worktreePath, pid) {
    const registry = loadProxyRegistry();
    if (!registry[appId]) registry[appId] = {};
    registry[appId][serverId] = {
        port,
        worktree: worktreePath,
        pid: pid || 0,
        started: new Date().toISOString()
    };
    saveProxyRegistry(registry);
    reloadCaddy(registry);
}

/**
 * Deregister a dev server from the proxy.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 */
function deregisterDevServer(appId, serverId) {
    const registry = loadProxyRegistry();
    if (registry[appId]) {
        delete registry[appId][serverId];
        if (Object.keys(registry[appId]).length === 0) {
            delete registry[appId];
        }
    }
    saveProxyRegistry(registry);
    if (isProxyAvailable()) {
        reloadCaddy(registry);
    }
}

/**
 * Remove registry entries for dead processes.
 * @returns {number} Number of entries removed
 */
function gcDevServers() {
    const registry = loadProxyRegistry();
    let removed = 0;

    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            if (info.pid && info.pid > 0) {
                try {
                    // Signal 0 checks if process exists without killing it
                    process.kill(info.pid, 0);
                } catch (e) {
                    // Process doesn't exist
                    delete registry[appId][serverId];
                    removed++;
                }
            }
        }
        if (Object.keys(registry[appId]).length === 0) {
            delete registry[appId];
        }
    }

    if (removed > 0) {
        saveProxyRegistry(registry);
        if (isProxyAvailable()) {
            reloadCaddy(registry);
        }
    }

    return removed;
}

/**
 * Detect the dev server context from the current directory.
 * Returns appId, agentId, featureId based on worktree path or branch name.
 * @returns {{ appId: string, agentId: string|null, featureId: string|null, serverId: string }}
 */
function detectDevServerContext() {
    const appId = getAppId();
    let agentId = null;
    let featureId = null;

    // Try to detect from worktree path: .../feature-119-cc-description
    const dirname = path.basename(process.cwd());
    const wtMatch = dirname.match(/^feature-(\d+)-([a-z]{2})-/);
    if (wtMatch) {
        featureId = wtMatch[1];
        agentId = wtMatch[2];
    } else {
        // Try to detect from branch name: feature-119-description or feature-119-cc-description
        try {
            const branch = execSync('git branch --show-current', { stdio: 'pipe' }).toString().trim();
            const branchMatch = branch.match(/^feature-(\d+)(?:-([a-z]{2}))?-/);
            if (branchMatch) {
                featureId = branchMatch[1];
                agentId = branchMatch[2] || null;
            }
        } catch (e) { /* not in a git repo */ }
    }

    // If no agent detected, try from AIGON_AGENT_NAME env or default to 'dev'
    if (!agentId) {
        const envAgent = process.env.AIGON_AGENT_ID;
        agentId = envAgent || null;
    }

    const serverId = agentId && featureId ? `${agentId}-${featureId}` : '';

    return { appId, agentId, featureId, serverId };
}

/**
 * Get the dev proxy URL for a given context.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 * @returns {string} URL (e.g., "http://cc-119.farline.test")
 */
function getDevProxyUrl(appId, serverId) {
    if (serverId) {
        return `http://${serverId}.${appId}.test`;
    }
    return `http://${appId}.test`;
}

/**
 * Get the log file path for a dev server.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 * @returns {string} Log file path
 */
function getDevServerLogPath(appId, serverId) {
    const label = serverId ? `${appId}-${serverId}` : appId;
    return path.join(DEV_PROXY_LOGS_DIR, `${label}.log`);
}

/**
 * Spawn a dev server process in the background.
 * @param {string} command - Command to run (e.g., "npm run dev")
 * @param {number} port - Port number to pass as PORT env var
 * @param {string} logPath - Path to write stdout/stderr
 * @param {string} cwd - Working directory
 * @returns {number} PID of the spawned process
 */
function spawnDevServer(command, port, logPath, cwd) {
    const { spawn } = require('child_process');

    // Ensure log directory exists
    if (!fs.existsSync(DEV_PROXY_LOGS_DIR)) {
        fs.mkdirSync(DEV_PROXY_LOGS_DIR, { recursive: true });
    }

    // Open log file for writing
    const logFd = fs.openSync(logPath, 'w');

    // Parse command into parts
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    // Spawn detached process with PORT in env
    const child = spawn(cmd, cmdArgs, {
        cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PORT: String(port) },
        shell: true
    });

    child.unref();
    fs.closeSync(logFd);

    return child.pid;
}

/**
 * Wait for a dev server to become healthy by polling a URL.
 * @param {string} url - URL to poll (e.g., "http://localhost:3847/")
 * @param {number} timeoutMs - Maximum time to wait in ms
 * @param {number} intervalMs - Polling interval in ms
 * @returns {Promise<boolean>} True if healthy, false if timed out
 */
async function waitForHealthy(url, timeoutMs = 30000, intervalMs = 500) {
    const http = require('http');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        try {
            const ok = await new Promise((resolve) => {
                const req = http.get(url, { timeout: 2000 }, (res) => {
                    // Any response means the server is up (even 404)
                    res.resume();
                    resolve(true);
                });
                req.on('error', () => resolve(false));
                req.on('timeout', () => { req.destroy(); resolve(false); });
            });
            if (ok) return true;
        } catch (e) {
            // ignore
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }

    return false;
}

/**
 * Open a URL in the default browser (cross-platform).
 * @param {string} url - URL to open
 */
function openInBrowser(url) {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} ${JSON.stringify(url)}`, { stdio: 'ignore' });
}

function readConductorReposFromGlobalConfig() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
        const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return Array.isArray(cfg.repos) ? cfg.repos : [];
    } catch (e) {
        return [];
    }
}

function parseSimpleFrontMatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return {};
    const result = {};
    m[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        result[key] = value;
    });
    return result;
}

function normalizeDashboardStatus(raw) {
    const status = String(raw || '').trim().toLowerCase();
    if (status === 'implementing' || status === 'waiting' || status === 'submitted' || status === 'error') {
        return status;
    }
    return 'implementing';
}

function parseFeatureSpecFileName(file) {
    const m = file.match(/^feature-(\d+)-(.+)\.md$/);
    if (!m) return null;
    return { id: m[1], name: m[2] };
}

function inferDashboardNextCommand(featureId, agents, stage) {
    const idPadded = String(featureId).padStart(2, '0');
    if (!agents || agents.length === 0) return null;

    // Feature already in evaluation — continue eval
    if (stage === 'in-evaluation') {
        return { command: `/afe ${idPadded}`, reason: 'Evaluation in progress' };
    }

    const allSubmitted = agents.every(agent => agent.status === 'submitted');
    const hasWaiting = agents.some(agent => agent.status === 'waiting');
    const isFleet = agents.some(agent => agent.id !== 'solo');

    if (hasWaiting) {
        return { command: `/afd ${idPadded}`, reason: 'Agent waiting for completion/merge' };
    }
    if (allSubmitted && isFleet) {
        return { command: `/afe ${idPadded}`, reason: 'All agents submitted; evaluate winners' };
    }
    if (allSubmitted) {
        return { command: `/afd ${idPadded}`, reason: 'Implementation submitted; complete feature' };
    }
    return null;
}

function safeTmuxSessionExists(featureId, agentId) {
    if (!agentId || agentId === 'solo') return null;
    try {
        assertTmuxAvailable();
        // Try exact match first (includes repo and desc when available)
        const sessionName = buildTmuxSessionName(featureId, agentId);
        if (tmuxSessionExists(sessionName)) {
            return { sessionName, running: true };
        }
        // Fall back to pattern search across all sessions (handles old-style names
        // or sessions created from a different cwd)
        const listResult = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (!listResult.error && listResult.status === 0) {
            const match = listResult.stdout.split('\n').find(s =>
                matchTmuxSessionByEntityId(s.trim(), featureId)?.agent === agentId
            );
            if (match) return { sessionName: match.trim(), running: true };
        }
        return { sessionName, running: false };
    } catch (e) {
        return { sessionName: buildTmuxSessionName(featureId, agentId), running: false };
    }
}

function collectDashboardStatusData() {
    const repos = readConductorReposFromGlobalConfig();
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, submitted: 0, error: 0, total: 0 }
    };

    repos.forEach(repoPath => {
        const absRepoPath = path.resolve(repoPath);
        const inProgressDir = path.join(absRepoPath, 'docs', 'specs', 'features', '03-in-progress');
        const inEvalDir = path.join(absRepoPath, 'docs', 'specs', 'features', '04-in-evaluation');
        const evalsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'evaluations');
        const mainLogsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'logs');
        const worktreeBaseDir = absRepoPath + '-worktrees';

        const specFiles = []; // { file, stage: 'in-progress' | 'in-evaluation' }
        const stageDirs = [
            { dir: inProgressDir, stage: 'in-progress' },
            { dir: inEvalDir, stage: 'in-evaluation' }
        ];
        stageDirs.forEach(({ dir, stage }) => {
            if (fs.existsSync(dir)) {
                try {
                    fs.readdirSync(dir)
                        .filter(f => /^feature-\d+-.+\.md$/.test(f))
                        .sort((a, b) => a.localeCompare(b))
                        .forEach(f => specFiles.push({ file: f, stage }));
                } catch (e) { /* ignore */ }
            }
        });

        const allLogDirs = [];
        if (fs.existsSync(mainLogsDir)) allLogDirs.push(mainLogsDir);
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                    if (fs.existsSync(wtLogsDir)) allLogDirs.push(wtLogsDir);
                });
            } catch (e) { /* ignore */ }
        }

        const logsByFeatureAgent = {}; // key: "id:agent" => { status, updatedAt }
        const logsByFeatureSolo = {}; // key: "id" => { status, updatedAt }
        const knownAgentsByFeature = {}; // id => Set(agent)

        allLogDirs.forEach(logDir => {
            try {
                fs.readdirSync(logDir)
                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                    .forEach(logFile => {
                        const logPath = path.join(logDir, logFile);
                        let content = '';
                        try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { return; }
                        const fm = parseSimpleFrontMatter(content);
                        const status = normalizeDashboardStatus(fm.status);
                        const updatedAt = fm.updated || new Date(fs.statSync(logPath).mtime).toISOString();

                        const arena = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                        const solo = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                        if (arena) {
                            const featureId = arena[1];
                            const agent = arena[2];
                            logsByFeatureAgent[`${featureId}:${agent}`] = { status, updatedAt };
                            if (!knownAgentsByFeature[featureId]) knownAgentsByFeature[featureId] = new Set();
                            knownAgentsByFeature[featureId].add(agent);
                        } else if (solo) {
                            logsByFeatureSolo[solo[1]] = { status, updatedAt };
                        }
                    });
            } catch (e) { /* ignore */ }
        });

        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                    if (!wtM) return;
                    const featureId = wtM[1];
                    const agent = wtM[2];
                    if (!knownAgentsByFeature[featureId]) knownAgentsByFeature[featureId] = new Set();
                    knownAgentsByFeature[featureId].add(agent);
                });
            } catch (e) { /* ignore */ }
        }

        const features = [];
        specFiles.forEach(({ file: specFile, stage }) => {
            const parsed = parseFeatureSpecFileName(specFile);
            if (!parsed) return;

            const specDir = stage === 'in-evaluation' ? inEvalDir : inProgressDir;
            const specPath = path.join(specDir, specFile);
            let fallbackUpdatedAt = new Date().toISOString();
            try {
                fallbackUpdatedAt = new Date(fs.statSync(specPath).mtime).toISOString();
            } catch (e) { /* ignore */ }

            const agentSet = knownAgentsByFeature[parsed.id] || new Set();
            const hasFleetAgents = agentSet.size > 0;
            const agents = [];
            const idPadded = String(parsed.id).padStart(2, '0');

            if (hasFleetAgents) {
                [...agentSet].sort((a, b) => a.localeCompare(b)).forEach(agent => {
                    const row = logsByFeatureAgent[`${parsed.id}:${agent}`] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
                    const tmux = safeTmuxSessionExists(parsed.id, agent);
                    agents.push({
                        id: agent,
                        status: normalizeDashboardStatus(row.status),
                        updatedAt: row.updatedAt,
                        slashCommand: row.status === 'waiting' ? `/afd ${idPadded}` : null,
                        tmuxSession: tmux ? tmux.sessionName : null,
                        tmuxRunning: tmux ? tmux.running : false,
                        attachCommand: tmux ? `tmux attach -t ${tmux.sessionName}` : null
                    });
                });
            } else {
                const row = logsByFeatureSolo[parsed.id] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
                agents.push({
                    id: 'solo',
                    status: normalizeDashboardStatus(row.status),
                    updatedAt: row.updatedAt,
                    slashCommand: row.status === 'waiting' ? `/afd ${idPadded}` : null,
                    tmuxSession: null,
                    tmuxRunning: false,
                    attachCommand: null
                });
            }

            agents.forEach(agent => {
                response.summary.total++;
                response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
            });

            // Compute eval status for features in evaluation
            let evalStatus = null;
            if (stage === 'in-evaluation') {
                evalStatus = 'evaluating';
                const evalFile = path.join(evalsDir, `feature-${parsed.id}-eval.md`);
                if (fs.existsSync(evalFile)) {
                    try {
                        const content = fs.readFileSync(evalFile, 'utf8');
                        const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                        if (winnerMatch) {
                            const val = winnerMatch[1].replace(/\*+/g, '').trim();
                            if (val && !val.includes('to be determined') && !val.includes('TBD') && val !== '()') {
                                evalStatus = 'pick winner';
                            }
                        }
                    } catch (e) { /* skip */ }
                }
            }

            features.push({
                id: parsed.id,
                name: parsed.name,
                stage,
                evalStatus,
                agents,
                nextAction: inferDashboardNextCommand(parsed.id, agents, stage)
            });
        });

        // --- Research sessions ---
        const researchInProgressDir = path.join(absRepoPath, 'docs', 'specs', 'research-topics', '03-in-progress');
        const researchLogsDir = path.join(absRepoPath, 'docs', 'specs', 'research-topics', 'logs');
        const research = [];

        if (fs.existsSync(researchInProgressDir)) {
            const researchSpecs = {};
            try {
                fs.readdirSync(researchInProgressDir)
                    .filter(f => /^research-(\d+)-.+\.md$/.test(f))
                    .forEach(f => {
                        const rm = f.match(/^research-(\d+)-(.+)\.md$/);
                        if (rm) researchSpecs[rm[1]] = rm[2];
                    });
            } catch (e) { /* ignore */ }

            if (fs.existsSync(researchLogsDir) && Object.keys(researchSpecs).length > 0) {
                try {
                    fs.readdirSync(researchLogsDir)
                        .filter(f => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(f))
                        .forEach(f => {
                            const rm = f.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
                            if (!rm || !researchSpecs[rm[1]]) return;
                            const rid = rm[1];
                            const agent = rm[2];

                            let status = 'implementing';
                            let updatedAt = new Date().toISOString();
                            try {
                                const content = fs.readFileSync(path.join(researchLogsDir, f), 'utf8');
                                const fm = parseSimpleFrontMatter(content);
                                status = normalizeDashboardStatus(fm.status) || 'implementing';
                                updatedAt = fm.updated || updatedAt;
                            } catch (e) { /* ignore */ }

                            // Find or create research entry
                            let entry = research.find(r => r.id === rid);
                            if (!entry) {
                                entry = { id: rid, name: researchSpecs[rid], agents: [] };
                                research.push(entry);
                            }

                            const sessionName = buildResearchTmuxSessionName(rid, agent, { repo: path.basename(absRepoPath) });
                            const tmuxRunning = tmuxSessionExists(sessionName);

                            entry.agents.push({
                                id: agent,
                                status,
                                updatedAt,
                                tmuxSession: tmuxRunning ? sessionName : null,
                                tmuxRunning,
                                attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null
                            });

                            response.summary.total++;
                            response.summary[status] = (response.summary[status] || 0) + 1;
                        });
                } catch (e) { /* ignore */ }
            }
        }

        response.repos.push({
            path: absRepoPath,
            displayPath: absRepoPath.replace(os.homedir(), '~'),
            name: path.basename(absRepoPath),
            features,
            research
        });
    });

    return response;
}

function escapeForHtmlScript(jsonValue) {
    return JSON.stringify(jsonValue)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function buildDashboardHtml(initialData) {
    const serializedData = escapeForHtmlScript(initialData);
    const htmlTemplate = readTemplate('dashboard/index.html');
    return htmlTemplate.replace('${INITIAL_DATA}', () => serializedData);
}

function escapeAppleScriptString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function captureDashboardScreenshot(url, outputPath, width, height) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    let puppeteer = null;
    try {
        puppeteer = require('puppeteer');
    } catch (e) {
        try { puppeteer = require('puppeteer-core'); } catch (_) { /* ignore */ }
    }

    if (puppeteer) {
        const browser = await puppeteer.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setViewport({ width, height });
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
            await page.screenshot({ path: outputPath, fullPage: true });
            return { method: 'puppeteer' };
        } finally {
            await browser.close();
        }
    }

    if (process.platform !== 'darwin') {
        throw new Error('Screenshot fallback requires macOS when Puppeteer is unavailable');
    }

    const escapedUrl = escapeAppleScriptString(url);
    const scriptLines = [
        'tell application "Safari" to activate',
        `tell application "Safari" to open location "${escapedUrl}"`,
        'delay 2.6',
        'tell application "System Events"',
        'tell process "Safari"',
        'set frontmost to true',
        'set position of front window to {0, 0}',
        `set size of front window to {${width}, ${height}}`,
        'end tell',
        'end tell',
        'delay 1.4'
    ];
    const args = [];
    scriptLines.forEach(line => args.push('-e', line));
    const scriptRun = spawnSync('osascript', args, { stdio: 'ignore' });
    if (scriptRun.status !== 0) {
        throw new Error('AppleScript fallback failed to control Safari window');
    }

    const shot = spawnSync('screencapture', ['-x', '-R', `0,0,${width},${height}`, outputPath], { stdio: 'ignore' });
    if (shot.status !== 0) {
        throw new Error('screencapture failed');
    }
    return { method: 'applescript' };
}

function writeRepoRegistry(repos) {
    let cfg = {};
    try {
        if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
            cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        }
    } catch (e) { /* start fresh */ }
    cfg.repos = repos;
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function readRadarMeta() {
    try {
        if (!fs.existsSync(RADAR_META_FILE)) return null;
        return JSON.parse(fs.readFileSync(RADAR_META_FILE, 'utf8'));
    } catch (e) {
        return null;
    }
}

function writeRadarMeta(meta) {
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(RADAR_META_FILE, JSON.stringify(meta, null, 2) + '\n');
}

function removeRadarMeta() {
    if (fs.existsSync(RADAR_META_FILE)) {
        fs.unlinkSync(RADAR_META_FILE);
    }
}

function isRadarAlive() {
    if (!fs.existsSync(RADAR_PID_FILE)) return false;
    try {
        const pid = parseInt(fs.readFileSync(RADAR_PID_FILE, 'utf8').trim(), 10);
        process.kill(pid, 0);
        return pid;
    } catch (e) {
        return false;
    }
}

function sendMacNotification(message, title = 'Aigon Radar') {
    try {
        execSync(`osascript -e 'display notification "${message}" with title "${title}"'`);
    } catch (e) {
        // Notification failures are non-fatal.
    }
}

function requestRadarJson(pathname, port) {
    return new Promise((resolve, reject) => {
        const http = require('http');
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: pathname,
            method: 'GET',
            timeout: 2500,
            headers: { 'accept': 'application/json' }
        }, (res) => {
            let raw = '';
            res.on('data', c => { raw += c.toString('utf8'); });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        req.end();
    });
}

function renderRadarMenubarFromStatus(payload, port) {
    const data = payload || {};
    const repos = Array.isArray(data.repos) ? data.repos : [];
    const nodeExec = process.execPath;
    const aigonScript = CLI_ENTRY_PATH;

    if (repos.length === 0) {
        console.log('⚙ –');
        console.log('---');
        console.log('No repos registered');
        console.log('Run: aigon radar add | href=https://github.com/jviner/aigon');
        return;
    }

    let waitingCount = 0;
    let implementingCount = 0;
    const attentionItems = [];
    const sections = [];

    repos.forEach(repo => {
        const repoPath = repo.path || '';
        const repoShort = repo.displayPath || repoPath;
        const lines = [];
        lines.push(`${repoShort} | size=14`);

        (repo.features || [])
            .sort((a, b) => Number(a.id) - Number(b.id))
            .forEach(feature => {
                lines.push(`#${feature.id} ${feature.name} | size=13`);
                const agents = feature.agents || [];

                agents.forEach(agent => {
                    const icon = agent.status === 'waiting' ? '●' : agent.status === 'submitted' ? '✓' : '○';
                    const paddedId = String(feature.id).padStart(2, '0');
                    const slashCmd = `/afd ${paddedId}`;

                    // Click: focus terminal. Alt-click: copy slash command.
                    const focusParams = agent.id === 'solo'
                        ? `param1="${aigonScript}" param2=terminal-focus param3=${feature.id} param4=--repo param5="${repoPath}"`
                        : `param1="${aigonScript}" param2=terminal-focus param3=${feature.id} param4=${agent.id} param5=--repo param6="${repoPath}"`;
                    lines.push(`-- ${icon} ${agent.id}: ${agent.status} | bash="${nodeExec}" ${focusParams} terminal=false`);
                    lines.push(`-- ${icon} ${agent.id}: ${agent.status} — copy cmd | alternate=true bash=/bin/bash param1=-c param2="echo '${slashCmd}' | pbcopy" terminal=false`);

                    if (agent.status === 'waiting') waitingCount++;
                    if (agent.status === 'implementing') implementingCount++;
                });

                // Detect attention-worthy states
                const hasWaiting = agents.some(a => a.status === 'waiting');
                const allSubmitted = agents.length > 0 && agents.every(a => a.status === 'submitted');
                const paddedFid = String(feature.id).padStart(2, '0');

                if (feature.stage === 'in-evaluation') {
                    const evalReason = feature.evalStatus === 'pick winner' ? 'Pick winner' : 'Evaluating';
                    attentionItems.push({ repoPath, fid: feature.id, name: feature.name, reason: evalReason, action: `/afe ${paddedFid}` });
                } else if (allSubmitted) {
                    attentionItems.push({ repoPath, fid: feature.id, name: feature.name, reason: 'All agents submitted', action: `/afe ${paddedFid}` });
                } else if (hasWaiting) {
                    const waitingAgents = agents.filter(a => a.status === 'waiting').map(a => a.id).join(', ');
                    attentionItems.push({ repoPath, fid: feature.id, name: feature.name, reason: `${waitingAgents} waiting`, action: null });
                }
            });

        // --- Research sessions ---
        (repo.research || [])
            .sort((a, b) => Number(a.id) - Number(b.id))
            .forEach(item => {
                if (!item.agents || item.agents.length === 0) return;
                lines.push(`R#${item.id} ${item.name} | size=13`);

                item.agents.forEach(agent => {
                    const icon = agent.status === 'submitted' ? '✓' : '○';
                    const paddedId = String(item.id).padStart(2, '0');
                    const slashCmd = `/ard ${paddedId}`;

                    const focusParams = `param1="${aigonScript}" param2=terminal-focus param3=${item.id} param4=${agent.id} param5=--research param6=--repo param7="${repoPath}"`;
                    lines.push(`-- ${icon} ${agent.id}: ${agent.status} | bash="${nodeExec}" ${focusParams} terminal=false`);
                    lines.push(`-- ${icon} ${agent.id}: ${agent.status} — copy cmd | alternate=true bash=/bin/bash param1=-c param2="echo '${slashCmd}' | pbcopy" terminal=false`);

                    if (agent.status === 'implementing') implementingCount++;
                });

                // Attention: all agents submitted → synthesize
                const allSubmitted = item.agents.length > 0 && item.agents.every(a => a.status === 'submitted');
                if (allSubmitted) {
                    const paddedId = String(item.id).padStart(2, '0');
                    attentionItems.push({ repoPath, fid: item.id, name: item.name, reason: 'All agents submitted', action: `/ars ${paddedId}`, prefix: 'R' });
                }
            });

        if (lines.length > 1) sections.push(lines);
    });

    // Title line
    if (attentionItems.length > 0) {
        console.log(`⚙ ${attentionItems.length} need${attentionItems.length === 1 ? 's' : ''} attention`);
    } else if (waitingCount > 0) {
        console.log(`⚙ ${waitingCount} waiting`);
    } else if (implementingCount > 0) {
        console.log(`⚙ ${implementingCount} running`);
    } else {
        console.log('⚙ –');
    }
    console.log('---');

    // Needs Attention section (pinned to top)
    if (attentionItems.length > 0) {
        console.log('⚠ Needs Attention | size=14');
        attentionItems.forEach(item => {
            const prefix = item.prefix || '#';
            const label = `${prefix}${item.fid} ${item.name}: ${item.reason}`;
            if (item.action) {
                console.log(`-- ${label} | bash=/bin/bash param1=-c param2="echo '${item.action}' | pbcopy" terminal=false`);
                console.log(`-- ${label} — copy: ${item.action} | alternate=true bash=/bin/bash param1=-c param2="echo '${item.action}' | pbcopy" terminal=false`);
            } else {
                console.log(`-- ${label} | bash="${nodeExec}" param1="${aigonScript}" param2=terminal-focus param3=${item.fid} param4=--repo param5="${item.repoPath}" terminal=false`);
            }
        });
        console.log('---');
    }

    // Repo sections
    if (sections.length === 0) {
        console.log('No active features or research');
    } else {
        sections.forEach((lines, i) => {
            if (i > 0) console.log('---');
            lines.forEach(l => console.log(l));
        });
    }

    console.log('---');
    console.log(`Open Dashboard | href=http://127.0.0.1:${port || 4321}`);
    console.log('Refresh | refresh=true');
}

function writeRadarLaunchdPlist(port) {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.aigon.radar.plist');
    const logPath = RADAR_LOG_FILE;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.aigon.radar</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${CLI_ENTRY_PATH}</string>
    <string>radar</string>
    <string>--daemon</string>
    <string>--port=${port}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(plistPath, plist);
    return plistPath;
}

function runRadarServiceDaemon(port) {
    const http = require('http');
    const host = '127.0.0.1';
    let latestStatus = collectDashboardStatusData();
    const lastStatusByAgent = {};
    const allSubmittedNotified = new Set();

    function log(msg) {
        try {
            fs.appendFileSync(RADAR_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
        } catch (e) { /* ignore */ }
    }

    function pollStatus() {
        latestStatus = collectDashboardStatusData();
        (latestStatus.repos || []).forEach(repo => {
            (repo.features || []).forEach(feature => {
                (feature.agents || []).forEach(agent => {
                    const key = `${repo.path}:${feature.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        sendMacNotification(`${agent.id} is waiting on #${feature.id} ${feature.name}`, `Aigon · ${repo.name || path.basename(repo.path)}`);
                    }
                    lastStatusByAgent[key] = agent.status;
                });

                const allSubmitted = (feature.agents || []).length > 0 && (feature.agents || []).every(agent => agent.status === 'submitted');
                const featureKey = `${repo.path}:${feature.id}`;
                if (allSubmitted && !allSubmittedNotified.has(featureKey)) {
                    allSubmittedNotified.add(featureKey);
                    sendMacNotification(`All agents submitted #${feature.id} ${feature.name} — ready for eval`, `Aigon · ${repo.name || path.basename(repo.path)}`);
                }
                if (!allSubmitted) allSubmittedNotified.delete(featureKey);
            });
        });
        log(`Poll complete (${(latestStatus.repos || []).length} repo${(latestStatus.repos || []).length === 1 ? '' : 's'})`);
    }

    const server = http.createServer((req, res) => {
        const reqPath = (req.url || '/').split('?')[0];

        if (reqPath === '/api/attach' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const featureId = String(payload.featureId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = String(payload.repoPath || '').trim();
                if (!featureId || !agentId || agentId === 'solo') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                    return;
                }

                const tmuxInfo = safeTmuxSessionExists(featureId, agentId);
                if (!tmuxInfo || !tmuxInfo.running) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `tmux session not running for F${featureId} ${agentId}` }));
                    return;
                }
                const sessionName = tmuxInfo.sessionName;

                try {
                    openTerminalAppWithCommand(repoPath || process.cwd(), `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, message: `Attached to ${sessionName}`, command: `tmux attach -t ${sessionName}` }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open terminal: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/status') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(latestStatus));
            return;
        }

        if (reqPath === '/api/repos') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ repos: readConductorReposFromGlobalConfig() }));
            return;
        }

        if (reqPath === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }

        const html = buildDashboardHtml(latestStatus);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
    });

    const shutdown = () => {
        log(`Radar shutting down (PID ${process.pid})`);
        server.close(() => process.exit(0));
        if (fs.existsSync(RADAR_PID_FILE)) fs.unlinkSync(RADAR_PID_FILE);
        removeRadarMeta();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    server.listen(port, host, () => {
        if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
        fs.writeFileSync(RADAR_PID_FILE, String(process.pid));
        writeRadarMeta({ pid: process.pid, port, startedAt: new Date().toISOString() });
        log(`Radar service started (PID ${process.pid}, port ${port})`);
        pollStatus();
        setInterval(pollStatus, 30000);
    });
}

/**
 * Auto-detect project profile from project files
 * @returns {string} Profile name (web, api, ios, android, library, generic)
 */
function detectProjectProfile() {
    const cwd = process.cwd();

    // iOS: Xcode project, workspace, or Swift Package Manager (root or ios/ subdir)
    const entries = fs.readdirSync(cwd);
    const hasIosFiles = (dir) => {
        try {
            return fs.readdirSync(dir).some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'));
        } catch (e) { return false; }
    };
    if (hasIosFiles(cwd) || hasIosFiles(path.join(cwd, 'ios')) ||
        fs.existsSync(path.join(cwd, 'Package.swift'))) {
        return 'ios';
    }

    // Android: Gradle build file (root or android/ subdir)
    if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts')) ||
        fs.existsSync(path.join(cwd, 'android', 'build.gradle')) || fs.existsSync(path.join(cwd, 'android', 'build.gradle.kts'))) {
        return 'android';
    }

    // Web: package.json with dev script + framework config
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.scripts && pkg.scripts.dev) {
                // Check for web framework indicators
                if (entries.some(f => f.startsWith('next.config')) ||
                    entries.some(f => f.startsWith('vite.config')) ||
                    entries.some(f => f.startsWith('nuxt.config')) ||
                    entries.some(f => f.startsWith('svelte.config')) ||
                    entries.some(f => f.startsWith('astro.config')) ||
                    entries.some(f => f.startsWith('remix.config')) ||
                    entries.some(f => f.startsWith('angular.json'))) {
                    return 'web';
                }
            }
        } catch (e) { /* ignore parse errors */ }
    }

    // API: server entry points
    if (fs.existsSync(path.join(cwd, 'manage.py')) ||
        fs.existsSync(path.join(cwd, 'app.py')) ||
        fs.existsSync(path.join(cwd, 'main.go')) ||
        fs.existsSync(path.join(cwd, 'server.js')) ||
        fs.existsSync(path.join(cwd, 'server.ts'))) {
        return 'api';
    }

    // Library: build system config without dev server indicators
    if (fs.existsSync(path.join(cwd, 'Cargo.toml')) ||
        fs.existsSync(path.join(cwd, 'go.mod')) ||
        fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
        fs.existsSync(path.join(cwd, 'setup.py'))) {
        return 'library';
    }

    // Library: package.json without dev script (npm library)
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (!pkg.scripts || !pkg.scripts.dev) {
                return 'library';
            }
            // Has dev script but no framework config — still treat as web
            return 'web';
        } catch (e) { /* ignore */ }
    }

    return 'generic';
}

/**
 * Get the active profile: explicit config > auto-detect
 * Merges user overrides on top of preset defaults
 * @returns {Object} Resolved profile with devServer, testInstructions, depCheck, setupEnvLine, and metadata
 */
function getActiveProfile() {
    const projectConfig = loadProjectConfig();
    const profileName = projectConfig.profile || detectProjectProfile();
    const preset = PROFILE_PRESETS[profileName] || PROFILE_PRESETS.generic;

    // Start with preset defaults
    const profile = {
        name: profileName,
        detected: !projectConfig.profile,
        devServer: { ...preset.devServer, ports: { ...preset.devServer.ports } },
        testInstructions: preset.testInstructions,
        manualTestingGuidance: preset.manualTestingGuidance || '',
        depCheck: preset.depCheck,
        setupEnvLine: preset.setupEnvLine
    };

    // Apply user overrides from .aigon/config.json (fleet is the new name; arena is legacy alias)
    const fleetConfig = projectConfig.fleet || projectConfig.arena;
    if (fleetConfig) {
        if (fleetConfig.testInstructions) {
            profile.testInstructions = fleetConfig.testInstructions;
        }
    }

    // Derive fleet ports from .env/.env.local PORT (overrides profile defaults)
    if (profile.devServer.enabled) {
        const result = readBasePort();
        if (result) {
            const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
            for (const [agentId, offset] of Object.entries(agentOffsets)) {
                profile.devServer.ports[agentId] = result.port + offset;
            }
        }
    }

    return profile;
}

/**
 * Get template placeholders derived from the active profile
 * @returns {Object} Placeholder key-value pairs for template processing
 */
function getProfilePlaceholders() {
    const profile = getActiveProfile();

    return {
        WORKTREE_TEST_INSTRUCTIONS: profile.testInstructions,
        WORKTREE_DEP_CHECK: profile.depCheck,
        SETUP_ENV_LOCAL_LINE: profile.setupEnvLine,
        MANUAL_TESTING_GUIDANCE: profile.manualTestingGuidance || '',
        STOP_DEV_SERVER_STEP: profile.devServer.enabled
            ? '## Step 2: Stop the dev server\n\nIf a dev server is running in this session, stop it now:\n```bash\naigon dev-server stop 2>/dev/null || true\n```'
            : ''
    };
}

/**
 * Get the CLI command for an agent, with user override support
 * Priority: project config > global config > agent template defaults
 * @param {string} agentId - Agent ID (cc, cu, gg, cx)
 * @returns {Object} CLI config with command, implementFlag, implementPrompt
 */
function getAgentCliConfig(agentId) {
    const agentConfig = loadAgentConfig(agentId);
    const globalConfig = loadGlobalConfig();
    const projectConfig = loadProjectConfig();

    // Start with defaults from agent config
    const cli = agentConfig?.cli || { command: agentId, implementFlag: '', implementPrompt: '' };
    cli.models = { ...(agentConfig?.cli?.models || {}) };

    // Override from global config (user-wide defaults)
    if (globalConfig.agents?.[agentId]) {
        if (globalConfig.agents[agentId].cli) {
            cli.command = globalConfig.agents[agentId].cli;
        }
        if (globalConfig.agents[agentId].implementFlag !== undefined) {
            cli.implementFlag = globalConfig.agents[agentId].implementFlag;
        }
        if (globalConfig.agents[agentId].implementPrompt) {
            cli.implementPrompt = globalConfig.agents[agentId].implementPrompt;
        }
        if (globalConfig.agents[agentId].evalPrompt) {
            cli.evalPrompt = globalConfig.agents[agentId].evalPrompt;
        }
        if (globalConfig.agents[agentId].models) {
            cli.models = { ...cli.models, ...globalConfig.agents[agentId].models };
        }
    }

    // Override from project config (highest priority - project-specific, overrides global)
    if (projectConfig.agents?.[agentId]) {
        if (projectConfig.agents[agentId].cli) {
            cli.command = projectConfig.agents[agentId].cli;
        }
        if (projectConfig.agents[agentId].implementFlag !== undefined) {
            cli.implementFlag = projectConfig.agents[agentId].implementFlag;
        }
        if (projectConfig.agents[agentId].implementPrompt) {
            cli.implementPrompt = projectConfig.agents[agentId].implementPrompt;
        }
        if (projectConfig.agents[agentId].evalPrompt) {
            cli.evalPrompt = projectConfig.agents[agentId].evalPrompt;
        }
        if (projectConfig.agents[agentId].models) {
            cli.models = { ...cli.models, ...projectConfig.agents[agentId].models };
        }
    }

    // Override from env vars (highest priority)
    for (const taskType of ['research', 'implement', 'evaluate']) {
        const envKey = `AIGON_${agentId.toUpperCase()}_${taskType.toUpperCase()}_MODEL`;
        if (process.env[envKey]) {
            cli.models[taskType] = process.env[envKey];
        }
    }

    return cli;
}

function parseCliFlagTokens(flagValue) {
    if (!flagValue) return [];
    return String(flagValue).trim().split(/\s+/).filter(Boolean);
}

function getAgentLaunchFlagTokens(command, flagValue, options = {}) {
    const { autonomous = false } = options;
    let tokens = parseCliFlagTokens(flagValue);

    // Keep Codex interactive by default, even if older configs still set --full-auto.
    if (command === 'codex' && !autonomous) {
        tokens = tokens.filter(t => t !== '--full-auto');
    }

    // In Autopilot/Swarm loops Codex must run hands-off.
    if (command === 'codex' && autonomous && !tokens.includes('--full-auto')) {
        tokens.unshift('--full-auto');
    }

    return tokens;
}

/**
 * Determine where a model config value comes from (provenance).
 * Checks in priority order: env var > project config > global config > template default.
 * @returns {{ value: string|undefined, source: 'env'|'project'|'global'|'template'|'none' }}
 */
function getModelProvenance(agentId, taskType) {
    // 1. Env var (highest priority)
    const envKey = `AIGON_${agentId.toUpperCase()}_${taskType.toUpperCase()}_MODEL`;
    if (process.env[envKey]) {
        return { value: process.env[envKey], source: 'env' };
    }

    // 2. Project config
    const projectConfig = loadProjectConfig();
    if (projectConfig.agents?.[agentId]?.models?.[taskType]) {
        return { value: projectConfig.agents[agentId].models[taskType], source: 'project' };
    }

    // 3. Global config
    const globalConfig = loadGlobalConfig();
    if (globalConfig.agents?.[agentId]?.models?.[taskType]) {
        return { value: globalConfig.agents[agentId].models[taskType], source: 'global' };
    }

    // 4. Template default
    const agentConfig = loadAgentConfig(agentId);
    if (agentConfig?.cli?.models?.[taskType]) {
        return { value: agentConfig.cli.models[taskType], source: 'template' };
    }

    return { value: undefined, source: 'none' };
}

// --- Worktree Helpers ---

function getWorktreeBase() {
    const repoName = path.basename(process.cwd());
    return `../${repoName}-worktrees`;
}

/**
 * Find all feature worktrees by parsing `git worktree list` output.
 * @returns {Array<{path: string, featureId: string, agent: string, desc: string, mtime: Date}>}
 */
function findWorktrees() {
    const worktrees = [];
    const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
    wtOutput.split('\n').forEach(line => {
        const wtMatch = line.match(/^([^\s]+)\s+/);
        if (!wtMatch) return;
        const wtPath = wtMatch[1];
        if (wtPath === process.cwd()) return; // Skip main worktree

        const featureMatch = path.basename(wtPath).match(/^feature-(\d+)-(\w+)-(.+)$/);
        if (featureMatch) {
            worktrees.push({
                path: wtPath,
                featureId: featureMatch[1],
                agent: featureMatch[2],
                desc: featureMatch[3],
                mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
            });
        }
    });
    return worktrees;
}

/**
 * Filter worktrees by feature ID, handling padded/unpadded comparison.
 */
function filterByFeatureId(worktrees, featureId) {
    const paddedId = String(featureId).padStart(2, '0');
    const unpaddedId = String(parseInt(featureId, 10));
    return worktrees.filter(wt =>
        wt.featureId === paddedId || wt.featureId === unpaddedId
    );
}

/**
 * Build the agent CLI command string for a worktree.
 */
function buildAgentCommand(wt, taskType = 'implement') {
    const cliConfig = getAgentCliConfig(wt.agent);
    const prompt = cliConfig.implementPrompt.replaceAll('{featureId}', wt.featureId);
    // Unset CLAUDECODE to prevent "nested session" error when launched from a Claude Code terminal
    const prefix = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';

    const model = cliConfig.models?.[taskType];
    const modelFlag = model ? `--model ${model}` : '';

    const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const flags = [...flagTokens, modelFlag].filter(Boolean).join(' ');
    if (flags) {
        return `${prefix}${cliConfig.command} ${flags} "${prompt}"`;
    }
    return `${prefix}${cliConfig.command} "${prompt}"`;
}

/**
 * Build the agent CLI command string for research conduct.
 * @param {string} agentId - Agent ID (cc, gg, cx, cu)
 * @param {string} researchId - Research ID (padded, e.g., "05")
 * @returns {string} Command string to run the agent CLI with research-do
 */
function buildResearchAgentCommand(agentId, researchId) {
    const cliConfig = getAgentCliConfig(agentId);
    const agentConfig = loadAgentConfig(agentId);

    // Research commands use the agent's CMD_PREFIX placeholder
    // e.g., "/aigon:research-do" for Claude/Gemini, "/aigon-research-do" for Cursor
    const cmdPrefix = agentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
    const prompt = `${cmdPrefix}research-do ${researchId}`;

    // Unset CLAUDECODE to prevent "nested session" error when launched from a Claude Code terminal
    const prefix = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';

    const model = cliConfig.models?.['research'];
    const modelFlag = model ? `--model ${model}` : '';

    const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const flags = [...flagTokens, modelFlag].filter(Boolean).join(' ');
    if (flags) {
        return `${prefix}${cliConfig.command} ${flags} "${prompt}"`;
    }
    return `${prefix}${cliConfig.command} "${prompt}"`;
}

function toUnpaddedId(id) {
    const parsed = parseInt(String(id), 10);
    return Number.isNaN(parsed) ? String(id) : String(parsed);
}

function resolveTmuxRepoName(options) {
    if (options && options.repo) {
        return path.basename(options.repo);
    }

    const worktreePath = options && (options.worktreePath || options.path || options.cwd);
    if (worktreePath) {
        const normalizedPath = path.resolve(worktreePath);
        const baseName = path.basename(normalizedPath);
        const parentBase = path.basename(path.dirname(normalizedPath));

        if (/^(feature|research)-\d+-[a-z]{2}(?:-|$)/.test(baseName) && parentBase.endsWith('-worktrees')) {
            return parentBase.slice(0, -'-worktrees'.length);
        }

        if (baseName.endsWith('-worktrees')) {
            return baseName.slice(0, -'-worktrees'.length);
        }
    }

    return path.basename(process.cwd());
}

/**
 * Build a tmux session name following the naming convention:
 *   {repo}-f{num}-{agent}-{desc}
 * Falls back to shorter forms when repo/desc are unavailable.
 * @param {string} featureId
 * @param {string} [agentId]
 * @param {object} [options]
 * @param {string} [options.repo] - repository name (defaults to cwd basename)
 * @param {string} [options.desc] - feature description (kebab-case)
 */
function buildTmuxSessionName(featureId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const agent = agentId || 'solo';
    const num = toUnpaddedId(featureId);
    const desc = options && options.desc;
    return desc
        ? `${repo}-f${num}-${agent}-${desc}`
        : `${repo}-f${num}-${agent}`;
}

/**
 * Build a tmux session name for research sessions:
 *   {repo}-r{num}-{agent}
 */
function buildResearchTmuxSessionName(researchId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    return `${repo}-r${toUnpaddedId(researchId)}-${agentId}`;
}

/**
 * Match a tmux session name against a feature or research ID.
 * Handles both old-style (aigon-f40-cc) and new-style (repo-f40-cc-desc) names.
 * Returns { type: 'f'|'r', id: string, agent: string } or null.
 */
function matchTmuxSessionByEntityId(sessionName, entityId) {
    const unpadded = toUnpaddedId(entityId);
    // Match: {anything}-f{id}-{agent} or {anything}-r{id}-{agent}
    const match = sessionName.match(/^.+-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!match) return null;
    if (toUnpaddedId(match[2]) !== unpadded) return null;
    return { type: match[1], id: match[2], agent: match[3] };
}

function assertTmuxAvailable() {
    const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error('tmux is not installed or not available in PATH');
    }
}

function tmuxSessionExists(sessionName) {
    const result = spawnSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

function createDetachedTmuxSession(sessionName, cwd, command) {
    const args = ['new-session', '-d', '-s', sessionName, '-c', cwd];
    if (command) args.push(command);
    const result = spawnSync('tmux', args, { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error(`Failed to create tmux session "${sessionName}"`);
    }
    // Set terminal window title to the session name so windows are identifiable
    spawnSync('tmux', ['set-option', '-t', sessionName, 'set-titles', 'on'], { stdio: 'ignore' });
    spawnSync('tmux', ['set-option', '-t', sessionName, 'set-titles-string', '#{session_name}'], { stdio: 'ignore' });
    // Name the default window so menubar and list-windows show meaningful names
    spawnSync('tmux', ['rename-window', '-t', `${sessionName}:0`, sessionName], { stdio: 'ignore' });
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function openTerminalAppWithCommand(cwd, command, title) {
    const effectiveConfig = getEffectiveConfig();
    const tmuxApp = effectiveConfig.tmuxApp || 'terminal';

    if (tmuxApp === 'iterm2') {
        // iTerm2: regular tmux attach (no -CC control mode — it causes raw protocol garbage)
        // Note: skip cd — the tmux session already has its working directory set

        // If the session is already attached in an iTerm2 window, raise that window instead
        // of creating a duplicate. We detect this by checking tmux clients and matching the
        // title against iTerm2 windows.
        if (title) {
            const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const focusScript = [
                'tell application "iTerm2"',
                `  repeat with w in windows`,
                `    repeat with t in tabs of w`,
                `      repeat with s in sessions of t`,
                `        if name of s is "${escapedTitle}" then`,
                `          select t`,
                `          set index of w to 1`,
                `          activate`,
                `          return "found"`,
                `        end if`,
                `      end repeat`,
                `    end repeat`,
                `  end repeat`,
                'end tell',
                'return "not found"'
            ].join('\n');
            const focusResult = spawnSync('osascript', ['-e', focusScript], { stdio: 'pipe', encoding: 'utf8' });
            if (focusResult.stdout && focusResult.stdout.trim() === 'found') {
                return; // Existing window brought to front — no new window needed
            }
        }

        // iTerm2's "create window with default profile command" uses execvp which does NOT
        // search $PATH, so we must resolve the absolute path to any binary in the command.
        const resolvedCommand = command.replace(/^(\S+)/, (bin) => {
            try { return execSync(`which ${bin}`, { encoding: 'utf8' }).trim(); } catch { return bin; }
        });
        const escapedCommand = resolvedCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const titleLines = title
            ? [`set name of current session of current window to "${title.replace(/"/g, '\\"')}"`, '']
            : [];
        const appleScript = [
            'tell application "iTerm2"',
            'activate',
            `create window with default profile command "${escapedCommand}"`,
            ...titleLines,
            'end tell'
        ].join('\n');
        const result = spawnSync('osascript', ['-e', appleScript], { stdio: 'pipe' });
        if (result.error || result.status !== 0) {
            const errMsg = result.stderr ? result.stderr.toString().trim() : 'unknown error';
            throw new Error(`Failed to open iTerm2: ${errMsg}. Is iTerm2 installed?`);
        }
    } else {
        // Default: Terminal.app

        // If a window with this title already exists, bring it to front instead of creating a duplicate
        if (title) {
            const focusScript = [
                'tell application "Terminal"',
                `  repeat with w in windows`,
                `    if custom title of selected tab of w is ${JSON.stringify(title)} then`,
                `      set index of w to 1`,
                `      set frontmost to true`,
                `      activate`,
                `      return "found"`,
                `    end if`,
                `  end repeat`,
                'end tell',
                'return "not found"'
            ].join('\n');
            const focusResult = spawnSync('osascript', ['-e', focusScript], { stdio: 'pipe', encoding: 'utf8' });
            if (focusResult.stdout && focusResult.stdout.trim() === 'found') {
                return; // Existing window brought to front — no new window needed
            }
        }

        const fullCommand = `cd ${shellQuote(cwd)} && ${command}`;
        const titleLines = title
            ? [
                `set custom title of selected tab of front window to ${JSON.stringify(title)}`,
                'set title displays custom title of selected tab of front window to true'
            ]
            : [];
        const appleScript = [
            'tell application "Terminal"',
            'activate',
            `do script ${JSON.stringify(fullCommand)}`,
            ...titleLines,
            'end tell'
        ].join('\n');
        const result = spawnSync('osascript', ['-e', appleScript], { stdio: 'ignore' });
        if (result.error || result.status !== 0) {
            throw new Error('Failed to open Terminal.app and run command');
        }
    }
}

function ensureTmuxSessionForWorktree(wt, agentCommand) {
    const sessionName = buildTmuxSessionName(wt.featureId, wt.agent, { desc: wt.desc, worktreePath: wt.path });
    if (tmuxSessionExists(sessionName)) {
        return { sessionName, created: false };
    }

    const listResult = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
    if (!listResult.error && listResult.status === 0) {
        const existing = listResult.stdout.split('\n').map(s => s.trim()).find(s =>
            matchTmuxSessionByEntityId(s, wt.featureId)?.agent === wt.agent
        );
        if (existing) {
            return { sessionName: existing, created: false };
        }
    }

    createDetachedTmuxSession(sessionName, wt.path, agentCommand);
    return { sessionName, created: true };
}

/**
 * Open multiple worktrees side-by-side in Warp using split panes.
 * @param {Array<{path: string, agent: string, desc: string, featureId: string, agentCommand: string}>} worktreeConfigs
 * @param {string} configName - Warp launch config name
 * @param {string} title - Tab title for the Warp window
 * @param {string} [tabColor] - Optional Warp tab ANSI color (Red, Green, Yellow, Blue, Magenta, Cyan)
 */
function openInWarpSplitPanes(worktreeConfigs, configName, title, tabColor) {
    const warpConfigDir = path.join(os.homedir(), '.warp', 'launch_configurations');
    const configFile = path.join(warpConfigDir, `${configName}.yaml`);

    const panes = worktreeConfigs.map(wt => {
        const commands = [];

        // Set pane title using ANSI escape sequence (for individual pane identification)
        if (wt.agent) {
            const agentConfig = AGENT_CONFIGS[wt.agent] || {};
            const agentName = agentConfig.name || wt.agent;
            const paneTitle = wt.researchId
                ? `Research #${wt.researchId} - ${agentName}`
                : wt.featureId
                    ? `Feature #${String(wt.featureId).padStart(2, '0')} - ${agentName}`
                    : agentName;
            commands.push(`                  - exec: 'echo -ne "\\033]0;${paneTitle}\\007"'`);
        }

        if (wt.portLabel) {
            commands.push(`                  - exec: 'echo "\\n${wt.portLabel}\\n"'`);
        }
        commands.push(`                  - exec: '${wt.agentCommand}'`);
        return `              - cwd: "${wt.path}"\n                commands:\n${commands.join('\n')}`;
    }).join('\n');

    const colorLine = tabColor ? `\n        color: ${tabColor}` : '';
    const yamlContent = `---
name: ${configName}
windows:
  - tabs:
      - title: "${title}"${colorLine}
        layout:
          split_direction: horizontal
          panes:
${panes}
`;

    if (!fs.existsSync(warpConfigDir)) {
        fs.mkdirSync(warpConfigDir, { recursive: true });
    }
    fs.writeFileSync(configFile, yamlContent);
    execSync(`open "warp://launch/${configName}"`);

    return configFile;
}

/**
 * Close a Warp window whose tab title contains the given hint.
 * Returns true if AppleScript executed without error (window found + closed).
 */
function closeWarpWindow(titleHint) {
    try {
        execSync(
            `osascript -e 'try' -e 'tell application "Warp" to close (first window whose name contains "${titleHint}")' -e 'end try'`,
            { stdio: 'ignore' }
        );
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Open a single worktree in the specified terminal.
 */
function openSingleWorktree(wt, agentCommand, terminal) {
    if (terminal === 'warp') {
        const wtBasename = path.basename(wt.path);
        const configName = `worktree-${wtBasename}`;
        const warpConfigDir = path.join(os.homedir(), '.warp', 'launch_configurations');
        const configFile = path.join(warpConfigDir, `${configName}.yaml`);

        const agentMeta = AGENT_CONFIGS[wt.agent] || {};
        const paddedId = String(wt.featureId).padStart(2, '0');
        const profile = getActiveProfile();
        const port = profile.devServer.enabled
            ? (profile.devServer.ports[wt.agent] || agentMeta.port || 3000)
            : null;
        const portSuffix = port ? ` | Port ${port}` : '';
        const tabTitle = `Feature #${paddedId} - ${agentMeta.name || wt.agent}${portSuffix}`;
        const tabColor = agentMeta.terminalColor || 'cyan';

        const yamlContent = `---
name: ${configName}
windows:
  - tabs:
      - title: "${tabTitle}"
        color: ${tabColor}
        layout:
          cwd: "${wt.path}"
          commands:
            - exec: '${agentCommand}'
`;

        try {
            if (!fs.existsSync(warpConfigDir)) {
                fs.mkdirSync(warpConfigDir, { recursive: true });
            }
            fs.writeFileSync(configFile, yamlContent);
            execSync(`open "warp://launch/${configName}"`);

            console.log(`\n🚀 Opening worktree in Warp:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Command: ${agentCommand}`);
        } catch (e) {
            console.error(`❌ Failed to open Warp: ${e.message}`);
        }
    } else if (terminal === 'code' || terminal === 'vscode') {
        try {
            execSync(`code "${wt.path}"`);

            console.log(`\n🚀 Opening worktree in VS Code:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n📋 Run this command in the VS Code terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`❌ Failed to open VS Code: ${e.message}`);
            console.error(`   Make sure the 'code' CLI is installed (VS Code: Cmd+Shift+P > "Install 'code' command")`);
        }
    } else if (terminal === 'cursor') {
        try {
            execSync(`cursor --trust-workspace "${wt.path}"`);

            console.log(`\n🚀 Opening worktree in Cursor:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n📋 Run this command in the Cursor terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`❌ Failed to open Cursor: ${e.message}`);
            console.error(`   Make sure the 'cursor' CLI is installed`);
        }
    } else if (terminal === 'terminal') {
        try {
            execSync(`open -a Terminal "${wt.path}"`);

            console.log(`\n🚀 Opening worktree in Terminal.app:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`\n📋 Run this command in the terminal:`);
            console.log(`   ${agentCommand}`);
        } catch (e) {
            console.error(`❌ Failed to open Terminal.app: ${e.message}`);
        }
    } else if (terminal === 'tmux') {
        try {
            assertTmuxAvailable();
            const { sessionName, created } = ensureTmuxSessionForWorktree(wt, agentCommand);
            openTerminalAppWithCommand(wt.path, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);

            const tmuxAppName = (getEffectiveConfig().tmuxApp || 'terminal') === 'iterm2' ? 'iTerm2' : 'Terminal.app';
            console.log(`\n🚀 Opening worktree in tmux via ${tmuxAppName}:`);
            console.log(`   Feature: ${wt.featureId} - ${wt.desc}`);
            console.log(`   Agent: ${wt.agent}`);
            console.log(`   Path: ${wt.path}`);
            console.log(`   Session: ${sessionName}${created ? ' (created)' : ' (attached)'}`);
        } catch (e) {
            console.error(`❌ Failed to open tmux session: ${e.message}`);
            console.error(`   Install tmux: brew install tmux`);
        }
    } else {
        console.error(`❌ Terminal "${terminal}" not supported.`);
        console.error(`   Supported terminals: warp, code (VS Code), cursor, terminal, tmux`);
        console.error(`\n   Override with: aigon worktree-open <ID> --terminal=warp`);
        console.error(`   Or set default: Edit ~/.aigon/config.json`);
    }
}

// --- Worktree Permission Helpers ---

function addWorktreePermissions(worktreePaths) {
    // Add full file and bash permissions for worktrees to Claude settings
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

    try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        if (!settings.permissions) settings.permissions = {};
        if (!settings.permissions.allow) settings.permissions.allow = [];

        // Convert relative paths to absolute for permissions
        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            const permissions = [
                `Read(${absolutePath}/**)`,
                `Edit(${absolutePath}/**)`,
                `Write(${absolutePath}/**)`,
                `Bash(cd ${absolutePath}:*)`,
                `Bash(git -C ${absolutePath}:*)`,
            ];

            permissions.forEach(perm => {
                if (!settings.permissions.allow.includes(perm)) {
                    settings.permissions.allow.push(perm);
                }
            });
        });

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
        console.log(`🔓 Added worktree permissions to .claude/settings.json`);
    } catch (e) {
        console.warn(`⚠️  Could not update Claude settings: ${e.message}`);
    }
}

function removeWorktreePermissions(worktreePaths) {
    // Remove all worktree permissions from Claude settings
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

    try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
        if (!settings.permissions || !settings.permissions.allow) return;

        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            // Remove any permission that references this worktree path
            settings.permissions.allow = settings.permissions.allow.filter(
                perm => !perm.includes(absolutePath)
            );
        });

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        // Silent fail on cleanup
    }
}

/**
 * Pre-seed Claude Code workspace trust for worktree directories.
 * Claude Code stores trust state in ~/.claude.json under projects.<path>.hasTrustDialogAccepted.
 * Without this, each new worktree triggers an interactive trust dialog that blocks automated launches.
 * @param {string[]} worktreePaths - Array of worktree paths (relative or absolute)
 */
function presetWorktreeTrust(worktreePaths) {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    try {
        let config = {};
        if (fs.existsSync(claudeJsonPath)) {
            config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
        }
        if (!config.projects) config.projects = {};

        const cwd = process.cwd();
        let changed = false;
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            if (!config.projects[absolutePath]) {
                config.projects[absolutePath] = {};
            }
            if (!config.projects[absolutePath].hasTrustDialogAccepted) {
                config.projects[absolutePath].hasTrustDialogAccepted = true;
                changed = true;
            }
        });

        if (changed) {
            fs.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
            console.log(`🔓 Pre-seeded Claude Code workspace trust for worktree(s)`);
        }
    } catch (e) {
        console.warn(`⚠️  Could not pre-seed Claude Code trust: ${e.message}`);
    }
}

/**
 * Remove Claude Code workspace trust entries for worktree directories.
 * @param {string[]} worktreePaths - Array of worktree paths (relative or absolute)
 */
function removeWorktreeTrust(worktreePaths) {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    try {
        if (!fs.existsSync(claudeJsonPath)) return;
        const config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
        if (!config.projects) return;

        const cwd = process.cwd();
        worktreePaths.forEach(relativePath => {
            const absolutePath = path.resolve(cwd, relativePath);
            delete config.projects[absolutePath];
        });

        fs.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
    } catch (e) {
        // Silent fail on cleanup
    }
}

/**
 * Pre-seed Codex project trust so worktrees can load project-level config.
 * Adds the current project root as trusted in ~/.codex/config.toml.
 */
function presetCodexTrust() {
    const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml');
    try {
        let config = '';
        if (fs.existsSync(codexConfigPath)) {
            config = fs.readFileSync(codexConfigPath, 'utf8');
        }

        const projectRoot = process.cwd();
        const entry = `[projects."${projectRoot}"]`;

        if (config.includes(entry)) return; // already trusted

        if (config.length > 0 && !config.endsWith('\n')) config += '\n';
        config += `\n${entry}\ntrust_level = "trusted"\n`;

        safeWrite(codexConfigPath, config);
        console.log(`🔓 Pre-seeded Codex project trust for ${projectRoot}`);
    } catch (e) {
        console.warn(`⚠️  Could not pre-seed Codex trust: ${e.message}`);
    }
}

// --- Hooks System ---

/**
 * Parse hooks file and extract all defined hooks
 * @returns {Object} Map of hook names to their shell scripts
 */
function parseHooksFile() {
    if (!fs.existsSync(HOOKS_FILE_PATH)) {
        return {};
    }

    const content = fs.readFileSync(HOOKS_FILE_PATH, 'utf8');
    const hooks = {};

    // Match ## hook-name sections followed by ```bash code blocks
    const hookPattern = /^##\s+(pre-|post-)([a-z-]+)\s*\n[\s\S]*?```bash\n([\s\S]*?)```/gm;
    let match;

    while ((match = hookPattern.exec(content)) !== null) {
        const hookType = match[1]; // 'pre-' or 'post-'
        const commandName = match[2]; // e.g., 'feature-setup'
        const script = match[3].trim();
        const hookName = `${hookType}${commandName}`;
        hooks[hookName] = script;
    }

    return hooks;
}

/**
 * Get all defined hooks from the hooks file
 * @returns {Array} Array of {name, type, command, script} objects
 */
function getDefinedHooks() {
    const hooks = parseHooksFile();
    return Object.entries(hooks).map(([name, script]) => {
        const match = name.match(/^(pre|post)-(.+)$/);
        return {
            name,
            type: match ? match[1] : 'unknown',
            command: match ? match[2] : name,
            script
        };
    });
}

/**
 * Execute a hook with the given context
 * @param {string} hookName - Name of the hook (e.g., 'pre-feature-setup')
 * @param {Object} context - Context variables to pass as environment variables
 * @returns {Object} {success: boolean, output?: string, error?: string}
 */
function executeHook(hookName, context = {}) {
    const hooks = parseHooksFile();
    const script = hooks[hookName];

    if (!script) {
        return { success: true, skipped: true };
    }

    console.log(`\n🪝 Running hook: ${hookName}`);

    // Build environment variables
    const env = {
        ...process.env,
        AIGON_PROJECT_ROOT: process.cwd(),
        AIGON_COMMAND: context.command || '',
        AIGON_FEATURE_ID: context.featureId || '',
        AIGON_FEATURE_NAME: context.featureName || '',
        AIGON_MODE: context.mode || '',  // 'drive', 'fleet', 'autopilot', or 'swarm'
        AIGON_AGENTS: context.agents ? context.agents.join(' ') : '',
        AIGON_AGENT: context.agent || '',
        AIGON_WORKTREE_PATH: context.worktreePath || ''
    };

    try {
        const output = execSync(script, {
            encoding: 'utf8',
            env,
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        if (output.trim()) {
            console.log(output.trim().split('\n').map(line => `   ${line}`).join('\n'));
        }
        console.log(`   ✅ Hook completed: ${hookName}`);
        return { success: true, output };
    } catch (e) {
        const errorOutput = e.stderr || e.message;
        console.error(`   ❌ Hook failed: ${hookName}`);
        if (errorOutput) {
            console.error(errorOutput.trim().split('\n').map(line => `   ${line}`).join('\n'));
        }
        return { success: false, error: errorOutput };
    }
}

/**
 * Run pre-hook for a command. Aborts if hook fails.
 * @param {string} commandName - Name of the command (e.g., 'feature-setup')
 * @param {Object} context - Context variables to pass to the hook
 * @returns {boolean} true if should continue, false if should abort
 */
function runPreHook(commandName, context = {}) {
    const hookName = `pre-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (result.skipped) {
        return true; // No hook defined, continue
    }

    if (!result.success) {
        console.error(`\n❌ Pre-hook failed. Command '${commandName}' aborted.`);
        return false;
    }

    return true;
}

/**
 * Run post-hook for a command. Warns but doesn't fail on error.
 * @param {string} commandName - Name of the command (e.g., 'feature-setup')
 * @param {Object} context - Context variables to pass to the hook
 */
function runPostHook(commandName, context = {}) {
    const hookName = `post-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (!result.skipped && !result.success) {
        console.warn(`\n⚠️  Post-hook '${hookName}' failed but command completed.`);
    }
}

const PATHS = {
    research: {
        root: path.join(SPECS_ROOT, 'research-topics'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-done', '05-paused'],
        prefix: 'research'
    },
    features: {
        root: path.join(SPECS_ROOT, 'features'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
        prefix: 'feature'
    },
    feedback: {
        root: path.join(SPECS_ROOT, 'feedback'),
        folders: ['01-inbox', '02-triaged', '03-actionable', '04-done', '05-wont-fix', '06-duplicate'],
        prefix: 'feedback'
    }
};

const FEEDBACK_STATUS_TO_FOLDER = {
    'inbox': '01-inbox',
    'triaged': '02-triaged',
    'actionable': '03-actionable',
    'done': '04-done',
    'wont-fix': '05-wont-fix',
    'duplicate': '06-duplicate'
};
const FEEDBACK_FOLDER_TO_STATUS = Object.fromEntries(
    Object.entries(FEEDBACK_STATUS_TO_FOLDER).map(([status, folder]) => [folder, status])
);
const FEEDBACK_STATUS_FLAG_TO_FOLDER = {
    'inbox': FEEDBACK_STATUS_TO_FOLDER['inbox'],
    'triaged': FEEDBACK_STATUS_TO_FOLDER['triaged'],
    'actionable': FEEDBACK_STATUS_TO_FOLDER['actionable'],
    'done': FEEDBACK_STATUS_TO_FOLDER['done'],
    'wont-fix': FEEDBACK_STATUS_TO_FOLDER['wont-fix'],
    'duplicate': FEEDBACK_STATUS_TO_FOLDER['duplicate']
};
const FEEDBACK_ACTION_TO_STATUS = {
    'keep': 'triaged',
    'mark-duplicate': 'duplicate',
    'duplicate': 'duplicate',
    'promote-feature': 'actionable',
    'promote-research': 'actionable',
    'wont-fix': 'wont-fix'
};
const FEEDBACK_DEFAULT_LIST_FOLDERS = [
    FEEDBACK_STATUS_TO_FOLDER['inbox'],
    FEEDBACK_STATUS_TO_FOLDER['triaged'],
    FEEDBACK_STATUS_TO_FOLDER['actionable']
];

// --- Helper Functions ---

function slugify(value) {
    const text = String(value || '').trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || 'untitled';
}

function parseCliOptions(args) {
    const options = { _: [] };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            options._.push(arg);
            continue;
        }

        const eqIndex = arg.indexOf('=');
        let key;
        let value;

        if (eqIndex !== -1) {
            key = arg.slice(2, eqIndex);
            value = arg.slice(eqIndex + 1);
        } else {
            key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('--')) {
                value = nextArg;
                i++;
            } else {
                value = true;
            }
        }

        if (options[key] === undefined) {
            options[key] = value;
        } else if (Array.isArray(options[key])) {
            options[key].push(value);
        } else {
            options[key] = [options[key], value];
        }
    }

    return options;
}

function getOptionValue(options, key) {
    const value = options[key];
    if (Array.isArray(value)) {
        return value[value.length - 1];
    }
    return value;
}

function getOptionValues(options, key) {
    const value = options[key];
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function normalizeFeedbackStatus(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    const aliasMap = {
        'inbox': 'inbox',
        'triaged': 'triaged',
        'actionable': 'actionable',
        'done': 'done',
        'wont-fix': 'wont-fix',
        'wontfix': 'wont-fix',
        'wont_fix': 'wont-fix',
        'duplicate': 'duplicate'
    };
    return aliasMap[normalized] || null;
}

function getFeedbackFolderFromStatus(status) {
    return FEEDBACK_STATUS_TO_FOLDER[normalizeFeedbackStatus(status)] || null;
}

function normalizeFeedbackSeverity(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized === 'none' || normalized === 'null') {
        return null;
    }
    return normalized;
}

function normalizeTag(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '-');
    return normalized || null;
}

function parseTagListValue(value) {
    if (value === undefined || value === null) return null;
    const rawValues = Array.isArray(value) ? value : [value];
    const tags = [];
    let shouldClear = false;

    rawValues.forEach(entry => {
        const text = String(entry).trim();
        if (!text) return;
        if (text.toLowerCase() === 'none' || text.toLowerCase() === 'null') {
            shouldClear = true;
            return;
        }
        text.split(',').forEach(part => {
            const tag = normalizeTag(part);
            if (tag) tags.push(tag);
        });
    });

    if (shouldClear) {
        return [];
    }
    return [...new Set(tags)];
}

function normalizeTagList(value) {
    if (value === undefined || value === null) return [];
    const tags = parseTagListValue(value);
    if (!tags) return [];
    return tags;
}

function parseNumericArray(value) {
    if (value === undefined || value === null) return [];
    const values = Array.isArray(value) ? value : [value];
    const parsed = values
        .map(v => parseInt(v, 10))
        .filter(v => Number.isFinite(v) && v > 0);
    return [...new Set(parsed)];
}

function stripInlineYamlComment(value) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
            return value.slice(0, i).trimEnd();
        }
    }

    return value.trimEnd();
}

function splitInlineYamlArray(value) {
    const parts = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            current += ch;
            continue;
        }
        if (ch === ',' && !inSingle && !inDouble) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}

function parseYamlScalar(rawValue) {
    const value = stripInlineYamlComment(String(rawValue)).trim();
    if (value === '') return '';

    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch (e) {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith('\'') && value.endsWith('\'')) {
        return value.slice(1, -1).replace(/\\'/g, '\'');
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return splitInlineYamlArray(inner).map(parseYamlScalar);
    }
    return value;
}

function parseFrontMatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        return { data: {}, body: content, hasFrontMatter: false };
    }

    const data = {};
    let currentObjectKey = null;
    const rawFrontMatter = match[1];

    rawFrontMatter.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const indent = (line.match(/^\s*/) || [''])[0].length;
        const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!kvMatch) return;
        const [, key, rawValue] = kvMatch;

        if (indent === 0) {
            if (rawValue === '') {
                data[key] = {};
                currentObjectKey = key;
            } else {
                data[key] = parseYamlScalar(rawValue);
                currentObjectKey = null;
            }
            return;
        }

        if (currentObjectKey &&
            typeof data[currentObjectKey] === 'object' &&
            !Array.isArray(data[currentObjectKey])) {
            data[currentObjectKey][key] = parseYamlScalar(rawValue);
        }
    });

    const body = content.slice(match[0].length);
    return { data, body, hasFrontMatter: true };
}

function serializeYamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map(v => serializeYamlScalar(v)).join(', ')}]`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return JSON.stringify(String(value));
}

function serializeFeedbackFrontMatter(metadata) {
    const reporter = metadata.reporter || {};
    const source = metadata.source || {};
    const lines = [
        '---',
        `id: ${Number.isFinite(metadata.id) ? metadata.id : 0}`,
        `title: ${serializeYamlScalar(metadata.title || '')}`,
        `status: ${serializeYamlScalar(normalizeFeedbackStatus(metadata.status) || 'inbox')}`,
        `type: ${serializeYamlScalar(metadata.type || 'unknown')}`,
        'reporter:',
        `  name: ${serializeYamlScalar(reporter.name || '')}`,
        `  identifier: ${serializeYamlScalar(reporter.identifier || '')}`,
        'source:',
        `  channel: ${serializeYamlScalar(source.channel || '')}`,
        `  reference: ${serializeYamlScalar(source.reference || '')}`
    ];

    if (source.url) {
        lines.push(`  url: ${serializeYamlScalar(source.url)}`);
    }
    if (metadata.severity) {
        lines.push(`severity: ${serializeYamlScalar(metadata.severity)}`);
    }
    if (Array.isArray(metadata.tags) && metadata.tags.length > 0) {
        lines.push(`tags: ${serializeYamlScalar(metadata.tags)}`);
    }
    if (Number.isFinite(metadata.votes)) {
        lines.push(`votes: ${metadata.votes}`);
    }
    if (Number.isFinite(metadata.duplicate_of) && metadata.duplicate_of > 0) {
        lines.push(`duplicate_of: ${metadata.duplicate_of}`);
    }
    if (Array.isArray(metadata.linked_features) && metadata.linked_features.length > 0) {
        lines.push(`linked_features: ${serializeYamlScalar(metadata.linked_features)}`);
    }
    if (Array.isArray(metadata.linked_research) && metadata.linked_research.length > 0) {
        lines.push(`linked_research: ${serializeYamlScalar(metadata.linked_research)}`);
    }

    lines.push('---');
    return lines.join('\n');
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownSection(body, heading) {
    const sectionRegex = new RegExp(
        `^##\\s+${escapeRegex(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
        'im'
    );
    const match = body.match(sectionRegex);
    if (!match) return '';
    return match[1]
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractFeedbackSummary(body) {
    return extractMarkdownSection(body, 'Summary');
}

function normalizeFeedbackMetadata(data, defaults = {}) {
    const reporterDefaults = defaults.reporter && typeof defaults.reporter === 'object' ? defaults.reporter : {};
    const sourceDefaults = defaults.source && typeof defaults.source === 'object' ? defaults.source : {};
    const reporterData = data.reporter && typeof data.reporter === 'object' ? data.reporter : {};
    const sourceData = data.source && typeof data.source === 'object' ? data.source : {};

    const idCandidate = data.id !== undefined ? parseInt(data.id, 10) : parseInt(defaults.id, 10);
    const status = normalizeFeedbackStatus(data.status) ||
        normalizeFeedbackStatus(defaults.status) ||
        'inbox';
    const type = String(data.type !== undefined ? data.type : (defaults.type || 'unknown')).trim() || 'unknown';

    const metadata = {
        id: Number.isFinite(idCandidate) ? idCandidate : 0,
        title: String(data.title !== undefined ? data.title : (defaults.title || '')),
        status,
        type,
        reporter: {
            name: String(reporterData.name !== undefined ? reporterData.name : (reporterDefaults.name || '')),
            identifier: String(reporterData.identifier !== undefined ? reporterData.identifier : (reporterDefaults.identifier || ''))
        },
        source: {
            channel: String(sourceData.channel !== undefined ? sourceData.channel : (sourceDefaults.channel || '')),
            reference: String(sourceData.reference !== undefined ? sourceData.reference : (sourceDefaults.reference || ''))
        }
    };

    const sourceUrl = sourceData.url !== undefined ? sourceData.url : sourceDefaults.url;
    if (sourceUrl) {
        metadata.source.url = String(sourceUrl);
    }

    const severityValue = data.severity !== undefined ? data.severity : defaults.severity;
    const severity = normalizeFeedbackSeverity(severityValue);
    if (severity) {
        metadata.severity = severity;
    }

    const tagsValue = data.tags !== undefined ? data.tags : defaults.tags;
    const tags = normalizeTagList(tagsValue);
    if (tags.length > 0) {
        metadata.tags = tags;
    }

    const votesValue = data.votes !== undefined ? data.votes : defaults.votes;
    const votes = parseInt(votesValue, 10);
    if (Number.isFinite(votes)) {
        metadata.votes = votes;
    }

    const duplicateValue = data.duplicate_of !== undefined ? data.duplicate_of : defaults.duplicate_of;
    const duplicateOf = parseInt(duplicateValue, 10);
    if (Number.isFinite(duplicateOf) && duplicateOf > 0) {
        metadata.duplicate_of = duplicateOf;
    }

    const linkedFeaturesValue = data.linked_features !== undefined ? data.linked_features : defaults.linked_features;
    const linkedFeatures = parseNumericArray(linkedFeaturesValue);
    if (linkedFeatures.length > 0) {
        metadata.linked_features = linkedFeatures;
    }

    const linkedResearchValue = data.linked_research !== undefined ? data.linked_research : defaults.linked_research;
    const linkedResearch = parseNumericArray(linkedResearchValue);
    if (linkedResearch.length > 0) {
        metadata.linked_research = linkedResearch;
    }

    return metadata;
}

function buildFeedbackDocumentContent(metadata, body) {
    const normalizedBody = body ? body.replace(/^\r?\n/, '') : '';
    const ensuredBody = normalizedBody ? (normalizedBody.endsWith('\n') ? normalizedBody : `${normalizedBody}\n`) : '';
    return `${serializeFeedbackFrontMatter(metadata)}\n\n${ensuredBody}`;
}

function readFeedbackDocument(fileObj) {
    const content = fs.readFileSync(fileObj.fullPath, 'utf8');
    const parsed = parseFrontMatter(content);
    const fileMatch = fileObj.file.match(/^feedback-(\d+)-(.*)\.md$/);
    const fallbackId = fileMatch ? parseInt(fileMatch[1], 10) : 0;
    const fallbackTitle = fileMatch ? fileMatch[2].replace(/-/g, ' ') : '';
    const fallbackStatus = FEEDBACK_FOLDER_TO_STATUS[fileObj.folder] || 'inbox';

    const metadata = normalizeFeedbackMetadata(parsed.data, {
        id: fallbackId,
        title: fallbackTitle,
        status: fallbackStatus,
        type: 'unknown',
        reporter: { name: '', identifier: '' },
        source: { channel: '', reference: '' }
    });
    const summary = extractFeedbackSummary(parsed.body);

    return {
        ...fileObj,
        metadata,
        body: parsed.body,
        summary
    };
}

function collectFeedbackItems(folders = PATHS.feedback.folders) {
    const items = [];

    folders.forEach(folder => {
        const folderPath = path.join(PATHS.feedback.root, folder);
        if (!fs.existsSync(folderPath)) return;

        const files = fs.readdirSync(folderPath)
            .filter(file => file.startsWith(`${PATHS.feedback.prefix}-`) && file.endsWith('.md'))
            .sort();

        files.forEach(file => {
            const fullPath = path.join(folderPath, file);
            items.push(readFeedbackDocument({ file, folder, fullPath }));
        });
    });

    items.sort((a, b) => {
        const aId = Number.isFinite(a.metadata.id) ? a.metadata.id : Number.MAX_SAFE_INTEGER;
        const bId = Number.isFinite(b.metadata.id) ? b.metadata.id : Number.MAX_SAFE_INTEGER;
        if (aId !== bId) return aId - bId;
        return a.file.localeCompare(b.file);
    });

    return items;
}

function tokenizeText(value) {
    return new Set(
        String(value || '')
            .toLowerCase()
            .match(/[a-z0-9]+/g) || []
    );
}

function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    setA.forEach(token => {
        if (setB.has(token)) intersection++;
    });
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
}

function findDuplicateFeedbackCandidates(targetItem, allItems, limit = 3) {
    const targetTitleTokens = tokenizeText(targetItem.metadata.title);
    const targetSummaryTokens = tokenizeText(targetItem.summary);
    const targetCombinedTokens = new Set([...targetTitleTokens, ...targetSummaryTokens]);

    return allItems
        .filter(item => item.fullPath !== targetItem.fullPath && item.metadata.id !== targetItem.metadata.id)
        .map(item => {
            const titleTokens = tokenizeText(item.metadata.title);
            const summaryTokens = tokenizeText(item.summary);
            const combinedTokens = new Set([...titleTokens, ...summaryTokens]);

            const titleScore = jaccardSimilarity(targetTitleTokens, titleTokens);
            const summaryScore = jaccardSimilarity(targetSummaryTokens, summaryTokens);
            const combinedScore = jaccardSimilarity(targetCombinedTokens, combinedTokens);
            const weightedScore = (titleScore * 0.7) + (summaryScore * 0.3);
            const score = Math.max(weightedScore, combinedScore);

            return {
                id: item.metadata.id,
                title: item.metadata.title,
                status: item.metadata.status,
                score,
                file: item.file
            };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function buildFeedbackTriageRecommendation(metadata, duplicateCandidates) {
    const topDuplicate = duplicateCandidates[0];
    if (metadata.duplicate_of) {
        return {
            action: 'mark-duplicate',
            reason: `duplicate_of is set (#${metadata.duplicate_of})`
        };
    }
    if (topDuplicate && topDuplicate.score >= 0.72) {
        return {
            action: 'mark-duplicate',
            reason: `high similarity to #${topDuplicate.id} (${Math.round(topDuplicate.score * 100)}%)`
        };
    }
    if (metadata.status === 'wont-fix') {
        return {
            action: 'wont-fix',
            reason: 'status is already set to wont-fix'
        };
    }

    const severity = normalizeFeedbackSeverity(metadata.severity);
    const type = String(metadata.type || '').toLowerCase();
    if (severity === 'high' || severity === 'critical') {
        if (['bug', 'performance', 'reliability'].includes(type)) {
            return {
                action: 'promote-to-feature',
                reason: 'high-severity defect should be routed into implementation'
            };
        }
        if (['feature-request', 'ux', 'usability'].includes(type)) {
            return {
                action: 'promote-to-feature',
                reason: 'high-impact request should become actionable'
            };
        }
        return {
            action: 'promote-to-research',
            reason: 'high-severity signal needs investigation before implementation'
        };
    }

    return {
        action: 'keep',
        reason: 'no strong duplicate or escalation signal'
    };
}

function formatFeedbackFieldValue(value) {
    if (value === undefined || value === null || value === '') return 'unset';
    if (Array.isArray(value)) {
        return value.length ? value.join(', ') : 'none';
    }
    return String(value);
}

function getNextId(typeConfig) {
    let maxId = 0;
    typeConfig.folders.forEach(folder => {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const regex = new RegExp(`^${typeConfig.prefix}-(\\d+)-`);
            const match = file.match(regex);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxId) maxId = num;
            }
        });
    });
    return maxId + 1;
}

function findFile(typeConfig, nameOrId, searchFolders = typeConfig.folders) {
    const isId = /^\d+$/.test(nameOrId);
    for (const folder of searchFolders) {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (!file.endsWith('.md')) continue;
            if (isId) {
                // Match files with ID: feature-55-description.md or feature-01-description.md
                // Support both padded (01) and unpadded (1) IDs
                const paddedId = String(nameOrId).padStart(2, '0');
                const unpadded = String(parseInt(nameOrId, 10));
                if (file.startsWith(`${typeConfig.prefix}-${paddedId}-`) ||
                    file.startsWith(`${typeConfig.prefix}-${unpadded}-`)) {
                    return { file, folder, fullPath: path.join(dir, file) };
                }
            } else {
                // Match files by name (with or without ID)
                // e.g., "dark-mode" matches both "feature-dark-mode.md" and "feature-55-dark-mode.md"
                if (file.includes(nameOrId)) {
                    return { file, folder, fullPath: path.join(dir, file) };
                }
            }
        }
    }
    return null;
}

// Find unprioritized file (no ID) in inbox: feature-description.md
function findUnprioritizedFile(typeConfig, name) {
    const dir = path.join(typeConfig.root, '01-inbox');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.md')) continue;
        // Match files WITHOUT an ID: feature-description.md (not feature-55-description.md)
        const hasId = new RegExp(`^${typeConfig.prefix}-\\d+-`).test(file);
        if (!hasId && file.includes(name)) {
            return { file, folder: '01-inbox', fullPath: path.join(dir, file) };
        }
    }
    return null;
}

function moveFile(fileObj, targetFolder, newFilename = null) {
    const targetDir = path.join(path.dirname(path.dirname(fileObj.fullPath)), targetFolder);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const destName = newFilename || fileObj.file;
    const destPath = path.join(targetDir, destName);
    fs.renameSync(fileObj.fullPath, destPath);
    console.log(`✅ Moved: ${fileObj.file} -> ${targetFolder}/${destName}`);
    return { ...fileObj, folder: targetFolder, file: destName, fullPath: destPath };
}

function modifySpecFile(filePath, modifierFn) {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontMatter(content);
    const modified = modifierFn({
        content,
        data: parsed.data,
        body: parsed.body,
        hasFrontMatter: parsed.hasFrontMatter
    });

    const nextContent = typeof modified === 'string'
        ? modified
        : (modified && typeof modified.content === 'string' ? modified.content : content);

    if (nextContent !== content) {
        fs.writeFileSync(filePath, nextContent);
    }

    return {
        changed: nextContent !== content,
        content: nextContent,
        data: parsed.data,
        body: parsed.body,
        hasFrontMatter: parsed.hasFrontMatter
    };
}

function printNextSteps(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    console.log('🚀 Next steps:');
    items.forEach(line => console.log(`   ${line}`));
}

function printSpecInfo({ type, id, name, specPath, logPath }) {
    const icon = type === 'research' ? '🔬' : type === 'feedback' ? '💬' : '📋';
    const idLabel = id !== undefined && id !== null ? String(id).padStart(2, '0') : null;
    const header = idLabel ? `${type} ${idLabel}` : type;
    const title = name ? ` - ${name}` : '';

    console.log(`\n${icon} ${header}${title}`);
    if (specPath) console.log(`   Spec: ${specPath}`);
    if (logPath) console.log(`   Log:  ${logPath}`);
}

function printError(type, id, details = '') {
    const idPart = id !== undefined && id !== null ? ` "${id}"` : '';
    const suffix = details ? `\n\n${details}` : '';
    console.error(`❌ Could not find ${type}${idPart}.${suffix}`);
}

function createSpecFile({
    input,
    usage,
    example,
    inboxDir,
    existsLabel,
    build
}) {
    if (!input) {
        const exampleText = example ? `\nExample: ${example}` : '';
        console.error(`Usage: ${usage}${exampleText}`);
        return null;
    }

    if (!fs.existsSync(inboxDir)) {
        fs.mkdirSync(inboxDir, { recursive: true });
    }

    const built = build(input);
    if (fs.existsSync(built.filePath)) {
        console.error(`❌ ${existsLabel} already exists: ${built.filename}`);
        return null;
    }

    fs.writeFileSync(built.filePath, built.content);
    console.log(`✅ Created: ./${path.relative(process.cwd(), built.filePath)}`);
    openInEditor(built.filePath);
    if (built.nextMessage) {
        console.log(built.nextMessage);
    }
    return built;
}

function setupWorktreeEnvironment(worktreePath, options) {
    const {
        featureId,
        agentId,
        desc,
        profile,
        logsDirPath
    } = options;

    const envLocalPath = path.join(process.cwd(), '.env.local');
    const agentMeta = AGENT_CONFIGS[agentId] || {};
    const paddedFeatureId = String(featureId).padStart(2, '0');

    if (profile.devServer.enabled) {
        const port = profile.devServer.ports[agentId] || agentMeta.port || 3000;
        const appId = getAppId();
        const serverId = `${agentId}-${featureId}`;
        const devUrl = getDevProxyUrl(appId, serverId);
        let envContent = '';
        if (fs.existsSync(envLocalPath)) {
            envContent = fs.readFileSync(envLocalPath, 'utf8').trimEnd() + '\n\n';
        }
        envContent += `# Fleet config for agent ${agentId}\n`;
        envContent += `PORT=${port}\n`;
        envContent += `AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        envContent += `AIGON_DEV_URL=${devUrl}\n`;
        envContent += `NEXT_PUBLIC_AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `NEXT_PUBLIC_AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_DEV_URL=${devUrl}\n`;
        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
        console.log(`   📋 .env.local created with PORT=${port}, banner vars, dev URL`);
    } else if (fs.existsSync(envLocalPath)) {
        let envContent = fs.readFileSync(envLocalPath, 'utf8').trimEnd() + '\n\n';
        envContent += `# Fleet config for agent ${agentId}\n`;
        envContent += `AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
        envContent += `NEXT_PUBLIC_AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
        envContent += `NEXT_PUBLIC_AIGON_FEATURE_ID=${paddedFeatureId}\n`;
        fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
        console.log(`   📋 .env.local created with banner vars (no PORT — dev server not used)`);
    }

    try {
        execSync(`aigon install-agent ${agentId}`, { cwd: worktreePath, stdio: 'pipe' });
        console.log(`   🔧 Installed ${agentId} commands in worktree`);
    } catch (installErr) {
        console.warn(`   ⚠️  Failed to install ${agentId} commands in worktree: ${installErr.message}`);
    }

    if (agentId === 'cc') {
        try {
            const localSettingsPath = path.join(worktreePath, '.claude', 'settings.local.json');
            let localSettings = {};
            if (fs.existsSync(localSettingsPath)) {
                localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf8'));
            }
            const agentLabel = AGENT_CONFIGS[agentId]?.name || agentId;
            const title = `Feature #${paddedFeatureId} - ${agentLabel}`;
            localSettings.hooks = {
                ...(localSettings.hooks || {}),
                Notification: [{
                    matcher: '',
                    hooks: [{
                        type: 'command',
                        command: `osascript -e 'display notification "Agent needs your attention" with title "${title}"'`
                    }]
                }]
            };
            fs.writeFileSync(localSettingsPath, JSON.stringify(localSettings, null, 2));
            console.log(`   🔔 Notification hook added for ${agentLabel}`);
        } catch (hookErr) {
            console.warn(`   ⚠️  Could not add notification hook: ${hookErr.message}`);
        }
    }

    if (!fs.existsSync(logsDirPath)) {
        fs.mkdirSync(logsDirPath, { recursive: true });
    }
    const logName = `feature-${featureId}-${agentId}-${desc}-log.md`;
    const logPath = path.join(logsDirPath, logName);
    const nowIso = new Date().toISOString();
    const template = `---\nstatus: implementing\nupdated: ${nowIso}\n---\n\n# Implementation Log: Feature ${featureId} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
    fs.writeFileSync(logPath, template);
    console.log(`   📝 Log: docs/specs/features/logs/${logName}`);
}

function ensureAgentSessions(entityId, agents, options) {
    const {
        sessionNameBuilder,
        cwdBuilder,
        commandBuilder
    } = options;

    return agents.map(agent => {
        const sessionName = sessionNameBuilder(entityId, agent);
        if (tmuxSessionExists(sessionName)) {
            return { agent, sessionName, created: false, error: null };
        }
        try {
            createDetachedTmuxSession(sessionName, cwdBuilder(entityId, agent));
            const command = commandBuilder ? commandBuilder(entityId, agent) : null;
            if (command) {
                spawnSync('tmux', ['send-keys', '-t', sessionName, command, 'Enter'], { stdio: 'pipe' });
            }
            return { agent, sessionName, created: true, error: null };
        } catch (error) {
            return { agent, sessionName, created: false, error };
        }
    });
}

function resolveDevServerUrl(context = detectDevServerContext(), proxyAvailable = isProxyAvailable()) {
    if (proxyAvailable) {
        return getDevProxyUrl(context.appId, context.serverId);
    }

    const envLocalPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envLocalPath)) {
        const content = fs.readFileSync(envLocalPath, 'utf8');
        const match = content.match(/^PORT=(\d+)/m);
        if (match) {
            return `http://localhost:${match[1]}`;
        }
    }

    const projectConfig = loadProjectConfig();
    const devProxy = projectConfig.devProxy || {};
    const basePort = devProxy.basePort || 3000;
    const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
    const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;
    return `http://localhost:${basePort + offset}`;
}

function organizeLogFiles(featureNum, winnerAgentId) {
    const logsRoot = path.join(PATHS.features.root, 'logs');
    const selectedDir = path.join(logsRoot, 'selected');
    const alternativesDir = path.join(logsRoot, 'alternatives');
    if (!fs.existsSync(logsRoot)) return;
    if (!fs.existsSync(selectedDir)) fs.mkdirSync(selectedDir, { recursive: true });
    if (!fs.existsSync(alternativesDir)) fs.mkdirSync(alternativesDir, { recursive: true });
    const files = fs.readdirSync(logsRoot);
    console.log("\n📁 Organizing Log Files...");
    files.forEach(file => {
        if (fs.lstatSync(path.join(logsRoot, file)).isDirectory()) return;
        if (!file.startsWith(`feature-${featureNum}-`)) return;
        const srcPath = path.join(logsRoot, file);
        // In multi-agent mode, winner has agent ID in filename
        // In drive mode, there's no agent ID so it's always the winner
        const isWinner = !winnerAgentId || file.includes(`-${winnerAgentId}-`) || file.includes(`-${winnerAgentId}.`) || file === `feature-${featureNum}-log.md`;
        if (isWinner) {
            const destPath = path.join(selectedDir, file);
            fs.renameSync(srcPath, destPath);
            console.log(`   ⭐ Selected: ${file} -> logs/selected/`);
        } else {
            const destPath = path.join(alternativesDir, file);
            fs.renameSync(srcPath, destPath);
            console.log(`   📁 Alternative: ${file} -> logs/alternatives/`);
        }
    });
}

function runGit(command, options = {}) {
    console.log(`Running git: ${command}`);
    try {
        execSync(command, { stdio: 'inherit', ...options });
    } catch (e) {
        console.error("❌ Git command failed.");
        throw e; // Re-throw so callers can handle the failure
    }
}

/**
 * Set terminal tab/window title using ANSI escape sequences.
 * Works in most terminals including Warp, iTerm2, Terminal.app, etc.
 * @param {string} title - The title to set
 */
function setTerminalTitle(title) {
    // Only set title if we're in an interactive terminal (not piped)
    if (process.stdout.isTTY) {
        // OSC 0 = set icon name and window title
        // ESC ] 0 ; <title> BEL
        process.stdout.write(`\x1b]0;${title}\x07`);
    }
}

function safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

// Returns 'created', 'updated', or 'unchanged'
function safeWriteWithStatus(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (existing === content) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, content);
        return 'updated';
    }
    fs.writeFileSync(filePath, content);
    return 'created';
}

// Get the Aigon CLI version from package.json
function getAigonVersion() {
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
    }
    return null;
}

// Get/set the installed version for a project
const VERSION_FILE = '.aigon/version';

function getInstalledVersion() {
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    if (fs.existsSync(versionPath)) {
        return fs.readFileSync(versionPath, 'utf8').trim();
    }
    return null;
}

function setInstalledVersion(version) {
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    safeWrite(versionPath, version);
}

// Parse changelog and return entries between two versions
function getChangelogEntriesSince(fromVersion) {
    const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) {
        return [];
    }

    const content = fs.readFileSync(changelogPath, 'utf8');
    const entries = [];

    // Split by version headers: ## [x.y.z]
    const versionPattern = /^## \[(\d+\.\d+\.\d+)\]/gm;
    const sections = content.split(versionPattern);

    // sections alternates: [preamble, version1, content1, version2, content2, ...]
    for (let i = 1; i < sections.length; i += 2) {
        const version = sections[i];
        let body = sections[i + 1] || '';

        // Remove the date suffix (e.g., " - 2026-02-02") from the start of body
        body = body.replace(/^\s*-\s*\d{4}-\d{2}-\d{2}\s*/, '').trim();

        // Stop if we've reached fromVersion or older
        if (fromVersion && compareVersions(version, fromVersion) <= 0) {
            break;
        }

        entries.push({ version, body });
    }

    return entries;
}

// Compare semver versions: returns >0 if a > b, <0 if a < b, 0 if equal
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

function removeDeprecatedCommands(cmdDir, config) {
    if (!fs.existsSync(cmdDir)) return [];

    const prefix = config.output.commandFilePrefix;
    const ext = config.output.commandFileExtension;
    const expectedFiles = new Set(
        config.commands.map(cmd => `${prefix}${cmd}${ext}`)
    );

    const removed = [];
    for (const file of fs.readdirSync(cmdDir)) {
        if (!file.startsWith(prefix) || !file.endsWith(ext)) continue;
        if (expectedFiles.has(file)) continue;
        try {
            fs.unlinkSync(path.join(cmdDir, file));
            removed.push(file);
        } catch (e) {
            console.warn(`   ⚠️  Could not remove deprecated command ${file}: ${e.message}`);
        }
    }
    return removed;
}

// Clean up old flat commands when an agent migrates to subdirectory layout
// e.g., CC moved from .claude/commands/aigon-*.md to .claude/commands/aigon/*.md
function migrateOldFlatCommands(cmdDir, config) {
    const parentDir = path.dirname(cmdDir);
    // Only migrate if commands are in a subdirectory (not already at root level)
    if (parentDir === cmdDir || !fs.existsSync(parentDir)) return [];

    const ext = config.output.commandFileExtension;
    const subDirName = path.basename(cmdDir);
    const oldPrefix = `${subDirName}-`;

    const migrated = [];
    try {
        for (const file of fs.readdirSync(parentDir)) {
            if (!file.startsWith(oldPrefix) || !file.endsWith(ext)) continue;
            // Check the command name matches one we know about
            const cmdName = file.slice(oldPrefix.length, -ext.length);
            if (!config.commands.includes(cmdName)) continue;
            try {
                fs.unlinkSync(path.join(parentDir, file));
                migrated.push(file);
            } catch (e) {
                console.warn(`   ⚠️  Could not remove old command ${file}: ${e.message}`);
            }
        }
    } catch (e) {
        // Parent dir not readable, skip migration
    }
    return migrated;
}

// Append or replace content between markers in a file
const MARKER_START = '<!-- AIGON_START -->';
const MARKER_END = '<!-- AIGON_END -->';

function upsertMarkedContent(filePath, content) {
    const markedContent = `${MARKER_START}\n${content}\n${MARKER_END}`;

    if (!fs.existsSync(filePath)) {
        safeWrite(filePath, markedContent);
        return 'created';
    }

    const existing = fs.readFileSync(filePath, 'utf8');
    const markerRegex = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, 'g');

    if (markerRegex.test(existing)) {
        // Replace existing marked section
        const updated = existing.replace(markerRegex, markedContent);
        if (updated === existing) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, updated);
        return 'updated';
    } else {
        // Append to end of file
        fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + markedContent + '\n');
        return 'appended';
    }
}

// Read template file from templates directory
function readTemplate(relativePath) {
    const templatePath = path.join(TEMPLATES_ROOT, relativePath);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${relativePath}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
}

// --- Generic Template System ---

// Load agent config from templates/agents/<id>.json
function loadAgentConfig(agentId) {
    const configPath = path.join(TEMPLATES_ROOT, 'agents', `${agentId}.json`);
    if (!fs.existsSync(configPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Get list of all available agents by scanning templates/agents/
function getAvailableAgents() {
    const agentsDir = path.join(TEMPLATES_ROOT, 'agents');
    if (!fs.existsSync(agentsDir)) return [];
    return fs.readdirSync(agentsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

// Build alias map dynamically from all agent configs
function buildAgentAliasMap() {
    const aliasMap = {};
    getAvailableAgents().forEach(agentId => {
        const config = loadAgentConfig(agentId);
        if (config && config.aliases) {
            config.aliases.forEach(alias => {
                aliasMap[alias.toLowerCase()] = agentId;
            });
        }
    });
    return aliasMap;
}

// Replace placeholders in template content
function processTemplate(content, placeholders) {
    let result = content;
    Object.entries(placeholders).forEach(([key, value]) => {
        // Match {{KEY}} pattern (our placeholder syntax)
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, () => value);
    });
    return result;
}

// Read generic template and process with agent config
function readGenericTemplate(templateName, agentConfig) {
    const templatePath = path.join(TEMPLATES_ROOT, 'generic', templateName);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Generic template not found: ${templateName}`);
    }
    const content = fs.readFileSync(templatePath, 'utf8');
    return processTemplate(content, agentConfig.placeholders);
}

// Extract description from template's HTML comment
function extractDescription(content) {
    const match = content.match(/<!--\s*description:\s*(.+?)\s*-->/);
    return match ? match[1].trim() : '';
}

const COMMAND_REGISTRY = {
    'feature-create': { aliases: ['afc'], argHints: '<feature-name>' },
    'feature-now': { aliases: ['afn'], argHints: '<existing-feature-name> OR <feature-description>' },
    'feature-prioritise': { aliases: ['afp'], argHints: '<feature-name or letter>' },
    'feature-setup': { aliases: ['afse'], argHints: '<ID> [agents...]' },
    'feature-do': { aliases: ['afd'], argHints: '<ID> [--agent=<cc|gg|cx|cu>] [--autonomous] [--max-iterations=N] [--auto-submit] [--no-auto-submit] [--dry-run]' },
    'feature-submit': { aliases: ['afs'] },
    'feature-validate': { argHints: '<ID> [--dry-run] [--no-update]', disableModelInvocation: true },
    'feature-eval': { aliases: ['afe'], argHints: '<ID> [--allow-same-model-judge] [--force]' },
    'feature-review': { aliases: ['afr'], argHints: '<ID>' },
    'feature-close': { aliases: ['afcl'], argHints: '<ID> [agent] [--adopt <agents...|all>]', disableModelInvocation: true },
    'feature-cleanup': { argHints: '<ID> [--push]', disableModelInvocation: true },
    'feature-autopilot': { aliases: ['afap'], argHints: '<feature-id> [agents...] | status [feature-id] | stop [feature-id] | attach <feature-id> <agent>' },
    'board': { aliases: ['ab'], argHints: '[--list] [--features] [--research] [--active] [--all] [--inbox] [--backlog] [--done] [--no-actions]' },
    'worktree-open': { argHints: '[ID] [agent]' },
    'sessions-close': { argHints: '<ID>' },
    'research-create': { aliases: ['arc'], argHints: '<topic-name>' },
    'research-prioritise': { aliases: ['arp'], argHints: '<topic-name or letter>' },
    'research-setup': { aliases: ['arse'], argHints: '<ID> [agents...]' },
    'research-open': { aliases: ['aro'] },
    'research-do': { aliases: ['ard'], argHints: '<ID>' },
    'research-submit': { aliases: ['arsb'], argHints: '' },
    'research-synthesize': { aliases: ['ars'], argHints: '<ID> [--force]' },
    'research-close': { aliases: ['arcl'], argHints: '<ID>' },
    'research-autopilot': { aliases: ['arap'], argHints: '<research-id> [agents...] | status [research-id] | stop [research-id]' },
    'feedback-create': { aliases: ['afbc'], argHints: '<title>' },
    'feedback-list': { aliases: ['afbl'], argHints: '[--inbox|--triaged|--actionable|--done|--wont-fix|--duplicate|--all] [--type <type>] [--severity <severity>] [--tag <tag>]' },
    'feedback-triage': { aliases: ['afbt'], argHints: '<ID> [--type <type>] [--severity <severity|none>] [--tags <csv|none>] [--status <status>] [--duplicate-of <ID|none>] [--action <keep|mark-duplicate|promote-feature|promote-research|wont-fix>] [--apply] [--yes]' },
    'dev-server': { aliases: ['ads'] },
    'conductor': { argHints: '<start|stop|status|add|remove|list|vscode-install|vscode-uninstall> [path]', disableModelInvocation: true },
    'radar': { argHints: '<start|stop|status|install|uninstall|add|remove|list|open|menubar-install|menubar-uninstall|menubar-render> [path]', disableModelInvocation: true },
    'dashboard': { argHints: '[--port <N>] [--no-open] [--screenshot] [--output <path>] [--width <N>] [--height <N>]', disableModelInvocation: true },
    'agent-status': { argHints: '<implementing|waiting|submitted>', disableModelInvocation: true },
    'status': { argHints: '[ID]', disableModelInvocation: true },
    'deploy': { aliases: ['ad'], argHints: '[--preview]', disableModelInvocation: true },
    'help': { aliases: ['ah'], argHints: '' },
    'next': { aliases: ['an'], argHints: '' },
};

const COMMAND_ALIASES = {};
const COMMAND_ALIAS_REVERSE = {};
const COMMAND_ARG_HINTS = {};
const COMMANDS_DISABLE_MODEL_INVOCATION = new Set();

Object.entries(COMMAND_REGISTRY).forEach(([commandName, definition]) => {
    const aliases = Array.isArray(definition.aliases) ? definition.aliases : [];
    aliases.forEach(alias => {
        COMMAND_ALIASES[alias] = commandName;
    });
    if (definition.argHints !== undefined) {
        COMMAND_ARG_HINTS[commandName] = definition.argHints;
    }
    if (definition.disableModelInvocation) {
        COMMANDS_DISABLE_MODEL_INVOCATION.add(commandName);
    }
});

Object.entries(COMMAND_ALIASES).forEach(([alias, commandName]) => {
    if (!COMMAND_ALIAS_REVERSE[commandName]) COMMAND_ALIAS_REVERSE[commandName] = [];
    COMMAND_ALIAS_REVERSE[commandName].push(alias);
});

// Format command output based on agent's output format
function formatCommandOutput(content, description, commandName, agentConfig) {
    const output = agentConfig.output;

    // Remove the description comment from the content
    const cleanContent = content.replace(/<!--\s*description:.*?-->\n?/, '');

    if (output.format === 'markdown') {
        // Generate frontmatter
        const frontmatterFields = output.frontmatter || ['description'];
        const frontmatterLines = [];
        if (frontmatterFields.includes('description')) {
            frontmatterLines.push(`description: ${description}`);
        }
        if (frontmatterFields.includes('argument-hint')) {
            const hint = COMMAND_ARG_HINTS[commandName];
            if (hint) {
                frontmatterLines.push(`argument-hint: "${hint}"`);
            }
        }
        if (frontmatterFields.includes('disable-model-invocation')) {
            if (COMMANDS_DISABLE_MODEL_INVOCATION.has(commandName)) {
                frontmatterLines.push('disable-model-invocation: true');
            }
        }
        if (frontmatterFields.includes('args')) {
            const hint = COMMAND_ARG_HINTS[commandName] || '';
            frontmatterLines.push(`args: ${hint || 'none'}`);
        }
        return `---\n${frontmatterLines.join('\n')}\n---\n${cleanContent}`;
    }
    else if (output.format === 'toml') {
        return `name = "${commandName}"
description = "${description}"
prompt = """
${cleanContent.trim()}
"""
`;
    }
    else if (output.format === 'plain') {
        // Plain markdown with no frontmatter (Cursor)
        return cleanContent;
    }

    return cleanContent;
}

// --- Agent Configuration (Legacy - for backwards compatibility) ---

const AGENT_CONFIGS = {
    cc: {
        id: 'cc',
        name: 'Claude',
        rootFile: 'CLAUDE.md',
        supportsAgentsMd: false,
        agentFile: 'claude.md',
        templatePath: 'docs/agents/claude.md',
        port: 3001,
        terminalColor: 'blue',     // Warp tab color
        bannerColor: '#3B82F6'     // Browser banner hex color
    },
    gg: {
        id: 'gg',
        name: 'Gemini',
        rootFile: null,  // Gemini reads AGENTS.md
        supportsAgentsMd: true,
        agentFile: 'gemini.md',
        templatePath: 'docs/agents/gemini.md',
        port: 3002,
        terminalColor: 'green',
        bannerColor: '#22C55E'
    },
    cx: {
        id: 'cx',
        name: 'Codex',
        rootFile: null,  // Codex reads AGENTS.md
        supportsAgentsMd: true,
        agentFile: 'codex.md',
        templatePath: 'docs/agents/codex.md',
        port: 3003,
        terminalColor: 'magenta',
        bannerColor: '#A855F7'
    },
    cu: {
        id: 'cu',
        name: 'Cursor',
        rootFile: null,  // Cursor reads AGENTS.md
        supportsAgentsMd: true,
        agentFile: 'cursor.md',
        templatePath: 'docs/agents/cursor.md',
        port: 3004,
        terminalColor: 'yellow',
        bannerColor: '#F97316'
    }
};

// Generate scaffold content for new root instruction files (e.g. AGENTS.md, CLAUDE.md)
// Only used on first creation — users fill in the sections, which are preserved on update
function getScaffoldContent() {
    return readTemplate('scaffold.md');
}

function getRootFileContent(agentConfig) {
    const template = readTemplate('root-file.md');
    return processTemplate(template, {
        AGENT_NAME: agentConfig.name,
        AGENT_FILE: agentConfig.agentFile
    });
}

function syncAgentsMdFile() {
    const agentsFilePath = path.join(process.cwd(), 'AGENTS.md');
    const agentsTemplate = readTemplate('generic/agents-md.md');
    const markerContentMatch = agentsTemplate.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
    const agentsContent = markerContentMatch ? markerContentMatch[1] : agentsTemplate;

    if (!fs.existsSync(agentsFilePath)) {
        const markedContent = `${MARKER_START}\n${agentsContent}\n${MARKER_END}`;
        safeWrite(agentsFilePath, getScaffoldContent() + markedContent + '\n');
        return 'created';
    }

    return upsertMarkedContent(agentsFilePath, agentsContent);
}

// --- Board Display Helpers ---

function collectBoardItems(typeConfig, folderFilter) {
    const items = {};
    typeConfig.folders.forEach(folder => {
        if (!folderFilter.has(folder)) return;
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith(typeConfig.prefix + '-') && f.endsWith('.md'))
            .sort();

        items[folder] = files.map(file => {
            const idMatch = file.match(new RegExp(`^${typeConfig.prefix}-(\\d+)-(.*)\.md$`));
            const noIdMatch = !idMatch && file.match(new RegExp(`^${typeConfig.prefix}-(.*)\.md$`));
            if (!idMatch && !noIdMatch) return null;

            return {
                id: idMatch ? idMatch[1] : null,
                name: idMatch ? idMatch[2] : noIdMatch[1],
                file
            };
        }).filter(Boolean);
    });
    return items;
}

function getWorktreeInfo() {
    const worktreeMap = {}; // featureNum -> [{ path, agent }]
    try {
        const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
        wtOutput.split('\n').forEach(line => {
            const wtMatch = line.match(/^([^\s]+)\s+/);
            if (!wtMatch) return;
            const wtPath = wtMatch[1];

            // Match feature worktrees
            const featureMatch = wtPath.match(/feature-(\d+)-(\w+)-(.+)$/);
            if (featureMatch) {
                const fNum = featureMatch[1];
                const agent = featureMatch[2];
                if (!worktreeMap[fNum]) worktreeMap[fNum] = [];
                worktreeMap[fNum].push({ path: wtPath, agent, type: 'feature' });
            }

            // Match research worktrees
            const researchMatch = wtPath.match(/research-(\d+)-(\w+)-(.+)$/);
            if (researchMatch) {
                const rNum = researchMatch[1];
                const agent = researchMatch[2];
                if (!worktreeMap[rNum]) worktreeMap[rNum] = [];
                worktreeMap[rNum].push({ path: wtPath, agent, type: 'research' });
            }
        });
    } catch (e) {
        // Ignore worktree listing errors
    }
    return worktreeMap;
}

function getCurrentBranch() {
    try {
        return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch (e) {
        return '';
    }
}

function saveBoardMapping(mapping) {
    const mappingDir = path.join(process.cwd(), '.aigon');
    const mappingPath = path.join(mappingDir, '.board-map.json');
    if (!fs.existsSync(mappingDir)) fs.mkdirSync(mappingDir, { recursive: true });
    try {
        fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
    } catch (e) {
        // Silently fail
    }
}

function loadBoardMapping() {
    const mappingPath = path.join(process.cwd(), '.aigon', '.board-map.json');
    if (!fs.existsSync(mappingPath)) return null;
    try {
        const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
        const age = Date.now() - (mapping.timestamp || 0);
        if (age > 24 * 60 * 60 * 1000) return null; // Expired
        return mapping;
    } catch (e) {
        return null;
    }
}

/**
 * Get the suggested next CLI action for a board item.
 * @param {string} typePrefix - 'feature' or 'research'
 * @param {string} folder - Stage folder (e.g. '01-inbox', '03-in-progress')
 * @param {Object} item - { id, name }
 * @param {Object} worktreeMap - Map of id -> [{path, agent}]
 * @returns {string|null} Slash command string, or null if no action applies
 */
function getBoardAction(typePrefix, folder, item, worktreeMap) {
    const { id, name } = item;

    if (folder === '01-inbox') {
        if (typePrefix === 'feature') return `/afn ${name}`;
        if (typePrefix === 'research') return `/arp ${name}`;
    }

    if (folder === '02-backlog' && id) {
        if (typePrefix === 'feature') return `/afse ${id}`;
        if (typePrefix === 'research') return `/arse ${id}`;
    }

    if (folder === '03-in-progress' && id) {
        const wts = worktreeMap[id] || [];
        if (typePrefix === 'feature') {
            return wts.length >= 2 ? `/afe ${id}` : `/afd ${id}`;
        }
        if (typePrefix === 'research') {
            return wts.length >= 2 ? `/ars ${id}` : `/ardn ${id}`;
        }
    }

    if (folder === '04-in-evaluation' && typePrefix === 'feature' && id) {
        return `/afd ${id}`;
    }

    return null;
}

function displayBoardKanbanView(options) {
    const { includeFeatures, includeResearch, showAll, showActive, showInbox, showBacklog, showDone } = options;

    const boardMapping = { features: {}, research: {}, timestamp: Date.now() };
    let letterIndex = 0;

    console.log('╔═══════════════════════ Aigon Board ════════════════════════╗\n');

    if (includeFeatures) {
        letterIndex = displayKanbanSection('FEATURES', PATHS.features, options, boardMapping.features, letterIndex);
    }

    if (includeResearch) {
        if (includeFeatures) console.log('');
        letterIndex = displayKanbanSection('RESEARCH', PATHS.research, options, boardMapping.research, letterIndex);
    }

    saveBoardMapping(boardMapping);
}

function displayKanbanSection(title, typeConfig, options, mapping = {}, startLetterIndex = 0) {
    const { showAll, showActive, showInbox, showBacklog, showDone, showActions } = options;
    const hasFilter = showAll || showActive || showInbox || showBacklog || showDone;
    let letterIndex = startLetterIndex;

    // Determine which folders to show
    const folderFilter = new Set();
    if (showAll) {
        typeConfig.folders.forEach(f => folderFilter.add(f));
    } else if (hasFilter) {
        if (showInbox) folderFilter.add('01-inbox');
        if (showBacklog) folderFilter.add('02-backlog');
        if (showActive) {
            folderFilter.add('03-in-progress');
            if (typeConfig.prefix === 'feature') folderFilter.add('04-in-evaluation');
            if (typeConfig.prefix === 'research') folderFilter.add('04-done');
        }
        if (showDone) {
            if (typeConfig.prefix === 'feature') folderFilter.add('05-done');
            if (typeConfig.prefix === 'research') folderFilter.add('04-done');
        }
    } else {
        // Default: everything except done
        typeConfig.folders.forEach(f => {
            if (typeConfig.prefix === 'feature' && f !== '05-done') folderFilter.add(f);
            if (typeConfig.prefix === 'research' && f !== '04-done') folderFilter.add(f);
        });
    }

    const items = collectBoardItems(typeConfig, folderFilter);
    const worktreeMap = getWorktreeInfo();
    const currentBranch = getCurrentBranch();

    // Folder labels for display
    const columnMap = {
        'feature': {
            '01-inbox': 'Inbox',
            '02-backlog': 'Backlog',
            '03-in-progress': 'In Progress',
            '04-in-evaluation': 'Evaluation',
            '05-done': 'Done',
            '06-paused': 'Paused'
        },
        'research': {
            '01-inbox': 'Inbox',
            '02-backlog': 'Backlog',
            '03-in-progress': 'In Progress',
            '04-done': 'Done',
            '05-paused': 'Paused'
        }
    };

    const columns = columnMap[typeConfig.prefix];
    const candidateFolders = typeConfig.folders.filter(f => folderFilter.has(f));

    // Auto-collapse: only show columns with items
    const displayFolders = candidateFolders.filter(f => {
        const folderItems = items[f] || [];
        return folderItems.length > 0;
    });

    // Skip section entirely if no items
    if (displayFolders.length === 0) {
        return;
    }

    console.log(`${title}`);

    // Dynamic column width based on terminal size
    const terminalWidth = process.stdout.columns || 120;
    const numCols = displayFolders.length;
    const bordersAndPadding = (numCols * 3) + 4; // │ separators + margins
    const availableWidth = terminalWidth - bordersAndPadding;
    const calculatedWidth = Math.floor(availableWidth / numCols);
    const colWidth = Math.max(12, Math.min(30, calculatedWidth)); // Min 12, max 30

    const header = displayFolders.map(f => (columns[f] || f).padEnd(colWidth).substring(0, colWidth)).join(' │ ');
    const separator = displayFolders.map(() => '─'.repeat(colWidth)).join('─┼─');

    console.log('┌─' + separator + '─┐');
    console.log('│ ' + header + ' │');
    console.log('├─' + separator + '─┤');

    // Find max rows
    const maxRows = Math.max(...displayFolders.map(f => (items[f] || []).length), 0);

    // Display rows
    for (let i = 0; i < maxRows; i++) {
        const row = displayFolders.map(folder => {
            const folderItems = items[folder] || [];
            if (i >= folderItems.length) return ''.padEnd(colWidth);

            const item = folderItems[i];
            let display = item.id ? `#${item.id} ${item.name}` : item.name;

            // Add letter label for unprioritized inbox items
            if (folder === '01-inbox' && !item.id) {
                const letter = String.fromCharCode(97 + letterIndex);
                display = `${letter}) ${display}`;
                mapping[letter] = item.name;
                letterIndex++;
            }

            // Add worktree/mode indicator for in-progress items
            if (folder === '03-in-progress' && item.id) {
                const wts = worktreeMap[item.id] || [];
                if (wts.length > 1) {
                    // Fleet mode - show [F] with agent count
                    display += ` [F:${wts.length}]`;
                } else if (wts.length === 1) {
                    // Single worktree — check if autopilot (ralph-progress file exists)
                    const progressFile = path.join(PATHS.features.root, 'logs', `feature-${item.id}-ralph-progress.md`);
                    if (fs.existsSync(progressFile)) {
                        display += ' [AP]';
                    } else {
                        display += ' [wt]';
                    }
                } else {
                    // Drive branch - check if it's current
                    const branchName = `${typeConfig.prefix}-${item.id}-${item.name}`;
                    if (currentBranch === branchName) {
                        display += ' *';
                    }
                }
            }

            // Truncate to fit column
            return display.padEnd(colWidth).substring(0, colWidth);
        }).join(' │ ');

        console.log('│ ' + row + ' │');
    }

    // Display counts
    const counts = displayFolders.map(f => {
        const count = (items[f] || []).length;
        return `(${count})`.padEnd(colWidth).substring(0, colWidth);
    }).join(' │ ');

    console.log('├─' + separator + '─┤');
    console.log('│ ' + counts + ' │');
    console.log('└─' + separator + '─┘');

    // Next actions block
    if (showActions) {
        const actionLines = [];
        displayFolders.forEach(folder => {
            (items[folder] || []).forEach(item => {
                const action = getBoardAction(typeConfig.prefix, folder, item, worktreeMap);
                if (!action) return;
                const label = item.id ? `#${item.id} ${item.name}` : item.name;
                actionLines.push(`  ${label.padEnd(26)} → ${action}`);
            });
        });
        if (actionLines.length > 0) {
            console.log('\nNext actions:');
            actionLines.forEach(l => console.log(l));
        }
    }

    return letterIndex;
}

function displayBoardListView(options) {
    const { includeFeatures, includeResearch, showAll, showActive, showInbox, showBacklog, showDone } = options;

    if (includeFeatures) {
        displayListSection('FEATURES', PATHS.features, options);
    }

    if (includeResearch) {
        if (includeFeatures) console.log(''); // Spacing
        displayListSection('RESEARCH', PATHS.research, options);
    }
}

function displayListSection(title, typeConfig, options) {
    const { showAll, showActive, showInbox, showBacklog, showDone, showActions } = options;
    const hasFilter = showAll || showActive || showInbox || showBacklog || showDone;

    // Determine which folders to show
    const folderFilter = new Set();
    if (showAll) {
        typeConfig.folders.forEach(f => folderFilter.add(f));
    } else if (hasFilter) {
        if (showInbox) folderFilter.add('01-inbox');
        if (showBacklog) folderFilter.add('02-backlog');
        if (showActive) {
            folderFilter.add('03-in-progress');
            if (typeConfig.prefix === 'feature') folderFilter.add('04-in-evaluation');
            if (typeConfig.prefix === 'research') folderFilter.add('04-done');
        }
        if (showDone) {
            if (typeConfig.prefix === 'feature') folderFilter.add('05-done');
            if (typeConfig.prefix === 'research') folderFilter.add('04-done');
        }
    } else {
        // Default: everything except done
        typeConfig.folders.forEach(f => {
            if (typeConfig.prefix === 'feature' && f !== '05-done') folderFilter.add(f);
            if (typeConfig.prefix === 'research' && f !== '04-done') folderFilter.add(f);
        });
    }

    const folderLabels = {
        '01-inbox': 'Inbox',
        '02-backlog': 'Backlog',
        '03-in-progress': 'In Progress',
        '04-in-evaluation': 'In Evaluation',
        '04-done': 'Done',
        '05-done': 'Done',
        '06-paused': 'Paused',
        '05-paused': 'Paused'
    };

    const worktreeMap = getWorktreeInfo();
    const currentBranch = getCurrentBranch();

    const divider = '─'.repeat(56);
    console.log(`${title}\n${divider}`);

    let totalCount = 0;

    typeConfig.folders.forEach(folder => {
        if (!folderFilter.has(folder)) return;
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith(typeConfig.prefix + '-') && f.endsWith('.md'))
            .sort();

        if (files.length === 0) return;

        const label = folderLabels[folder] || folder;
        console.log(`\n${label} (${files.length})`);

        files.forEach(file => {
            const idMatch = file.match(new RegExp(`^${typeConfig.prefix}-(\\d+)-(.*)\.md$`));
            const noIdMatch = !idMatch && file.match(new RegExp(`^${typeConfig.prefix}-(.*)\.md$`));
            if (!idMatch && !noIdMatch) return;

            const itemId = idMatch ? idMatch[1] : null;
            const itemName = idMatch ? idMatch[2] : noIdMatch[1];
            totalCount++;

            let detail = '';

            if (folder === '03-in-progress' && itemId) {
                const wts = worktreeMap[itemId] || [];
                if (wts.length === 0) {
                    // Drive branch mode
                    const branchName = `${typeConfig.prefix}-${itemId}-${itemName}`;
                    let branchExists = false;
                    try {
                        execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
                        branchExists = true;
                    } catch (e) {
                        // Branch doesn't exist
                    }
                    const active = currentBranch === branchName ? ' *' : '';
                    detail = branchExists ? `  Drive${active}` : '';
                } else if (wts.length === 1) {
                    // Single worktree — check if autopilot
                    const progressFile = path.join(PATHS.features.root, 'logs', `feature-${itemId}-ralph-progress.md`);
                    const apLabel = fs.existsSync(progressFile) ? 'Autopilot' : 'Drive-wt';
                    detail = `  ${apLabel} (${wts[0].agent})`;
                } else {
                    const agents = wts.map(w => w.agent).join(', ');
                    detail = `  Fleet (${agents})`;
                }
            }

            const prefix = itemId ? `#${String(itemId).padStart(2, '0')}` : '   ';
            const itemLine = `  ${prefix}  ${itemName}${detail}`;

            if (showActions) {
                const action = getBoardAction(typeConfig.prefix, folder, { id: itemId, name: itemName }, worktreeMap);
                if (action) {
                    const pad = Math.max(2, 58 - itemLine.length);
                    console.log(itemLine + ' '.repeat(pad) + action);
                } else {
                    console.log(itemLine);
                }
            } else {
                console.log(itemLine);
            }
        });
    });

    if (totalCount === 0) {
        console.log(`\nNo ${title.toLowerCase()} found.`);
    }
    console.log('');
}

// --- Gitignore Management ---

/**
 * Ensure .aigon/.board-map.json is in .gitignore
 * This file is regenerated by the board command and shouldn't be committed
 */
function ensureBoardMapInGitignore() {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    const entry = '.aigon/.board-map.json';
    
    // If .gitignore doesn't exist, create it
    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, `${entry}\n`);
        return;
    }
    
    // Read existing .gitignore
    let content = fs.readFileSync(gitignorePath, 'utf8');
    
    // Check if entry already exists
    const lines = content.split('\n');
    const hasEntry = lines.some(line => line.trim() === entry || line.trim() === '.aigon/');
    
    // If .aigon/ is already ignored, that covers .board-map.json
    if (hasEntry && content.includes('.aigon/')) {
        return;
    }
    
    // Add entry if not present
    if (!hasEntry) {
        // Add to end, ensuring newline
        if (!content.endsWith('\n')) {
            content += '\n';
        }
        content += `${entry}\n`;
        fs.writeFileSync(gitignorePath, content);
    }
}

// --- Ralph Loop Helpers ---

function formatTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseRalphProgress(progressContent) {
    const iterations = [];
    if (!progressContent) return iterations;

    const headerRegex = /^## Iteration (\d+) \(([^)]+)\)$/gm;
    const headers = [];
    let headerMatch;
    while ((headerMatch = headerRegex.exec(progressContent)) !== null) {
        headers.push({
            number: parseInt(headerMatch[1], 10),
            timestamp: headerMatch[2],
            index: headerMatch.index,
            headerTextLength: headerMatch[0].length
        });
    }

    headers.forEach((header, idx) => {
        const start = header.index + header.headerTextLength;
        const end = idx + 1 < headers.length ? headers[idx + 1].index : progressContent.length;
        const body = progressContent.slice(start, end);
        const statusMatch = body.match(/^\*\*Status:\*\*\s*(.+)$/m);
        const status = statusMatch ? statusMatch[1].trim() : 'Unknown';
        iterations.push({
            number: header.number,
            timestamp: header.timestamp,
            status,
            success: /^success$/i.test(status)
        });
    });

    return iterations;
}

function parseFeatureValidation(specContent) {
    // Extract commands from an optional "## Validation" section in the feature spec.
    // Accepts fenced bash blocks or plain indented/bullet lines.
    // Returns an array of command strings, or empty array if section absent.
    if (!specContent) return [];
    const sectionMatch = specContent.match(/^## Validation\s*\n([\s\S]*?)(?=^## |\Z)/m);
    if (!sectionMatch) return [];
    const body = sectionMatch[1];
    // Pull commands from fenced code block first
    const fencedMatch = body.match(/```(?:bash|sh|shell)?\n([\s\S]*?)\n```/);
    const rawText = fencedMatch ? fencedMatch[1] : body;
    return rawText
        .split('\n')
        .map(line => line.replace(/#.*$/, '').replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);
}

function detectNodePackageManager() {
    if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(process.cwd(), 'bun.lockb'))) return 'bun';
    return 'npm';
}

function detectNodeTestCommand() {
    if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm test';
    if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn test';
    if (fs.existsSync(path.join(process.cwd(), 'bun.lockb'))) return 'bun test';
    if (fs.existsSync(path.join(process.cwd(), 'package.json'))) return 'npm test';
    return null;
}

function detectValidationCommand(profileName, projectConfig = {}) {
    const configured = projectConfig?.autonomous?.validationCommand || projectConfig?.ralph?.validationCommand;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return configured.trim();
    }

    switch (profileName) {
        case 'ios':
            return 'xcodebuild test';
        case 'android':
            return './gradlew test';
        case 'web':
        case 'api':
        case 'library':
        case 'generic':
        default: {
            if (fs.existsSync(path.join(process.cwd(), 'Cargo.toml'))) return 'cargo test';
            if (fs.existsSync(path.join(process.cwd(), 'go.mod'))) return 'go test ./...';
            if (fs.existsSync(path.join(process.cwd(), 'pyproject.toml')) || fs.existsSync(path.join(process.cwd(), 'requirements.txt'))) return 'pytest';
            return detectNodeTestCommand();
        }
    }
}

function buildRalphPrompt({
    featureNum,
    featureDesc,
    iteration,
    maxIterations,
    profileValidations,
    featureValidationCommands,
    specContent,
    priorProgress,
    criteriaFeedback
}) {
    const validationLines = [];
    (profileValidations || []).forEach(({ label, cmd }) => validationLines.push(`  [${label}] ${cmd}`));
    featureValidationCommands.forEach(cmd => validationLines.push(`  [Feature] ${cmd}`));
    const validationBlock = validationLines.length
        ? validationLines.join('\n')
        : '  (none configured — loop will mark success automatically)';

    const criteriaSection = criteriaFeedback
        ? `\nCriteria feedback from previous iteration (items that still need attention):\n${criteriaFeedback}\n`
        : '';

    const template = readTemplate('prompts/ralph-iteration.txt');
    return processTemplate(template, {
        ITERATION: String(iteration),
        MAX_ITERATIONS: String(maxIterations),
        FEATURE_NUM: String(featureNum),
        FEATURE_DESC: String(featureDesc),
        CRITERIA_SECTION: criteriaSection,
        VALIDATION_BLOCK: validationBlock,
        SPEC_CONTENT: specContent,
        PRIOR_PROGRESS: priorProgress || '(no prior progress)'
    });
}

function getCurrentHead() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

function getGitStatusPorcelain() {
    try {
        return execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    } catch (e) {
        return '';
    }
}

function getChangedFilesInRange(fromSha, toSha) {
    if (!fromSha || !toSha || fromSha === toSha) {
        return [];
    }
    try {
        const output = execSync(`git diff --name-only ${fromSha}..${toSha}`, { encoding: 'utf8' }).trim();
        if (!output) return [];
        return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function getCommitSummariesInRange(fromSha, toSha) {
    if (!fromSha || !toSha || fromSha === toSha) {
        return [];
    }
    try {
        const output = execSync(`git log --format=%h\\ %s --reverse ${fromSha}..${toSha}`, { encoding: 'utf8' }).trim();
        if (!output) return [];
        return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function ensureRalphCommit(featureNum, iteration) {
    const statusBefore = getGitStatusPorcelain();
    if (!statusBefore) {
        return {
            ok: true,
            committed: false,
            autoCommitted: false,
            message: 'No uncommitted changes after iteration.'
        };
    }

    const message = `chore: autopilot iteration ${iteration} for feature ${String(featureNum).padStart(2, '0')}`;

    const addResult = spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
    if (addResult.error || addResult.status !== 0) {
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: addResult.error ? addResult.error.message : `git add failed with status ${addResult.status}`
        };
    }

    const commitResult = spawnSync('git', ['commit', '-m', message], { stdio: 'inherit' });
    if (commitResult.error) {
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: commitResult.error.message
        };
    }
    if (commitResult.status !== 0) {
        const remaining = getGitStatusPorcelain();
        if (!remaining) {
            return {
                ok: true,
                committed: false,
                autoCommitted: false,
                message: 'No additional commit needed after iteration.'
            };
        }
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: `git commit failed with status ${commitResult.status}`
        };
    }

    return {
        ok: true,
        committed: true,
        autoCommitted: true,
        message: `Auto-committed pending changes: ${message}`
    };
}

function runRalphAgentIteration(agentId, prompt, dryRun = false) {
    const cliConfig = getAgentCliConfig(agentId);
    const command = cliConfig?.command;
    if (!command) {
        return {
            ok: false,
            exitCode: 1,
            signal: null,
            summary: `No CLI command configured for agent '${agentId}'.`
        };
    }

    const flagTokens = getAgentLaunchFlagTokens(command, cliConfig.implementFlag, { autonomous: true });
    // Claude needs -p (print mode) so it exits after completing the prompt
    if (command === 'claude' && !flagTokens.includes('-p') && !flagTokens.includes('--print')) {
        flagTokens.unshift('-p');
    }
    const args = [...flagTokens, prompt];

    if (dryRun) {
        return {
            ok: true,
            exitCode: 0,
            signal: null,
            summary: `[dry-run] ${command} ${args.join(' ')}`
        };
    }

    const env = { ...process.env };
    if (command === 'claude') {
        delete env.CLAUDECODE;
    }

    const result = spawnSync(command, args, {
        stdio: 'inherit',
        env
    });

    if (result.error) {
        return {
            ok: false,
            exitCode: 1,
            signal: null,
            summary: `Agent CLI failed to start: ${result.error.message}`
        };
    }

    if (result.signal) {
        return {
            ok: false,
            exitCode: 130,
            signal: result.signal,
            summary: `Agent exited via signal ${result.signal}`
        };
    }

    const exitCode = typeof result.status === 'number' ? result.status : 1;
    return {
        ok: exitCode === 0,
        exitCode,
        signal: null,
        summary: `Agent exited with code ${exitCode}`
    };
}

function runRalphValidation(validationCommand, dryRun = false) {
    if (!validationCommand) {
        return {
            ok: false,
            exitCode: 1,
            summary: 'Validation command not configured'
        };
    }

    if (dryRun) {
        return {
            ok: true,
            exitCode: 0,
            summary: `[dry-run] ${validationCommand}`
        };
    }

    const result = spawnSync(validationCommand, {
        stdio: 'inherit',
        shell: true
    });

    if (result.error) {
        return {
            ok: false,
            exitCode: 1,
            summary: `Validation failed to start: ${result.error.message}`
        };
    }
    if (result.signal) {
        return {
            ok: false,
            exitCode: 130,
            summary: `Validation exited via signal ${result.signal}`
        };
    }

    const exitCode = typeof result.status === 'number' ? result.status : 1;
    return {
        ok: exitCode === 0,
        exitCode,
        summary: `${validationCommand} exited with code ${exitCode}`
    };
}

function appendRalphProgressEntry(progressPath, featureNum, featureDesc, entry) {
    if (!fs.existsSync(progressPath)) {
        const header = `# Autopilot Progress: Feature ${featureNum} - ${featureDesc}\n\n`;
        safeWrite(progressPath, header);
    }

    const lines = [];
    lines.push(`## Iteration ${entry.iteration} (${entry.timestamp})`);
    lines.push(`**Status:** ${entry.status}`);
    lines.push(`**Agent:** ${entry.agent}`);
    lines.push(`**Validation:** ${entry.validation}`);
    lines.push(`**Summary:** ${entry.summary}`);
    lines.push(`**Files changed:** ${entry.filesChanged.length ? entry.filesChanged.join(', ') : 'none'}`);
    lines.push(`**Commits:** ${entry.commits.length ? entry.commits.join(' | ') : 'none'}`);
    if (entry.criteriaResults && entry.criteriaResults.length > 0) {
        const passCount = entry.criteriaResults.filter(r => r.passed === true).length;
        const failCount = entry.criteriaResults.filter(r => r.passed === false).length;
        lines.push(`**Criteria:** ${passCount} passed, ${failCount} failed`);
        entry.criteriaResults.forEach(r => {
            const icon = r.skipped ? '⏭' : r.passed ? '✅' : '❌';
            lines.push(`  ${icon} ${r.text}${r.reasoning ? ` (${r.reasoning})` : ''}`);
        });
    }
    lines.push('');

    fs.appendFileSync(progressPath, `${lines.join('\n')}\n`);
}

function runRalphCommand(args) {
    const options = parseCliOptions(args);
    const id = options._[0];
    if (!id) {
        console.error(`Usage: aigon feature-do <feature-id> --autonomous [--max-iterations=N] [--agent=<id>] [--auto-submit] [--no-auto-submit] [--dry-run]`);
        console.error(`\nExamples:`);
        console.error(`  aigon feature-do 16 --autonomous`);
        console.error(`  aigon feature-do 16 --autonomous --max-iterations=8 --agent=cx`);
        console.error(`  aigon feature-do 16 --autonomous --auto-submit   # auto-submit on success`);
        process.exitCode = 1;
        return;
    }

    const found = findFile(PATHS.features, id, ['03-in-progress']);
    if (!found) {
        console.error(`❌ Could not find feature "${id}" in 03-in-progress.`);
        process.exitCode = 1;
        return;
    }

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) {
        console.error(`❌ Could not parse feature filename: ${found.file}`);
        process.exitCode = 1;
        return;
    }
    const [, featureNum, featureDesc] = match;

    const availableAgents = getAvailableAgents();
    const pc = loadProjectConfig();
    const configuredDefaultMax = pc?.autonomous?.maxIterations || pc?.ralph?.maxIterations;
    const defaultMaxIterations = Number.isInteger(configuredDefaultMax) && configuredDefaultMax > 0
        ? configuredDefaultMax
        : 5;
    const maxIterationsRaw = getOptionValue(options, 'max-iterations');
    const maxIterations = maxIterationsRaw !== undefined ? parseInt(maxIterationsRaw, 10) : defaultMaxIterations;
    if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
        console.error(`❌ Invalid --max-iterations value: ${maxIterationsRaw}`);
        process.exitCode = 1;
        return;
    }

    const selectedAgentRaw = String(getOptionValue(options, 'agent') || 'cc').toLowerCase();
    if (!availableAgents.includes(selectedAgentRaw)) {
        console.error(`❌ Unknown agent '${selectedAgentRaw}'. Available: ${availableAgents.join(', ')}`);
        process.exitCode = 1;
        return;
    }
    const selectedAgent = selectedAgentRaw;

    const dryRun = Boolean(getOptionValue(options, 'dry-run'));

    // --auto-submit / --no-auto-submit
    // Fleet mode defaults to auto-submit (user isn't watching); drive mode defaults to off.
    // We'll resolve the actual default after detecting fleet mode below.
    const autoSubmitFlagExplicit = getOptionValue(options, 'auto-submit');
    const noAutoSubmitFlagExplicit = getOptionValue(options, 'no-auto-submit');

    const profile = getActiveProfile();
    const projectConfig = loadProjectConfig();
    const profileValidations = getProfileValidationCommands(profile.name, projectConfig);

    let specContent;
    const progressPath = path.join(PATHS.features.root, 'logs', `feature-${featureNum}-ralph-progress.md`);
    const existingProgress = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : '';
    const previousIterations = parseRalphProgress(existingProgress);
    const completedSuccess = previousIterations.find(entry => entry.success);
    // skipToAutoSubmit: loop already passed; honour --auto-submit if requested
    let skipToAutoSubmit = false;
    if (completedSuccess) {
        console.log(`✅ Autopilot loop already succeeded on iteration ${completedSuccess.number}.`);
        console.log(`   Progress file: ./docs/specs/features/logs/feature-${featureNum}-ralph-progress.md`);
        skipToAutoSubmit = true;
    }

    const startIteration = previousIterations.length
        ? Math.max(...previousIterations.map(entry => entry.number)) + 1
        : 1;

    if (!skipToAutoSubmit && startIteration > maxIterations) {
        console.error(`❌ No iterations remaining. Last recorded iteration is ${startIteration - 1}, max is ${maxIterations}.`);
        console.error(`   Re-run with a higher limit: --max-iterations=<N>`);
        process.exitCode = 1;
        return;
    }

    if (!skipToAutoSubmit) {
        const validationDisplay = profileValidations.map(v => v.cmd).join(', ') || '(not configured)';
        console.log(`\n🔁 Autopilot: Feature ${featureNum} - ${featureDesc}`);
        console.log(`   Agent: ${selectedAgent}`);
        console.log(`   Iterations: ${startIteration}..${maxIterations}`);
        console.log(`   Validation: ${validationDisplay}`);
        console.log(`   Progress: ./docs/specs/features/logs/feature-${featureNum}-ralph-progress.md`);
        if (dryRun) {
            console.log(`   Mode: dry-run`);
        }
    }

    // Write auto-submit marker so the feature-do skill template knows
    // to skip manual verification gates and auto-invoke feature-submit.
    if (autoSubmitFlagExplicit !== undefined && noAutoSubmitFlagExplicit === undefined) {
        const markerDir = path.join(process.cwd(), '.aigon');
        if (!fs.existsSync(markerDir)) fs.mkdirSync(markerDir, { recursive: true });
        const markerPath = path.join(markerDir, 'auto-submit');
        fs.writeFileSync(markerPath, JSON.stringify({ featureId: featureNum, agent: selectedAgent, createdAt: new Date().toISOString() }) + '\n');
    }

    let interrupted = false;
    const sigintHandler = () => {
        interrupted = true;
    };
    process.on('SIGINT', sigintHandler);

    let loopSucceeded = skipToAutoSubmit; // already succeeded if skipping loop
    let criteriaFeedback = null;
    try {
        for (let iteration = skipToAutoSubmit ? maxIterations + 1 : startIteration; iteration <= maxIterations; iteration++) {
            // Re-read spec each iteration to reflect any checkbox updates
            specContent = fs.readFileSync(found.fullPath, 'utf8');
            const timestamp = formatTimestamp();
            const progressBeforeIteration = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : existingProgress;
            const featureValidationCommands = parseFeatureValidation(specContent);
            const prompt = buildRalphPrompt({
                featureNum,
                featureDesc,
                iteration,
                maxIterations,
                profileValidations,
                featureValidationCommands,
                specContent,
                priorProgress: progressBeforeIteration,
                criteriaFeedback
            });

            console.log(`\n🚀 Iteration ${iteration}/${maxIterations}`);
            const headBefore = dryRun ? null : getCurrentHead();
            const agentResult = runRalphAgentIteration(selectedAgent, prompt, dryRun);

            let status = 'Failed';
            let summary = agentResult.summary;
            let validationResult = { ok: false, exitCode: 1, summary: 'Validation skipped (agent step did not complete)' };
            let smartResult = null;

            if (interrupted || agentResult.signal === 'SIGINT' || agentResult.exitCode === 130) {
                status = 'Interrupted';
                summary = 'Interrupted by Ctrl+C';
            } else if (agentResult.ok) {
                const currentFeatureValidationCommands = parseFeatureValidation(specContent);
                const allValidations = [
                    ...profileValidations,
                    ...currentFeatureValidationCommands.map(cmd => ({ label: 'Feature', cmd }))
                ];

                if (allValidations.length === 0) {
                    console.log(`\n⚠️  No validation configured — marking as success.`);
                    validationResult = { ok: true, exitCode: 0, summary: 'No validation configured' };
                } else {
                    console.log(`\n🧪 Running validation (${allValidations.length} check${allValidations.length > 1 ? 's' : ''}):`);
                    let allPassed = true;
                    const summaries = [];
                    for (const { label, cmd } of allValidations) {
                        console.log(`   [${label}] ${cmd}`);
                        const result = runRalphValidation(cmd, dryRun);
                        summaries.push(`${label}: ${result.summary}`);
                        if (!result.ok) {
                            validationResult = result;
                            allPassed = false;
                            break;
                        }
                        validationResult = result;
                    }
                    validationResult = { ...validationResult, summary: summaries.join(' | ') };
                    if (allPassed) validationResult.ok = true;
                }

                status = validationResult.ok ? 'Success' : 'Failed';
                summary = validationResult.ok
                    ? `Validation passed on iteration ${iteration}`
                    : `Validation failed on iteration ${iteration}`;

                // Smart validation: evaluate acceptance criteria when commands pass
                if (validationResult.ok) {
                    smartResult = runSmartValidation({
                        featureNum,
                        specPath: found.fullPath,
                        specContent,
                        dryRun,
                        updateSpec: !dryRun
                    });
                    if (smartResult.criteriaResults.length > 0) {
                        console.log(`\n🧠 Criteria evaluation:`);
                        console.log(formatCriteriaResults(smartResult.criteriaResults));
                        console.log(`   ${smartResult.summary}`);
                    }
                    if (!smartResult.allPassed) {
                        status = 'Failed';
                        summary = `Criteria check: ${smartResult.summary}`;
                        criteriaFeedback = formatCriteriaResults(
                            smartResult.criteriaResults.filter(r => r.passed === false)
                        );
                    } else {
                        criteriaFeedback = null;
                    }
                }
            }

            let commitResult;
            if (dryRun) {
                commitResult = { ok: true, committed: false, autoCommitted: false, message: 'Skipped commit step in dry-run mode.' };
            } else if (status === 'Interrupted') {
                commitResult = { ok: true, committed: false, autoCommitted: false, message: 'Skipped commit step because iteration was interrupted.' };
            } else {
                commitResult = ensureRalphCommit(featureNum, iteration);
            }
            if (!commitResult.ok) {
                status = 'Failed';
                summary = `Commit step failed: ${commitResult.message}`;
            }

            const headAfter = dryRun ? null : getCurrentHead();
            const filesChanged = dryRun ? [] : getChangedFilesInRange(headBefore, headAfter);
            const commits = dryRun ? [] : getCommitSummariesInRange(headBefore, headAfter);
            const validationSummary = validationResult.summary || 'Validation not run';

            if (!dryRun) {
                appendRalphProgressEntry(progressPath, featureNum, featureDesc, {
                    iteration,
                    timestamp,
                    status,
                    agent: selectedAgent,
                    validation: validationSummary,
                    summary,
                    filesChanged,
                    commits,
                    criteriaResults: smartResult ? smartResult.criteriaResults : null
                });
            }

            if (status === 'Success') {
                loopSucceeded = true;
                console.log(`✅ Autopilot loop succeeded on iteration ${iteration}.`);
                break;
            }
            if (status === 'Interrupted') {
                console.log(`⏸️  Autopilot loop interrupted on iteration ${iteration}. Re-run to resume.`);
                process.exitCode = 130;
                break;
            }
            if (iteration === maxIterations) {
                console.log(`❌ Autopilot loop reached max iterations (${maxIterations}) without passing validation.`);
                process.exitCode = 1;
                break;
            }
            console.log(`↩️  Iteration ${iteration} failed. Continuing to next iteration...`);
        }
    } finally {
        process.removeListener('SIGINT', sigintHandler);
    }

    if (loopSucceeded) {
        // Detect fleet mode: count worktrees matching this feature ID
        let isFleetMode = false;
        try {
            const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
            const featureWorktrees = wtOutput.split('\n').filter(line => {
                const wtPath = line.split(/\s+/)[0] || '';
                return path.basename(wtPath).match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`));
            });
            isFleetMode = featureWorktrees.length >= 1; // in a worktree = fleet
        } catch (e) { /* not in a git repo or no worktrees */ }

        // Resolve auto-submit: explicit flags win; otherwise fleet=on, drive=off
        let autoSubmit;
        if (noAutoSubmitFlagExplicit !== undefined) {
            autoSubmit = false;
        } else if (autoSubmitFlagExplicit !== undefined) {
            autoSubmit = true;
        } else {
            autoSubmit = isFleetMode;
        }

        if (autoSubmit && !dryRun) {
            console.log(`\n🚀 Auto-submitting (${isFleetMode ? 'Fleet' : 'Drive'} mode)...`);

            // 1. Write/update the implementation log
            const logsDir = path.join(PATHS.features.root, 'logs');
            const logPattern = `feature-${featureNum}-`;
            let logFile = null;
            if (fs.existsSync(logsDir)) {
                const all = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(logPattern) && f.endsWith('-log.md'));
                // In fleet/worktree, prefer agent-specific log
                const branch = (() => { try { return execSync('git branch --show-current', { encoding: 'utf8' }).trim(); } catch (e) { return ''; } })();
                const agentMatch = branch.match(/^feature-\d+-([a-z]{2})-/);
                if (agentMatch) {
                    logFile = all.find(f => f.startsWith(`feature-${featureNum}-${agentMatch[1]}-`)) || all[0];
                } else {
                    logFile = all.filter(f => !f.match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`))).find(Boolean) || all[0];
                }
            }

            if (logFile) {
                const logPath = path.join(PATHS.features.root, 'logs', logFile);
                const progressContent = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : '';
                const iterations = parseRalphProgress(progressContent);
                const successEntry = iterations.find(e => e.success);
                const numIterations = iterations.length;
                const logSummary = `\n## Autopilot Auto-Submit\n\nCompleted in ${numIterations} iteration${numIterations !== 1 ? 's' : ''}.\n` +
                    (successEntry ? `Passed validation on iteration ${successEntry.number}: ${successEntry.validation || 'OK'}\n` : '') +
                    `\nProgress: \`docs/specs/features/logs/feature-${featureNum}-ralph-progress.md\`\n`;

                let logContent = fs.readFileSync(logPath, 'utf8');
                // Append Autopilot summary to log
                logContent = logContent.trimEnd() + '\n' + logSummary;

                // Update status front matter to 'submitted'
                const nowIso = new Date().toISOString();
                const newFrontMatter = `---\nstatus: submitted\nupdated: ${nowIso}\n---\n`;
                if (logContent.startsWith('---\n')) {
                    logContent = logContent.replace(/^---\n[\s\S]*?\n---\n/, newFrontMatter);
                } else {
                    logContent = newFrontMatter + '\n' + logContent;
                }
                fs.writeFileSync(logPath, logContent);

                // 2. Commit the log
                try {
                    execSync(`git add "${logPath}"`, { stdio: 'pipe' });
                    execSync(`git commit -m "docs: auto-submit log for feature ${featureNum} (autopilot)"`, { stdio: 'pipe' });
                    console.log(`   ✅ Log committed: ${logFile}`);
                } catch (e) {
                    // Nothing to commit or already committed
                    console.log(`   ℹ️  Log commit skipped (no changes or already committed)`);
                }
            }

            console.log(`\n✅ Auto-submitted. Ready for ${isFleetMode ? 'evaluation' : 'review'}.`);
            if (isFleetMode) {
                console.log(`   Next: return to main repo and run: aigon feature-eval ${featureNum}`);
            } else {
                console.log(`   Next: run: aigon feature-close ${featureNum}`);
            }
        } else {
            if (autoSubmit && dryRun) {
                console.log(`\n[dry-run] Would auto-submit feature ${featureNum}`);
            }
            console.log(`\n📌 Next: review progress in ./docs/specs/features/logs/feature-${featureNum}-ralph-progress.md`);
            if (!autoSubmit) {
                console.log(`   Then run: aigon feature-submit (or /aigon:feature-submit) to commit and signal done`);
                console.log(`   Tip: use --auto-submit to skip this step next time`);
            }
        }
    }
}

// --- Smart Validation (Feature 17) ---

function parseAcceptanceCriteria(specContent) {
    const criteria = [];
    if (!specContent) return criteria;
    const lines = specContent.split('\n');
    let inSection = false;
    for (const line of lines) {
        if (/^## Acceptance Criteria/.test(line)) { inSection = true; continue; }
        if (inSection && /^## /.test(line)) break;
        if (!inSection) continue;
        const match = line.match(/^- \[([ x])\] (.+)$/);
        if (match) {
            criteria.push({
                checked: match[1] === 'x',
                text: match[2].trim(),
                type: classifyCriterion(match[2].trim())
            });
        }
    }
    return criteria;
}

function classifyCriterion(text) {
    const objectivePatterns = [
        /\btests?\s*(pass|fail|run|suite)/i,
        /\bbuilds?\s*(succeed|pass|fail|compil)/i,
        /\blint/i,
        /\btype.?check/i,
        /\bno\s+errors?/i,
        /\bcompiles?\b/i,
        /\bexit\s+code/i,
        /\bsyntax\s*(check|valid)/i,
    ];
    return objectivePatterns.some(p => p.test(text)) ? 'objective' : 'subjective';
}

function getPackageJsonScripts() {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        if (!fs.existsSync(pkgPath)) return {};
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.scripts || {};
    } catch (e) {
        return {};
    }
}

function getProfileValidationCommands(profileName, projectConfig = {}) {
    // 1. Explicit config takes priority (autonomous is new key; ralph is legacy alias)
    const configured = projectConfig?.autonomous?.validationCommand || projectConfig?.ralph?.validationCommand;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return [{ label: 'Project', cmd: configured.trim() }];
    }

    // 2. Custom .aigon/validation.sh replaces profile presets
    const customScript = path.join(process.cwd(), '.aigon', 'validation.sh');
    if (fs.existsSync(customScript)) {
        return [{ label: 'Custom', cmd: 'bash .aigon/validation.sh' }];
    }

    // 3. Profile-specific presets
    switch (profileName) {
        case 'ios':
            return [{ label: 'Test', cmd: 'xcodebuild test' }];
        case 'android':
            return [{ label: 'Test', cmd: './gradlew test' }];
        case 'web':
        case 'api':
        case 'library':
        case 'generic':
        default: {
            if (fs.existsSync(path.join(process.cwd(), 'Cargo.toml'))) {
                return [{ label: 'Test', cmd: 'cargo test' }];
            }
            if (fs.existsSync(path.join(process.cwd(), 'go.mod'))) {
                return [{ label: 'Test', cmd: 'go test ./...' }];
            }
            if (fs.existsSync(path.join(process.cwd(), 'pyproject.toml')) ||
                fs.existsSync(path.join(process.cwd(), 'requirements.txt'))) {
                return [{ label: 'Test', cmd: 'pytest' }];
            }
            // Node.js: multi-command based on available scripts
            const scripts = getPackageJsonScripts();
            const pm = detectNodePackageManager();
            const cmds = [];
            const nodeTestCmd = detectNodeTestCommand();
            if (nodeTestCmd) cmds.push({ label: 'Test', cmd: nodeTestCmd });
            if (profileName === 'web' && scripts.build) {
                cmds.push({ label: 'Build', cmd: `${pm} run build` });
            }
            if (scripts.lint) {
                cmds.push({ label: 'Lint', cmd: `${pm} run lint` });
            }
            if (scripts['type-check'] || scripts.typecheck) {
                const script = scripts['type-check'] ? 'type-check' : 'typecheck';
                cmds.push({ label: 'TypeCheck', cmd: `${pm} run ${script}` });
            }
            return cmds;
        }
    }
}

function evaluateAllSubjectiveCriteria(criteria, { diff, logContent }) {
    if (criteria.length === 0) return [];
    const criteriaList = criteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
    const diffSnippet = diff ? diff.slice(0, 4000) : '(not available)';
    const logSnippet = logContent ? logContent.slice(0, 1000) : '(not available)';

    const prompt = `You are evaluating whether a software implementation satisfies acceptance criteria.

Criteria to evaluate:
${criteriaList}

Code changes (git diff, truncated):
${diffSnippet}

Implementation notes:
${logSnippet}

For each criterion, respond with one line in this exact format:
1. YES: <brief reason>
2. NO: <brief reason>
(one line per criterion, numbered to match the list above)`;

    const env = { ...process.env };
    delete env.CLAUDECODE;

    try {
        const result = spawnSync('claude', ['-p', prompt], {
            encoding: 'utf8',
            timeout: 180000,
            env
        });

        if (result.error || result.status !== 0) {
            const reason = result.error ? result.error.message : `claude exited with status ${result.status}`;
            console.warn(`   ⚠️  LLM criteria evaluation failed: ${reason}`);
            if (result.stderr) console.warn(`   stderr: ${result.stderr.trim().slice(0, 200)}`);
            return criteria.map(() => ({ passed: null, reasoning: 'LLM evaluation unavailable', skipped: true }));
        }

        const outputLines = (result.stdout || '').trim().split('\n');
        return criteria.map((_, i) => {
            const line = outputLines.find(l => l.match(new RegExp(`^${i + 1}\\.\\s*(YES|NO)`, 'i'))) || '';
            const yesMatch = line.match(/^\d+\.\s*YES[:\s]*(.*)/i);
            const noMatch = line.match(/^\d+\.\s*NO[:\s]*(.*)/i);
            if (yesMatch) return { passed: true, reasoning: yesMatch[1].trim(), skipped: false };
            if (noMatch) return { passed: false, reasoning: noMatch[1].trim(), skipped: false };
            return { passed: null, reasoning: 'No response for this criterion', skipped: true };
        });
    } catch (e) {
        return criteria.map(() => ({ passed: null, reasoning: e.message, skipped: true }));
    }
}

function updateSpecCheckboxes(specPath, checkedTexts) {
    if (!checkedTexts || checkedTexts.length === 0) return;
    let content = fs.readFileSync(specPath, 'utf8');
    for (const text of checkedTexts) {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(`^- \\[ \\] ${escaped}$`, 'm'), `- [x] ${text}`);
    }
    fs.writeFileSync(specPath, content, 'utf8');
}

function runSmartValidation({ featureNum, specPath, specContent, dryRun = false, updateSpec = true }) {
    const criteria = parseAcceptanceCriteria(specContent);

    if (criteria.length === 0) {
        return { allPassed: true, criteriaResults: [], summary: 'No acceptance criteria found' };
    }

    if (dryRun) {
        const results = criteria.map(c => ({
            ...c, passed: null, reasoning: '[dry-run] evaluation skipped', skipped: true
        }));
        const report = criteria.map(c => `  [${c.type}] ${c.checked ? '[x]' : '[ ]'} ${c.text}`).join('\n');
        return { allPassed: true, criteriaResults: results, summary: `[dry-run] Would evaluate ${criteria.length} criteria:\n${report}` };
    }

    // Get git diff for LLM context
    let diff = '';
    try {
        diff = execSync('git diff HEAD~1 HEAD 2>/dev/null || git diff --cached 2>/dev/null || echo ""',
            { encoding: 'utf8', timeout: 10000 }).slice(0, 5000);
    } catch (e) { /* no diff available */ }

    // Find implementation log for context
    let logContent = '';
    try {
        const logsDir = path.join(PATHS.features.root, 'logs');
        const prefix = `feature-${featureNum}-`;
        const logFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(prefix) && f.endsWith('-log.md'));
        if (logFiles.length > 0) {
            logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8').slice(0, 2000);
        }
    } catch (e) { /* no log */ }

    // Separate unchecked subjective criteria for batched LLM call
    const uncheckedSubjective = criteria.filter(c => !c.checked && c.type === 'subjective');
    const subjectiveEvals = evaluateAllSubjectiveCriteria(uncheckedSubjective, { diff, logContent });

    const criteriaResults = [];
    const passedTexts = [];
    let allPassed = true;
    let subjIdx = 0;

    for (const criterion of criteria) {
        if (criterion.checked) {
            criteriaResults.push({ ...criterion, passed: true, reasoning: 'Previously verified', skipped: false });
            continue;
        }

        if (criterion.type === 'objective') {
            // Objective criteria: considered passed when all validation commands passed
            criteriaResults.push({ ...criterion, passed: true, reasoning: 'Objective — validation commands passed', skipped: false });
            passedTexts.push(criterion.text);
        } else {
            const evalResult = subjectiveEvals[subjIdx++] || { passed: null, reasoning: 'No evaluation', skipped: true };
            criteriaResults.push({ ...criterion, ...evalResult });
            if (evalResult.passed === true) {
                passedTexts.push(criterion.text);
            } else if (evalResult.passed === false) {
                allPassed = false;
            }
            // skipped (null) does not block success
        }
    }

    // Update spec checkboxes for newly-passed criteria
    if (updateSpec && passedTexts.length > 0) {
        try {
            updateSpecCheckboxes(specPath, passedTexts);
        } catch (e) { /* non-fatal */ }
    }

    const passCount = criteriaResults.filter(r => r.passed === true).length;
    const failCount = criteriaResults.filter(r => r.passed === false).length;
    const skipCount = criteriaResults.filter(r => r.skipped).length;

    // If no criteria actually passed and some were skipped (e.g. LLM unavailable),
    // don't treat it as success — nothing was actually validated
    if (passCount === 0 && skipCount > 0) {
        allPassed = false;
    }

    return {
        allPassed,
        criteriaResults,
        summary: `Criteria: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`
    };
}

function formatCriteriaResults(criteriaResults) {
    if (!criteriaResults || criteriaResults.length === 0) return '';
    return criteriaResults.map(r => {
        const icon = r.skipped ? '⏭' : r.passed ? '✅' : '❌';
        const tag = r.skipped ? 'skip' : r.passed ? 'pass' : 'FAIL';
        const note = r.reasoning ? ` — ${r.reasoning}` : '';
        return `  ${icon} [${tag}] ${r.text}${note}`;
    }).join('\n');
}

function runFeatureValidateCommand(args) {
    const options = parseCliOptions(args);
    const id = options._[0];
    if (!id) {
        console.error('Usage: aigon feature-validate <ID> [--dry-run] [--no-update]');
        process.exitCode = 1;
        return;
    }

    const found = findFile(PATHS.features, id, ['03-in-progress']);
    if (!found) {
        console.error(`❌ Could not find feature "${id}" in 03-in-progress.`);
        process.exitCode = 1;
        return;
    }

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) {
        console.error(`❌ Could not parse feature filename: ${found.file}`);
        process.exitCode = 1;
        return;
    }
    const [, featureNum] = match;

    const dryRun = Boolean(getOptionValue(options, 'dry-run'));
    const noUpdate = Boolean(getOptionValue(options, 'no-update'));

    const specContent = fs.readFileSync(found.fullPath, 'utf8');
    const criteria = parseAcceptanceCriteria(specContent);

    if (criteria.length === 0) {
        console.log('ℹ️  No acceptance criteria found in spec.');
        return;
    }

    const profile = getActiveProfile();
    const projectConfig = loadProjectConfig();
    const profileValidations = getProfileValidationCommands(profile.name, projectConfig);
    const featureValidationCommands = parseFeatureValidation(specContent);
    const allValidations = [
        ...profileValidations,
        ...featureValidationCommands.map(cmd => ({ label: 'Feature', cmd }))
    ];

    console.log(`\n🔍 Smart Validation: Feature ${featureNum}`);
    console.log(`   Profile: ${profile.name}`);
    if (dryRun) console.log(`   Mode: dry-run`);

    if (allValidations.length > 0) {
        console.log(`\nValidation commands:`);
        allValidations.forEach(({ label, cmd }) => console.log(`  [${label}] ${cmd}`));
    }

    console.log(`\nAcceptance criteria (${criteria.length} total):`);
    criteria.forEach(c => {
        const icon = c.checked ? '[x]' : '[ ]';
        console.log(`  ${icon} [${c.type}] ${c.text}`);
    });

    if (dryRun) {
        console.log('\n[dry-run] No validation run. Use without --dry-run to execute.');
        return;
    }

    // Run validation commands
    console.log('\n🧪 Running validation:');
    let validationPassed = true;
    if (allValidations.length === 0) {
        console.log('  (no validation commands configured)');
    } else {
        for (const { label, cmd } of allValidations) {
            console.log(`  [${label}] ${cmd}`);
            const result = runRalphValidation(cmd, false);
            if (!result.ok) {
                console.log(`  ❌ Failed: ${result.summary}`);
                validationPassed = false;
                break;
            }
        }
    }

    if (!validationPassed) {
        console.log('\n❌ Validation commands failed. Fix before running smart validation.');
        process.exitCode = 1;
        return;
    }

    // Run smart validation
    console.log('\n🧠 Evaluating acceptance criteria:');
    const result = runSmartValidation({
        featureNum,
        specPath: found.fullPath,
        specContent,
        dryRun: false,
        updateSpec: !noUpdate
    });

    const formatted = formatCriteriaResults(result.criteriaResults);
    if (formatted) console.log(formatted);

    console.log(`\n${result.summary}`);
    if (result.allPassed) {
        console.log('✅ All criteria satisfied.');
        if (!noUpdate) console.log('   Spec checkboxes updated.');
    } else {
        console.log('❌ Some criteria not satisfied. Review and address failing items.');
        process.exitCode = 1;
    }
}

// --- Deploy helpers ---

/**
 * Resolve the deploy command from config or package.json.
 * @param {boolean} isPreview - true for --preview, false for production
 * @returns {string|null} resolved shell command, or null if not configured
 */
function resolveDeployCommand(isPreview) {
    const key = isPreview ? 'preview' : 'deploy';

    // 1. Check .aigon/config.json → commands.deploy / commands.preview
    const projectConfig = loadProjectConfig();
    if (projectConfig?.commands?.[key]) {
        return projectConfig.commands[key];
    }

    // 2. Fall back to package.json scripts.deploy / scripts.preview
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg?.scripts?.[key]) {
                return `npm run ${key}`;
            }
        } catch (e) { /* ignore parse errors */ }
    }

    return null;
}

/**
 * Run the resolved deploy command, streaming output to the terminal.
 * @param {boolean} isPreview
 * @returns {number} exit code
 */
function runDeployCommand(isPreview) {
    const cmd = resolveDeployCommand(isPreview);
    const label = isPreview ? 'preview' : 'deploy';

    if (!cmd) {
        console.error(`❌ No ${label} command configured.`);
        console.error(`\nTo configure, add to .aigon/config.json:`);
        console.error(`  {`);
        console.error(`    "commands": {`);
        if (isPreview) {
            console.error(`      "preview": "vercel"`);
        } else {
            console.error(`      "deploy": "vercel --prod"`);
        }
        console.error(`    }`);
        console.error(`  }`);
        console.error(`\nOr add a "${label}" script to package.json.`);
        return 1;
    }

    console.log(`🚀 Running ${label}: ${cmd}`);
    const result = spawnSync(cmd, { stdio: 'inherit', shell: true });

    if (result.error) {
        console.error(`❌ Failed to run deploy command: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 0;
}

module.exports = {
    detectEditor,
    openInEditor,
    detectActiveAgentSession,
    printAgentContextWarning,
    normalizeMode,
    isSameProviderFamily,
    loadGlobalConfig,
    loadProfilePresetStrings,
    loadProjectConfig,
    saveProjectConfig,
    saveGlobalConfig,
    resolveConfigKeyAlias,
    getNestedValue,
    setNestedValue,
    parseConfigScope,
    getConfigValueWithProvenance,
    getEffectiveConfig,
    readBasePort,
    showPortSummary,
    sanitizeForDns,
    getAppId,
    isPortAvailable,
    allocatePort,
    isProxyAvailable,
    loadProxyRegistry,
    saveProxyRegistry,
    loadPortRegistry,
    savePortRegistry,
    registerPort,
    deregisterPort,
    scanPortsFromFilesystem,
    generateCaddyfile,
    reloadCaddy,
    registerDevServer,
    deregisterDevServer,
    gcDevServers,
    detectDevServerContext,
    getDevProxyUrl,
    getDevServerLogPath,
    spawnDevServer,
    waitForHealthy,
    openInBrowser,
    readConductorReposFromGlobalConfig,
    parseSimpleFrontMatter,
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    inferDashboardNextCommand,
    safeTmuxSessionExists,
    collectDashboardStatusData,
    escapeForHtmlScript,
    buildDashboardHtml,
    escapeAppleScriptString,
    captureDashboardScreenshot,
    writeRepoRegistry,
    readRadarMeta,
    writeRadarMeta,
    removeRadarMeta,
    isRadarAlive,
    sendMacNotification,
    requestRadarJson,
    renderRadarMenubarFromStatus,
    writeRadarLaunchdPlist,
    runRadarServiceDaemon,
    detectProjectProfile,
    getActiveProfile,
    getProfilePlaceholders,
    getAgentCliConfig,
    parseCliFlagTokens,
    getAgentLaunchFlagTokens,
    getModelProvenance,
    getWorktreeBase,
    findWorktrees,
    filterByFeatureId,
    buildAgentCommand,
    buildResearchAgentCommand,
    toUnpaddedId,
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId,
    assertTmuxAvailable,
    tmuxSessionExists,
    createDetachedTmuxSession,
    shellQuote,
    openTerminalAppWithCommand,
    ensureTmuxSessionForWorktree,
    openInWarpSplitPanes,
    closeWarpWindow,
    openSingleWorktree,
    addWorktreePermissions,
    removeWorktreePermissions,
    presetWorktreeTrust,
    removeWorktreeTrust,
    presetCodexTrust,
    parseHooksFile,
    getDefinedHooks,
    executeHook,
    runPreHook,
    runPostHook,
    slugify,
    parseCliOptions,
    getOptionValue,
    getOptionValues,
    normalizeFeedbackStatus,
    getFeedbackFolderFromStatus,
    normalizeFeedbackSeverity,
    normalizeTag,
    parseTagListValue,
    normalizeTagList,
    parseNumericArray,
    stripInlineYamlComment,
    splitInlineYamlArray,
    parseYamlScalar,
    parseFrontMatter,
    serializeYamlScalar,
    serializeFeedbackFrontMatter,
    escapeRegex,
    extractMarkdownSection,
    extractFeedbackSummary,
    normalizeFeedbackMetadata,
    buildFeedbackDocumentContent,
    readFeedbackDocument,
    collectFeedbackItems,
    tokenizeText,
    jaccardSimilarity,
    findDuplicateFeedbackCandidates,
    buildFeedbackTriageRecommendation,
    formatFeedbackFieldValue,
    getNextId,
    findFile,
    findUnprioritizedFile,
    moveFile,
    modifySpecFile,
    printNextSteps,
    printSpecInfo,
    printError,
    createSpecFile,
    setupWorktreeEnvironment,
    ensureAgentSessions,
    resolveDevServerUrl,
    organizeLogFiles,
    runGit,
    setTerminalTitle,
    safeWrite,
    safeWriteWithStatus,
    getAigonVersion,
    getInstalledVersion,
    setInstalledVersion,
    getChangelogEntriesSince,
    compareVersions,
    removeDeprecatedCommands,
    migrateOldFlatCommands,
    upsertMarkedContent,
    readTemplate,
    loadAgentConfig,
    getAvailableAgents,
    buildAgentAliasMap,
    processTemplate,
    readGenericTemplate,
    extractDescription,
    formatCommandOutput,
    getScaffoldContent,
    getRootFileContent,
    syncAgentsMdFile,
    collectBoardItems,
    getWorktreeInfo,
    getCurrentBranch,
    saveBoardMapping,
    loadBoardMapping,
    getBoardAction,
    displayBoardKanbanView,
    displayKanbanSection,
    displayBoardListView,
    displayListSection,
    ensureBoardMapInGitignore,
    formatTimestamp,
    parseRalphProgress,
    parseFeatureValidation,
    detectNodePackageManager,
    detectNodeTestCommand,
    detectValidationCommand,
    buildRalphPrompt,
    getCurrentHead,
    getGitStatusPorcelain,
    getChangedFilesInRange,
    getCommitSummariesInRange,
    ensureRalphCommit,
    runRalphAgentIteration,
    runRalphValidation,
    appendRalphProgressEntry,
    runRalphCommand,
    parseAcceptanceCriteria,
    classifyCriterion,
    getPackageJsonScripts,
    getProfileValidationCommands,
    evaluateAllSubjectiveCriteria,
    updateSpecCheckboxes,
    runSmartValidation,
    formatCriteriaResults,
    runFeatureValidateCommand,
    resolveDeployCommand,
    runDeployCommand,
    PROVIDER_FAMILIES,
    SPECS_ROOT,
    TEMPLATES_ROOT,
    CLAUDE_SETTINGS_PATH,
    HOOKS_FILE_PATH,
    PROJECT_CONFIG_PATH,
    GLOBAL_CONFIG_DIR,
    GLOBAL_CONFIG_PATH,
    RADAR_DEFAULT_PORT,
    RADAR_PID_FILE,
    RADAR_LOG_FILE,
    RADAR_META_FILE,
    DEFAULT_GLOBAL_CONFIG,
    PROFILE_PRESET_STRING_FILES,
    PROFILE_PRESETS,
    DEV_PROXY_DIR,
    DEV_PROXY_REGISTRY,
    DEV_PROXY_CADDYFILE,
    DEV_PROXY_LOGS_DIR,
    PORT_REGISTRY_PATH,
    PATHS,
    FEEDBACK_STATUS_TO_FOLDER,
    FEEDBACK_FOLDER_TO_STATUS,
    FEEDBACK_STATUS_FLAG_TO_FOLDER,
    FEEDBACK_ACTION_TO_STATUS,
    FEEDBACK_DEFAULT_LIST_FOLDERS,
    VERSION_FILE,
    MARKER_START,
    MARKER_END,
    COMMAND_REGISTRY,
    COMMAND_ALIASES,
    COMMAND_ALIAS_REVERSE,
    COMMAND_ARG_HINTS,
    COMMANDS_DISABLE_MODEL_INVOCATION,
    AGENT_CONFIGS,
};
