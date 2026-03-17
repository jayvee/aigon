'use strict';

// ── NAVIGATION ────────────────────────────────────────────────────────────────
// Editor / agent detection              ~11
// Config & profiles                     ~223
// Port / proxy / dev-server             ~523
// Dashboard registry                     ~1112
// Dashboard status collection           ~1187
// Dashboard HTML builder                ~1720
// Analytics & completion series         ~5611
// Feedback                              ~4673
// Generic CRUD (findFile, moveFile)     ~5203
// Templates & agent config              ~6272
// Board rendering                       ~6531
// Git utilities                         ~6070
// Validation & Ralph                    ~7017
// Deploy                                ~8206
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const stateMachine = require('./state-machine');
const git = require('./git');

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
/**
 * Get the user's shell profile path (~/.zshrc or ~/.bashrc).
 * @returns {string|null} Profile path, or null if none found
 */
function getShellProfile() {
    const home = os.homedir();
    const shell = process.env.SHELL || '';
    if (shell.includes('zsh')) {
        const zshrc = path.join(home, '.zshrc');
        if (fs.existsSync(zshrc)) return zshrc;
    }
    const bashrc = path.join(home, '.bashrc');
    if (fs.existsSync(bashrc)) return bashrc;
    const bash_profile = path.join(home, '.bash_profile');
    if (fs.existsSync(bash_profile)) return bash_profile;
    // Default to zshrc on macOS (default shell)
    if (process.platform === 'darwin') return path.join(home, '.zshrc');
    return null;
}

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
const DASHBOARD_DEFAULT_PORT = 4100;
const DASHBOARD_DYNAMIC_PORT_START = 4101;
const DASHBOARD_DYNAMIC_PORT_END = 4199;
const DASHBOARD_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'dashboard.log');
// Legacy aliases (kept for any remaining references in dev-server / proxy code)

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
    depCheck: 'dep-check.md',
    playwrightVerification: 'playwright-verification.md'
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
        depCheck: readField(PROFILE_PRESET_STRING_FILES.depCheck),
        playwrightVerification: readField(PROFILE_PRESET_STRING_FILES.playwrightVerification)
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
        const commonDir = git.getCommonDir();
        if (commonDir && path.isAbsolute(commonDir)) {
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
 * Check if the dev proxy (Caddy) is available via the admin API.
 * @returns {boolean} True if Caddy's admin API responds at localhost:2019
 */
function isProxyAvailable() {
    try {
        execSync(`curl -sf --max-time 1 "${CADDY_ADMIN_URL}/config/" > /dev/null 2>&1`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Run structured diagnostics on the dev proxy (Caddy + dnsmasq).
 * @returns {{ healthy: boolean, caddy: { installed: boolean, running: boolean, adminApi: boolean }, dnsmasq: { installed: boolean, running: boolean }, routes: { total: number, live: number, stale: number }, fix: string|null }}
 */
function proxyDiagnostics() {
    // Caddy installed?
    let caddyInstalled = false;
    try { execSync('caddy version', { stdio: 'pipe' }); caddyInstalled = true; } catch (e) { /* not installed */ }

    // Caddy admin API responding?
    let caddyAdminApi = false;
    try {
        execSync(`curl -sf --max-time 1 "${CADDY_ADMIN_URL}/config/"`, { stdio: 'pipe' });
        caddyAdminApi = true;
    } catch (e) { /* not responding */ }

    // dnsmasq installed?
    let dnsmasqInstalled = false;
    try { execSync('brew list dnsmasq', { stdio: 'pipe' }); dnsmasqInstalled = true; } catch (e) { /* not installed */ }

    // dnsmasq running?
    let dnsmasqRunning = false;
    try {
        const out = execSync('brew services list', { stdio: 'pipe' }).toString();
        dnsmasqRunning = /dnsmasq\s+started/.test(out);
    } catch (e) { /* can't check */ }

    // Route counts
    const registry = loadProxyRegistry();
    let totalRoutes = 0;
    for (const servers of Object.values(registry)) {
        totalRoutes += Object.keys(servers).length;
    }

    let liveCount = 0;
    let staleCount = 0;
    if (caddyAdminApi) {
        const liveRoutes = getCaddyLiveRoutes();
        liveCount = liveRoutes.size;
        // Stale: in servers.json but not in Caddy live config
        for (const [appId, servers] of Object.entries(registry)) {
            for (const serverId of Object.keys(servers)) {
                const routeId = getCaddyRouteId(appId, serverId);
                if (!liveRoutes.has(routeId)) staleCount++;
            }
        }
    }

    // Determine fix command based on priority
    let fix = null;
    if (!caddyInstalled) {
        fix = 'brew install caddy';
    } else if (!caddyAdminApi) {
        if (!fs.existsSync(DEV_PROXY_CADDYFILE)) {
            fix = 'aigon proxy-setup';
        } else {
            fix = `sudo brew services start caddy`;
        }
    } else if (!dnsmasqRunning) {
        fix = 'sudo brew services start dnsmasq';
    } else if (staleCount > 0) {
        fix = 'aigon proxy-reconcile';
    }

    const healthy = caddyInstalled && caddyAdminApi && dnsmasqRunning && staleCount === 0;

    return {
        healthy,
        caddy: {
            installed: caddyInstalled,
            running: caddyAdminApi,
            adminApi: caddyAdminApi,
        },
        dnsmasq: {
            installed: dnsmasqInstalled,
            running: dnsmasqRunning,
        },
        routes: {
            total: totalRoutes,
            live: liveCount,
            stale: staleCount,
        },
        fix,
    };
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

// --- Caddy Admin API ---

const CADDY_ADMIN_URL = 'http://localhost:2019';

/**
 * Get the @id tag for a Caddy route.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier (empty string for main)
 * @returns {string} Route ID like "aigon-aigon-cc-74" or "aigon-aigon"
 */
function getCaddyRouteId(appId, serverId) {
    return serverId ? `aigon-${appId}-${serverId}` : `aigon-${appId}`;
}

/**
 * Check if Caddy admin API is available.
 * @returns {boolean}
 */
function isCaddyAdminAvailable() {
    try {
        execSync(`curl -sf --max-time 1 "${CADDY_ADMIN_URL}/config/"`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Write Caddyfile as a backup/reference without reloading Caddy.
 * @param {Object} registry - Registry object
 */
function writeCaddyfileBackup(registry) {
    if (!fs.existsSync(DEV_PROXY_DIR)) {
        fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    }
    fs.writeFileSync(DEV_PROXY_CADDYFILE, generateCaddyfile(registry));
}

/**
 * Add a route to Caddy via the admin API.
 * Falls back to full Caddyfile reload if the admin API is unreachable.
 * @param {string} hostname - Virtual hostname (e.g. "cc-74.aigon.test")
 * @param {number} port - Upstream port
 * @param {string} routeId - @id tag (e.g. "aigon-aigon-cc-74")
 * @returns {boolean} True if the route was applied
 */
function addCaddyRoute(hostname, port, routeId) {
    if (isCaddyAdminAvailable()) {
        const route = {
            '@id': routeId,
            match: [{ host: [hostname] }],
            handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${port}` }] }]
        };
        const tmpFile = path.join(os.tmpdir(), `aigon-caddy-add-${Date.now()}.json`);
        try {
            fs.writeFileSync(tmpFile, JSON.stringify(route));
            execSync(
                `curl -sf -X POST -H "Content-Type: application/json" -d @"${tmpFile}" "${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes"`,
                { stdio: 'pipe' }
            );
            writeCaddyfileBackup(loadProxyRegistry());
            return true;
        } catch (e) {
            // Fall through to Caddyfile fallback
        } finally {
            try { fs.unlinkSync(tmpFile); } catch (e2) { /* ignore */ }
        }
    }
    // Fallback: full Caddyfile reload
    return reloadCaddy(loadProxyRegistry());
}

/**
 * Remove a route from Caddy via the admin API.
 * Falls back to full Caddyfile reload if the admin API is unreachable.
 * @param {string} routeId - @id tag to remove (e.g. "aigon-aigon-cc-74")
 * @returns {boolean} True if the route was removed
 */
function removeCaddyRoute(routeId) {
    if (isCaddyAdminAvailable()) {
        try {
            execSync(`curl -sf -X DELETE "${CADDY_ADMIN_URL}/id/${routeId}"`, { stdio: 'pipe' });
            writeCaddyfileBackup(loadProxyRegistry());
            return true;
        } catch (e) {
            // Fall through to Caddyfile fallback
        }
    }
    // Fallback: full Caddyfile reload
    return reloadCaddy(loadProxyRegistry());
}

/**
 * Fetch live routes from Caddy's admin API.
 * @returns {Map<string, Object>} Map from @id to route config for all aigon-* routes
 */
function getCaddyLiveRoutes() {
    const result = new Map();
    try {
        const output = execSync(
            `curl -sf --max-time 2 "${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes"`,
            { stdio: 'pipe' }
        ).toString().trim();
        const routes = JSON.parse(output);
        if (Array.isArray(routes)) {
            for (const route of routes) {
                const id = route['@id'];
                if (id) result.set(id, route);
            }
        }
    } catch (e) {
        // Caddy not available or no http config yet — return empty Map
    }
    return result;
}

/**
 * Check if a route ID exists in the proxy registry.
 * @param {Object} registry - Registry object
 * @param {string} routeId - Route ID to look up
 * @returns {boolean}
 */
function registryHasRoute(registry, routeId) {
    for (const [appId, servers] of Object.entries(registry)) {
        for (const serverId of Object.keys(servers)) {
            if (getCaddyRouteId(appId, serverId) === routeId) return true;
        }
    }
    return false;
}

/**
 * Reconcile proxy routes between servers.json and Caddy's live config.
 * - Re-adds routes for alive processes that are missing from Caddy (e.g. after crash/reboot)
 * - Removes orphan Caddy routes (aigon-* prefix but not in servers.json)
 * - Cleans dead entries (PID not running) from servers.json
 * @returns {{ added: number, removed: number, unchanged: number, cleaned: number }}
 */
function reconcileProxyRoutes() {
    if (!isProxyAvailable()) return { added: 0, removed: 0, unchanged: 0, cleaned: 0 };

    const registry = loadProxyRegistry();
    const liveRoutes = getCaddyLiveRoutes();
    const results = { added: 0, removed: 0, unchanged: 0, cleaned: 0 };

    // 1. Check each servers.json entry against live Caddy routes
    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            const routeId = getCaddyRouteId(appId, serverId);
            const isLive = liveRoutes.has(routeId);

            // Check if process is alive (handle both nested and regular entries)
            let isAlive;
            if (info.service && info.dashboard) {
                const svcAlive = info.service.pid > 0 && isProcessAlive(info.service.pid);
                const dashAlive = info.dashboard.pid > 0 && isProcessAlive(info.dashboard.pid);
                isAlive = svcAlive && dashAlive;
            } else {
                isAlive = info.pid > 0 && isProcessAlive(info.pid);
            }

            if (!isAlive) {
                // Dead process — clean from registry; remove from Caddy if route is live
                delete servers[serverId];
                if (isLive) removeCaddyRoute(routeId);
                results.cleaned++;
            } else if (!isLive) {
                // Process alive but route missing in Caddy — re-add
                const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
                const port = info.dashboard ? info.dashboard.port : info.port;
                addCaddyRoute(hostname, port, routeId);
                results.added++;
            } else {
                results.unchanged++;
            }
        }
        // Clean empty app entries
        if (Object.keys(servers).length === 0) delete registry[appId];
    }

    // 2. Remove orphan Caddy routes (aigon-* prefix but not in registry)
    for (const routeId of liveRoutes.keys()) {
        if (routeId.startsWith('aigon-') && !registryHasRoute(registry, routeId)) {
            removeCaddyRoute(routeId);
            results.removed++;
        }
    }

    saveProxyRegistry(registry);
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
            // Legacy entries have nested dashboard.port; regular entries have port directly
            const port = info.dashboard ? info.dashboard.port : info.port;
            caddyfile += `http://${hostname} {\n    reverse_proxy localhost:${port}\n}\n`;
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
    const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
    const routeId = getCaddyRouteId(appId, serverId);
    addCaddyRoute(hostname, port, routeId);
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
        const routeId = getCaddyRouteId(appId, serverId);
        removeCaddyRoute(routeId);
    }
}

/**
 * Remove registry entries for dead processes.
 * @returns {number} Number of entries removed
 */
function gcDevServers() {
    const registry = loadProxyRegistry();
    let removed = 0;
    const removedRouteIds = [];

    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            // Legacy entries have nested service/dashboard PIDs
            if (info.service && info.dashboard) {
                const serviceDead = info.service.pid > 0 && !isProcessAlive(info.service.pid);
                const dashboardDead = info.dashboard.pid > 0 && !isProcessAlive(info.dashboard.pid);
                if (serviceDead || dashboardDead) {
                    removedRouteIds.push(getCaddyRouteId(appId, serverId));
                    delete registry[appId][serverId];
                    removed++;
                }
            } else if (info.pid && info.pid > 0) {
                if (!isProcessAlive(info.pid)) {
                    removedRouteIds.push(getCaddyRouteId(appId, serverId));
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
            for (const routeId of removedRouteIds) {
                removeCaddyRoute(routeId);
            }
        }
    }

    return removed;
}

/**
 * Check if a process is alive.
 * @param {number} pid - Process ID
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM = process exists but we don't have permission to signal it (still alive)
        // ESRCH = process does not exist
        return e.code === 'EPERM';
    }
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
            const branch = git.getCurrentBranch();
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


/**
 * Derive a dev-server serverId from a branch/directory name.
 * e.g. "feature-71-cc-some-name" → "cc-71", main/master → null
 * @param {string} name
 * @returns {string|null}
 */
function deriveServerIdFromBranch(name) {
    const m = name.match(/^feature-(\d+)-([a-z]+)-/);
    if (m) return `${m[2]}-${m[1]}`;
    return null;
}

/**
 * Detect the Dashboard context — is this the main repo or a worktree?
 * Returns instanceName ('main' for main repo, branch name for worktrees) and metadata.
 * @returns {{ isWorktree: boolean, instanceName: string, worktreePath: string|null, serverId: string|null }}
 */
function detectDashboardContext() {
    const dirname = path.basename(process.cwd());
    const wtMatch = dirname.match(/^feature-\d+-[a-z]{2}-.+$/);
    if (wtMatch) {
        return { isWorktree: true, instanceName: dirname, worktreePath: process.cwd(), serverId: deriveServerIdFromBranch(dirname) };
    }

    // Try branch name
    try {
        const branch = git.getCurrentBranch();
        if (branch && branch !== 'main' && branch !== 'master') {
            const branchMatch = branch.match(/^feature-\d+-[a-z]{2}-.+$/);
            if (branchMatch) {
                return { isWorktree: true, instanceName: branch, worktreePath: process.cwd(), serverId: deriveServerIdFromBranch(branch) };
            }
        }
    } catch (e) { /* not in a git repo */ }

    return { isWorktree: false, instanceName: 'main', worktreePath: null, serverId: null };
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
    if (m) return { id: m[1], name: m[2] };
    // Inbox files may have no ID: feature-name.md
    const m2 = file.match(/^feature-(.+)\.md$/);
    if (m2) return { id: null, name: m2[1] };
    return null;
}

function inferDashboardNextCommand(featureId, agents, stage) {
    // Derives the single most-recommended next action from inferDashboardNextActions.
    const actions = inferDashboardNextActions(featureId, agents, stage);
    if (!actions || actions.length === 0) return null;
    const first = actions[0];
    return { command: first.command, reason: first.reason };
}

function inferDashboardNextActions(featureId, agents, stage) {
    const id = String(featureId).padStart(2, '0');
    if (!agents || agents.length === 0) return [];

    // Build StateContext for the state machine
    const realAgents = agents.filter(a => a.id !== 'solo');
    const smAgents = realAgents.length > 0 ? realAgents : agents;
    const smContext = {
        mode: realAgents.length > 1 ? 'fleet' : 'solo',
        agents: smAgents.map(a => a.id),
        agentStatuses: Object.fromEntries(smAgents.map(a => [a.id, a.status || 'implementing'])),
        tmuxSessionStates: Object.fromEntries(smAgents.map(a => [
            a.id,
            a.tmuxRunning ? 'running' : (a.tmuxSession ? 'exited' : 'none')
        ])),
        currentStage: stage,
        entityType: 'feature'
    };

    // Get recommended actions from state machine, convert to dashboard format
    const recommended = stateMachine.getRecommendedActions('feature', stage, smContext);
    const actions = [];

    const ACTION_REASONS = {
        'feature-open': 'Launch agent on this feature',
        'feature-attach': 'Open terminal to view progress',
        'feature-focus': 'Agent is waiting for input',
        'feature-stop': 'Kill the agent session',
        'feature-eval': stage === 'in-evaluation' ? 'Evaluation in progress' : 'All agents submitted; compare implementations',
        'feature-review': 'Get a code review before closing',
        'feature-close': stage === 'in-evaluation' ? 'Close without further evaluation' : 'Close and merge implementation',
        'feature-setup': 'Set up workspace and begin'
    };

    recommended.forEach(a => {
        const agentSuffix = a.agentId ? ` ${a.agentId}` : '';
        let command;
        switch (a.action) {
            case 'feature-open':   command = `aigon feature-open ${id}${agentSuffix}`; break;
            case 'feature-attach': command = `aigon terminal-attach ${id}${agentSuffix}`; break;
            case 'feature-focus':  command = `aigon terminal-focus ${id}${agentSuffix}`; break;
            case 'feature-stop':   command = `aigon feature-stop ${id}${agentSuffix}`; break;
            case 'feature-eval':   command = `/afe ${id}`; break;
            case 'feature-review': command = `aigon feature-review ${id}`; break;
            case 'feature-close':  command = `aigon feature-close ${id}${agentSuffix}`; break;
            case 'feature-setup':  command = `aigon feature-setup ${id}`; break;
            default:               command = `aigon ${a.action} ${id}${agentSuffix}`;
        }
        actions.push({
            command,
            label: a.label,
            reason: ACTION_REASONS[a.action] || '',
            mode: a.mode,
            action: a.action,
            agentId: a.agentId || null
        });
    });

    return actions;
}

function safeTmuxSessionExists(featureId, agentId) {
    if (!agentId || agentId === 'solo') return null;
    try {
        assertTmuxAvailable();
        const defaultSessionName = buildTmuxSessionName(featureId, agentId);

        const listResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (!listResult.error && listResult.status === 0) {
            const candidates = listResult.stdout
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(s => matchTmuxSessionByEntityId(s, featureId)?.agent === agentId);

            if (candidates.length > 0) {
                const clientsResult = runTmux(['list-clients', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
                const attachedSet = (!clientsResult.error && clientsResult.status === 0)
                    ? new Set(clientsResult.stdout.split('\n').map(s => s.trim()).filter(Boolean))
                    : new Set();

                const attachedCandidates = candidates.filter(name => attachedSet.has(name));
                const pool = attachedCandidates.length > 0 ? attachedCandidates : candidates;
                pool.sort((a, b) => b.length - a.length || a.localeCompare(b));
                return { sessionName: pool[0], running: true };
            }
        }

        return { sessionName: defaultSessionName, running: false };
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

        const inboxDir = path.join(absRepoPath, 'docs', 'specs', 'features', '01-inbox');
        const backlogDir = path.join(absRepoPath, 'docs', 'specs', 'features', '02-backlog');
        const doneDir = path.join(absRepoPath, 'docs', 'specs', 'features', '05-done');

        const specFiles = []; // { file, stage, dir }
        const stageDirs = [
            { dir: inboxDir, stage: 'inbox' },
            { dir: backlogDir, stage: 'backlog' },
            { dir: inProgressDir, stage: 'in-progress' },
            { dir: inEvalDir, stage: 'in-evaluation' }
        ];
        stageDirs.forEach(({ dir, stage }) => {
            if (fs.existsSync(dir)) {
                try {
                    // Inbox allows files without an ID (feature-name.md); other stages require one
                    const pattern = stage === 'inbox' ? /^feature-.+\.md$/ : /^feature-\d+-.+\.md$/;
                    fs.readdirSync(dir)
                        .filter(f => pattern.test(f))
                        .sort((a, b) => {
                            const mtimeA = (() => { try { return fs.statSync(path.join(dir, a)).mtimeMs; } catch (e) { return 0; } })();
                            const mtimeB = (() => { try { return fs.statSync(path.join(dir, b)).mtimeMs; } catch (e) { return 0; } })();
                            return mtimeB - mtimeA;
                        })
                        .forEach(f => specFiles.push({ file: f, stage, dir }));
                } catch (e) { /* ignore */ }
            }
        });

        // Done: include only the 10 most recent specs by mtime
        let doneTotal = 0;
        let allDoneSpecFiles = []; // full uncapped list for Logs view
        if (fs.existsSync(doneDir)) {
            try {
                const allDone = fs.readdirSync(doneDir)
                    .filter(f => /^feature-\d+-.+\.md$/.test(f));
                doneTotal = allDone.length;
                const doneWithStats = allDone
                    .map(f => {
                        let mtime = 0, birthtime = null;
                        try { const st = fs.statSync(path.join(doneDir, f)); mtime = st.mtime.getTime(); birthtime = st.birthtime.toISOString(); } catch (e) {}
                        return { f, mtime, birthtime };
                    })
                    .sort((a, b) => b.mtime - a.mtime);
                allDoneSpecFiles = doneWithStats;
                doneWithStats.slice(0, 10)
                    .forEach(({ f }) => specFiles.push({ file: f, stage: 'done', dir: doneDir }));
            } catch (e) { /* ignore */ }
        }

        const allLogDirs = [];
        if (fs.existsSync(mainLogsDir)) allLogDirs.push(mainLogsDir);
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    // Only scan directories matching worktree naming convention
                    if (!/^feature-\d+-[a-z]{2}-.+$/.test(dirName)) return;
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
                        const solo = !arena && logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
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
        specFiles.forEach(({ file: specFile, stage, dir: specDir }) => {
            const parsed = parseFeatureSpecFileName(specFile);
            if (!parsed) return;

            const specPath = path.join(specDir, specFile);
            let fallbackUpdatedAt = new Date().toISOString();
            let createdAt = fallbackUpdatedAt;
            try {
                const st = fs.statSync(specPath);
                fallbackUpdatedAt = st.mtime.toISOString();
                createdAt = st.birthtime.toISOString();
            } catch (e) { /* ignore */ }

            const agents = [];
            const idPadded = String(parsed.id).padStart(2, '0');

            // Inbox, backlog, and done features have no active agent sessions
            const isActiveStage = stage === 'in-progress' || stage === 'in-evaluation';
            if (isActiveStage) {
                const agentSet = knownAgentsByFeature[parsed.id] || new Set();
                const hasFleetAgents = agentSet.size > 0;

                if (hasFleetAgents) {
                    [...agentSet].sort((a, b) => a.localeCompare(b)).forEach(agent => {
                        const row = logsByFeatureAgent[`${parsed.id}:${agent}`] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
                        const tmux = safeTmuxSessionExists(parsed.id, agent);
                        agents.push({
                            id: agent,
                            status: normalizeDashboardStatus(row.status),
                            updatedAt: row.updatedAt,
                            slashCommand: row.status === 'waiting' ? `aigon terminal-focus ${idPadded} ${agent}` : null,
                            tmuxSession: tmux ? tmux.sessionName : null,
                            tmuxRunning: tmux ? tmux.running : false,
                            attachCommand: tmux ? `tmux attach -t ${tmux.sessionName}` : null
                        });
                    });
                } else {
                    const row = logsByFeatureSolo[parsed.id] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
                    const launchSessionName = buildTmuxSessionName(parsed.id, 'do', { repo: path.basename(absRepoPath), desc: 'launch' });
                    const soloTmuxRunning = tmuxSessionExists(launchSessionName);
                    agents.push({
                        id: 'solo',
                        status: normalizeDashboardStatus(row.status),
                        updatedAt: row.updatedAt,
                        slashCommand: row.status === 'waiting' ? `aigon terminal-focus ${idPadded}` : null,
                        tmuxSession: soloTmuxRunning ? launchSessionName : null,
                        tmuxRunning: soloTmuxRunning,
                        attachCommand: soloTmuxRunning ? `tmux attach -t ${launchSessionName}` : null
                    });
                }

                agents.forEach(agent => {
                    response.summary.total++;
                    response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
                });
            }

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

            const featureSmContext = {
                mode: agents.filter(a => a.id !== 'solo').length > 1 ? 'fleet' : 'solo',
                agents: agents.map(a => a.id),
                agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                tmuxSessionStates: Object.fromEntries(agents.map(a => [a.id, a.tmuxRunning ? 'running' : 'none'])),
                currentStage: stage,
                entityType: 'feature'
            };
            features.push({
                id: parsed.id,
                name: parsed.name,
                stage,
                specPath: path.join(specDir, specFile),
                updatedAt: fallbackUpdatedAt,
                createdAt,
                evalStatus,
                agents,
                nextAction: inferDashboardNextCommand(parsed.id, agents, stage),
                nextActions: inferDashboardNextActions(parsed.id, agents, stage),
                validActions: stateMachine.getAvailableActions('feature', stage, featureSmContext)
            });
        });

        // --- Research (all stages) ---
        const researchRoot = path.join(absRepoPath, 'docs', 'specs', 'research-topics');
        const researchLogsDir = path.join(researchRoot, 'logs');
        const research = [];
        let researchDoneTotal = 0;
        const researchStageDirs = [
            { dir: path.join(researchRoot, '01-inbox'), stage: 'inbox' },
            { dir: path.join(researchRoot, '02-backlog'), stage: 'backlog' },
            { dir: path.join(researchRoot, '03-in-progress'), stage: 'in-progress' },
            { dir: path.join(researchRoot, '05-paused'), stage: 'paused' }
        ];
        const researchSpecFiles = []; // { file, stage, dir }
        researchStageDirs.forEach(({ dir, stage }) => {
            if (!fs.existsSync(dir)) return;
            try {
                const pattern = stage === 'inbox' ? /^research-.+\.md$/ : /^research-\d+-.+\.md$/;
                fs.readdirSync(dir)
                    .filter(f => pattern.test(f))
                    .sort((a, b) => a.localeCompare(b))
                    .forEach(f => researchSpecFiles.push({ file: f, stage, dir }));
            } catch (e) { /* ignore */ }
        });
        const researchDoneDir = path.join(researchRoot, '04-done');
        if (fs.existsSync(researchDoneDir)) {
            try {
                const allDone = fs.readdirSync(researchDoneDir).filter(f => /^research-\d+-.+\.md$/.test(f));
                researchDoneTotal = allDone.length;
                allDone
                    .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(researchDoneDir, f)).mtime.getTime(); } catch (e) { return 0; } })() }))
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, 10)
                    .forEach(({ f }) => researchSpecFiles.push({ file: f, stage: 'done', dir: researchDoneDir }));
            } catch (e) { /* ignore */ }
        }

        // Build research entries with agent info for in-progress items
        const researchLogsByAgent = {};
        if (fs.existsSync(researchLogsDir)) {
            try {
                fs.readdirSync(researchLogsDir)
                    .filter(f => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(f))
                    .forEach(f => {
                        const rm = f.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
                        if (!rm) return;
                        let status = 'implementing', updatedAt = new Date().toISOString();
                        try {
                            const content = fs.readFileSync(path.join(researchLogsDir, f), 'utf8');
                            const fm = parseSimpleFrontMatter(content);
                            status = normalizeDashboardStatus(fm.status) || 'implementing';
                            updatedAt = fm.updated || updatedAt;
                        } catch (e) { /* ignore */ }
                        if (!researchLogsByAgent[rm[1]]) researchLogsByAgent[rm[1]] = [];
                        researchLogsByAgent[rm[1]].push({ agent: rm[2], status, updatedAt });
                    });
            } catch (e) { /* ignore */ }
        }

        researchSpecFiles.forEach(({ file, stage, dir: specDir }) => {
            const rm = file.match(/^research-(\d+)-(.+)\.md$/) || file.match(/^research-(.+)\.md$/);
            if (!rm) return;
            const hasId = /^\d+$/.test(rm[1]);
            const id = hasId ? rm[1] : null;
            const name = hasId ? rm[2] : rm[1];

            const agents = [];
            if (id && (stage === 'in-progress') && researchLogsByAgent[id]) {
                researchLogsByAgent[id].forEach(({ agent, status, updatedAt }) => {
                    const sessionName = buildResearchTmuxSessionName(id, agent, { repo: path.basename(absRepoPath) });
                    const tmuxRunning = tmuxSessionExists(sessionName);
                    const idPadded = String(id).padStart(2, '0');
                    agents.push({
                        id: agent, status, updatedAt,
                        slashCommand: status === 'waiting' ? `aigon terminal-focus ${idPadded} ${agent} --research` : null,
                        tmuxSession: tmuxRunning ? sessionName : null,
                        tmuxRunning,
                        attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null
                    });
                    response.summary.total++;
                    response.summary[status] = (response.summary[status] || 0) + 1;
                });
            }

            const researchSmContext = {
                mode: agents.filter(a => a.id !== 'solo').length > 1 ? 'fleet' : 'solo',
                agents: agents.map(a => a.id),
                agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                tmuxSessionStates: Object.fromEntries(agents.map(a => [a.id, a.tmuxRunning ? 'running' : 'none'])),
                currentStage: stage,
                entityType: 'research'
            };
            research.push({ id, name, stage, specPath: path.join(specDir, file), agents, validActions: stateMachine.getAvailableActions('research', stage, researchSmContext) });
        });

        // --- Feedback (all stages) ---
        const feedbackRoot = path.join(absRepoPath, 'docs', 'specs', 'feedback');
        const feedback = [];
        let feedbackDoneTotal = 0;
        const feedbackStageDirs = [
            { dir: path.join(feedbackRoot, '01-inbox'), stage: 'inbox' },
            { dir: path.join(feedbackRoot, '02-triaged'), stage: 'triaged' },
            { dir: path.join(feedbackRoot, '03-actionable'), stage: 'actionable' },
            { dir: path.join(feedbackRoot, '05-wont-fix'), stage: 'wont-fix' },
            { dir: path.join(feedbackRoot, '06-duplicate'), stage: 'duplicate' }
        ];
        const feedbackSpecFiles = [];
        feedbackStageDirs.forEach(({ dir, stage }) => {
            if (!fs.existsSync(dir)) return;
            try {
                fs.readdirSync(dir)
                    .filter(f => /^feedback-.+\.md$/.test(f))
                    .sort((a, b) => a.localeCompare(b))
                    .forEach(f => feedbackSpecFiles.push({ file: f, stage, dir }));
            } catch (e) { /* ignore */ }
        });
        const feedbackDoneDir = path.join(feedbackRoot, '04-done');
        if (fs.existsSync(feedbackDoneDir)) {
            try {
                const allDone = fs.readdirSync(feedbackDoneDir).filter(f => /^feedback-.+\.md$/.test(f));
                feedbackDoneTotal = allDone.length;
                allDone
                    .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(feedbackDoneDir, f)).mtime.getTime(); } catch (e) { return 0; } })() }))
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, 10)
                    .forEach(({ f }) => feedbackSpecFiles.push({ file: f, stage: 'done', dir: feedbackDoneDir }));
            } catch (e) { /* ignore */ }
        }

        feedbackSpecFiles.forEach(({ file, stage, dir: specDir }) => {
            const fm = file.match(/^feedback-(\d+)-(.+)\.md$/) || file.match(/^feedback-(.+)\.md$/);
            if (!fm) return;
            const hasId = /^\d+$/.test(fm[1]);
            const feedbackSmContext = { mode: 'solo', agents: [], agentStatuses: {}, tmuxSessionStates: {}, currentStage: stage, entityType: 'feedback' };
            feedback.push({ id: hasId ? fm[1] : null, name: hasId ? fm[2] : fm[1], stage, specPath: path.join(specDir, file), agents: [], validActions: stateMachine.getAvailableActions('feedback', stage, feedbackSmContext) });
        });

        // allFeatures: full uncapped list for Logs view
        // Combines existing features array (which carries non-done + top-10 done)
        // with any remaining done features beyond the cap.
        const seenIds = new Set(features.map(f => f.id));
        const extraDone = allDoneSpecFiles
            .filter(({ f }) => {
                const parsed = parseFeatureSpecFileName(f);
                return parsed && !seenIds.has(parsed.id);
            })
            .map(({ f, mtime, birthtime }) => {
                const parsed = parseFeatureSpecFileName(f);
                return {
                    id: parsed.id,
                    name: parsed.name,
                    stage: 'done',
                    specPath: path.join(doneDir, f),
                    updatedAt: new Date(mtime).toISOString(),
                    createdAt: birthtime || new Date(mtime).toISOString()
                };
            });
        const allFeatures = [
            ...features.map(f => ({ id: f.id, name: f.name, stage: f.stage, specPath: f.specPath, updatedAt: f.updatedAt, createdAt: f.createdAt })),
            ...extraDone
        ];

        response.repos.push({
            path: absRepoPath,
            displayPath: absRepoPath.replace(os.homedir(), '~'),
            name: path.basename(absRepoPath),
            features,
            allFeatures,
            research,
            feedback,
            doneTotal,
            researchDoneTotal,
            feedbackDoneTotal
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

function buildDashboardHtml(initialData, instanceName) {
    const serializedData = escapeForHtmlScript(initialData);
    const serializedName = escapeForHtmlScript(instanceName || 'main');
    const htmlTemplate = readTemplate('dashboard/index.html');
    return htmlTemplate
        .replace('${INITIAL_DATA}', () => serializedData)
        .replace('${INSTANCE_NAME}', () => serializedName);
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


function hashBranchToPort(branchName) {
    let hash = 0;
    for (let i = 0; i < branchName.length; i++) {
        hash = ((hash << 5) - hash + branchName.charCodeAt(i)) | 0;
    }
    const range = DASHBOARD_DYNAMIC_PORT_END - DASHBOARD_DYNAMIC_PORT_START + 1; // 99
    return DASHBOARD_DYNAMIC_PORT_START + (Math.abs(hash) % range);
}

function sendMacNotification(message, title = 'Aigon Dashboard', { openUrl } = {}) {
    try {
        // Prefer terminal-notifier when available — supports click-to-open actions
        const tnPath = execSync('which terminal-notifier 2>/dev/null', { encoding: 'utf8' }).trim();
        if (tnPath) {
            const args = ['-title', title, '-message', message, '-group', 'aigon', '-sender', 'com.apple.Terminal'];
            if (openUrl) args.push('-open', openUrl);
            execSync(`${tnPath} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`);
            return;
        }
    } catch (_) {
        // terminal-notifier not found — fall through to osascript
    }
    try {
        execSync(`osascript -e 'display notification "${message}" with title "${title}"'`);
    } catch (e) {
        // Notification failures are non-fatal.
    }
}


const DASHBOARD_INTERACTIVE_ACTIONS = new Set([
    'feature-create',
    'feature-prioritise',
    'feature-setup',
    'feature-do',
    'feature-open',
    'feature-submit',
    'feature-review',
    'feature-eval',
    'feature-close',
    'research-prioritise',
    'research-setup',
    'research-close',
    'feedback-triage',
    'feedback-promote'
]);

// Fire-and-forget and agent-mode state machine actions that can be invoked via /api/action.
// Terminal-mode actions (feature-open, feature-attach, feature-focus) are handled
// by /api/feature-open which creates sessions and opens terminals.
// This set supplements DASHBOARD_INTERACTIVE_ACTIONS to accept all state-machine-defined
// non-terminal actions without requiring a separate hardcoded allowlist.
const SM_INVOCABLE_ACTIONS = (() => {
    const s = new Set();
    Object.values(stateMachine.ENTITY_DEFINITIONS || {}).forEach(def => {
        (def.transitions || []).forEach(t => s.add(t.action));
        (def.actions || []).filter(a => a.mode !== 'terminal').forEach(a => s.add(a.action));
    });
    return s;
})();

function resolveDashboardActionRepoPath(requestedRepoPath, registeredRepos, defaultRepoPath = process.cwd()) {
    const repos = (Array.isArray(registeredRepos) ? registeredRepos : []).map(repo => path.resolve(String(repo)));
    const defaultRepo = defaultRepoPath ? path.resolve(String(defaultRepoPath)) : '';
    const requested = requestedRepoPath ? path.resolve(String(requestedRepoPath)) : '';

    if (requested) {
        if (repos.length > 0 && !repos.includes(requested)) {
            return { ok: false, status: 403, error: 'repoPath is not registered with dashboard' };
        }
        return { ok: true, repoPath: requested };
    }

    if (repos.length === 1) {
        return { ok: true, repoPath: repos[0] };
    }

    if (repos.length > 1) {
        if (defaultRepo && repos.includes(defaultRepo)) {
            return { ok: true, repoPath: defaultRepo };
        }
        return { ok: false, status: 400, error: 'repoPath is required when multiple repos are registered' };
    }

    return { ok: true, repoPath: defaultRepo || process.cwd() };
}

function parseDashboardActionRequest(payload, options = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const action = String(data.action || '').trim();
    if (!action) {
        return { ok: false, status: 400, error: 'action is required' };
    }
    if (!DASHBOARD_INTERACTIVE_ACTIONS.has(action) && !SM_INVOCABLE_ACTIONS.has(action)) {
        return { ok: false, status: 400, error: `Unsupported action: ${action}` };
    }

    const argsRaw = data.args === undefined ? [] : data.args;
    if (!Array.isArray(argsRaw)) {
        return { ok: false, status: 400, error: 'args must be an array of strings' };
    }

    const args = [];
    for (const value of argsRaw) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            args.push(String(value));
            continue;
        }
        return { ok: false, status: 400, error: 'args must contain only strings, numbers, or booleans' };
    }

    const repoResolution = resolveDashboardActionRepoPath(
        data.repoPath,
        options.registeredRepos || [],
        options.defaultRepoPath || process.cwd()
    );
    if (!repoResolution.ok) return repoResolution;

    return {
        ok: true,
        action,
        args,
        repoPath: repoResolution.repoPath
    };
}

function buildDashboardActionCommandArgs(action, args) {
    const actionName = String(action || '').trim();
    const actionArgs = Array.isArray(args) ? args.map(value => String(value)) : [];
    return [CLI_ENTRY_PATH, actionName, ...actionArgs];
}

function runDashboardInteractiveAction(request) {
    const parsed = parseDashboardActionRequest(request, {
        registeredRepos: request && request.registeredRepos,
        defaultRepoPath: request && request.defaultRepoPath
    });
    if (!parsed.ok) {
        return parsed;
    }

    const cliArgs = buildDashboardActionCommandArgs(parsed.action, parsed.args);
    const result = spawnSync(process.execPath, cliArgs, {
        cwd: parsed.repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    if (result.error) {
        return {
            ok: false,
            status: 500,
            error: `Failed to run action: ${result.error.message}`
        };
    }

    const exitCode = typeof result.status === 'number' ? result.status : 1;
    const payload = {
        ok: exitCode === 0,
        action: parsed.action,
        args: parsed.args,
        repoPath: parsed.repoPath,
        command: `aigon ${parsed.action}${parsed.args.length ? ` ${parsed.args.join(' ')}` : ''}`,
        exitCode,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };

    if (exitCode !== 0) {
        return {
            ok: false,
            status: 422,
            error: `Action failed with exit code ${exitCode}`,
            details: payload
        };
    }

    return payload;
}

function runDashboardServer(port, instanceName, serverId) {
    const http = require('http');
    const host = '127.0.0.1';
    instanceName = instanceName || 'main';
    const appId = getAppId();
    const localUrl = `http://${host}:${port}`;
    const proxyAvailable = isProxyAvailable();
    const proxyUrl = proxyAvailable ? getDevProxyUrl(appId, serverId || null) : null;
    const dashboardUrl = proxyUrl || localUrl;
    let latestStatus = collectDashboardStatusData();
    const lastStatusByAgent = {};
    const allSubmittedNotified = new Set();
    let globalConfig = loadGlobalConfig();

    // ── Console event buffer ───────────────────────────────────────────────────
    const CONSOLE_BUFFER_MAX = 200;
    const consoleBuffer = []; // { timestamp, type, action, args, repoPath, command, exitCode, ok, stdout, stderr, duration }

    function logToConsole(entry) {
        entry.timestamp = new Date().toISOString();
        consoleBuffer.push(entry);
        if (consoleBuffer.length > CONSOLE_BUFFER_MAX) consoleBuffer.shift();
        log(`${entry.type}: ${entry.command || entry.action} | ok=${entry.ok} exitCode=${entry.exitCode !== undefined ? entry.exitCode : 'n/a'}${entry.stderr ? ' stderr=' + String(entry.stderr).trim().slice(0, 120) : ''}`);
    }

    // ── Notification system ────────────────────────────────────────────────────
    const NOTIFICATION_BUFFER_MAX = 100;
    const notificationBuffer = []; // { id, type, message, meta, timestamp, read }
    let notificationUnreadCount = 0;
    let notificationIdSeq = 0;

    const NOTIFICATION_TYPES = ['agent-waiting', 'agent-submitted', 'all-submitted', 'all-research-submitted', 'error'];

    function getNotificationConfig() {
        const cfg = (globalConfig.notifications) || {};
        return {
            enabled: cfg.enabled !== false,
            types: NOTIFICATION_TYPES.reduce((acc, t) => {
                acc[t] = cfg.types ? cfg.types[t] !== false : true;
                return acc;
            }, {})
        };
    }

    function emitNotification(type, message, meta) {
        const notifCfg = getNotificationConfig();
        const event = {
            id: ++notificationIdSeq,
            type,
            message,
            meta: meta || {},
            timestamp: new Date().toISOString(),
            read: false
        };
        notificationBuffer.push(event);
        if (notificationBuffer.length > NOTIFICATION_BUFFER_MAX) notificationBuffer.shift();
        notificationUnreadCount++;
        log(`Notification [${type}] ${message}`);

        if (notifCfg.enabled && notifCfg.types[type] !== false) {
            const title = (meta && meta.title) || 'Aigon Dashboard';
            const openUrl = (meta && meta.openUrl) || undefined;
            sendMacNotification(message, title, { openUrl });
        }
    }

    function log(msg) {
        try {
            fs.appendFileSync(DASHBOARD_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
        } catch (e) { /* ignore */ }
    }

    // ── Idle timer removed: dashboard stays alive until Ctrl+C or dev-server stop ──
    function resetIdleTimer() { /* no-op — kept for call-site compatibility */ }

    function pollStatus() {
        latestStatus = collectDashboardStatusData();
        (latestStatus.repos || []).forEach(repo => {
            const repoShort = repo.name || path.basename(repo.path);
            const notifTitle = `Aigon · ${repoShort}`;
            const notifMeta = (extra) => ({ title: notifTitle, openUrl: dashboardUrl, repoPath: repo.path, repoName: repoShort, ...extra });
            (repo.features || []).forEach(feature => {
                (feature.agents || []).forEach(agent => {
                    const key = `${repo.path}:${feature.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        emitNotification('agent-waiting', `${agent.id} waiting on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: agent.id }));
                    }
                    lastStatusByAgent[key] = agent.status;
                });

                const featureKey = `${repo.path}:${feature.id}`;
                const agents = Array.isArray(feature.agents) ? feature.agents : [];
                const allSubmitted = agents.length > 0 && agents.some(a => a.id && a.id !== 'solo') && agents.every(a => a.status === 'submitted');
                if (allSubmitted && feature.stage !== 'in-evaluation' && !allSubmittedNotified.has(featureKey)) {
                    allSubmittedNotified.add(featureKey);
                    emitNotification('all-submitted', `All submitted #${feature.id} ${feature.name} — ready for eval · ${repoShort}`, notifMeta({ featureId: feature.id }));
                }
            });

            // --- Research agent notifications ---
            (repo.research || []).forEach(item => {
                (item.agents || []).forEach(agent => {
                    const key = `${repo.path}:R${item.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        emitNotification('agent-waiting', `${agent.id} waiting on R#${item.id} ${item.name} · ${repoShort}`, notifMeta({ researchId: item.id, agentId: agent.id }));
                    }
                    lastStatusByAgent[key] = agent.status;
                });

                const researchKey = `${repo.path}:R${item.id}`;
                const allSubmitted = item.agents.length > 0 && item.agents.every(a => a.status === 'submitted');
                if (allSubmitted && !allSubmittedNotified.has(researchKey)) {
                    allSubmittedNotified.add(researchKey);
                    emitNotification('all-research-submitted', `All submitted R#${item.id} ${item.name} — ready for synthesis · ${repoShort}`, notifMeta({ researchId: item.id }));
                }
            });
        });
        log(`Poll complete (${(latestStatus.repos || []).length} repo${(latestStatus.repos || []).length === 1 ? '' : 's'})`);
    }

    // Analytics cache: recompute when pollStatus detects new completed features
    let analyticsCache = null;
    let analyticsLastDoneCount = -1;

    function getOrRecomputeAnalytics() {
        // Count done features across all repos to detect changes
        let doneCount = 0;
        const curRepos = readConductorReposFromGlobalConfig();
        curRepos.forEach(rp => {
            const doneDir = require('path').join(require('path').resolve(rp), 'docs', 'specs', 'features', '05-done');
            try {
                if (fs.existsSync(doneDir)) {
                    doneCount += fs.readdirSync(doneDir).filter(f => /^feature-\d+-.+\.md$/.test(f)).length;
                }
            } catch (e) { /* ignore */ }
        });
        if (!analyticsCache || doneCount !== analyticsLastDoneCount) {
            analyticsLastDoneCount = doneCount;
            try {
                analyticsCache = collectAnalyticsData(globalConfig);
            } catch (e) {
                log(`Analytics compute error: ${e.message}`);
                analyticsCache = { generatedAt: new Date().toISOString(), error: e.message };
            }
        }
        return analyticsCache;
    }

    const server = http.createServer((req, res) => {
        const reqPath = (req.url || '/').split('?')[0];
        resetIdleTimer();

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
                const requestedSession = String(payload.tmuxSession || '').trim();
                if (!featureId || !agentId || agentId === 'solo') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                    return;
                }

                let tmuxInfo = null;
                if (requestedSession) {
                    const match = matchTmuxSessionByEntityId(requestedSession, featureId);
                    if (!match || match.type !== 'f' || match.agent !== agentId) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'tmuxSession does not match featureId/agentId' }));
                        return;
                    }
                    tmuxInfo = {
                        sessionName: requestedSession,
                        running: tmuxSessionExists(requestedSession)
                    };
                } else {
                    tmuxInfo = safeTmuxSessionExists(featureId, agentId);
                }
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

        if (reqPath === '/api/feature-open' && req.method === 'POST') {
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
                const pipelineType = String(payload.pipelineType || 'features').trim();
                const isResearch = pipelineType === 'research';
                const worktreePrefix = isResearch ? 'research' : 'feature';
                if (!featureId || !agentId || agentId === 'solo') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                    return;
                }

                try {
                    const absRepo = repoPath ? path.resolve(repoPath) : process.cwd();
                    const worktreeBase = absRepo + '-worktrees';
                    let worktreePath = absRepo;
                    if (fs.existsSync(worktreeBase)) {
                        const wtPattern = new RegExp(`^${worktreePrefix}-(\\d+)-([a-z]{2})-.+$`);
                        const entries = fs.readdirSync(worktreeBase).filter(d => {
                            const m = d.match(wtPattern);
                            return m && m[1] === featureId && m[2] === agentId;
                        });
                        if (entries.length > 0) {
                            worktreePath = path.join(worktreeBase, entries[0]);
                        }
                    }

                    // Extract desc from worktree directory name for consistent session naming
                    const wtDirName = path.basename(worktreePath);
                    const wtDescMatch = wtDirName.match(new RegExp(`^${worktreePrefix}-\\d+-[a-z]{2}-(.+)$`));
                    const desc = wtDescMatch ? wtDescMatch[1] : undefined;
                    const sessionName = buildTmuxSessionName(featureId, agentId, { repo: path.basename(absRepo), desc });
                    const tmuxInfo = safeTmuxSessionExists(featureId, agentId);
                    const tmuxSessionState = tmuxInfo && tmuxInfo.running ? 'running' : 'none';

                    // Look up cached agent status so getSessionAction can make the right decision
                    let cachedAgentStatus = 'idle';
                    if (latestStatus && latestStatus.repos) {
                        outer: for (const repo of latestStatus.repos) {
                            for (const entity of [...(repo.features || []), ...(repo.research || [])]) {
                                if (String(entity.id) === String(featureId)) {
                                    const a = (entity.agents || []).find(ag => ag.id === agentId);
                                    if (a) { cachedAgentStatus = a.status || 'idle'; break outer; }
                                }
                            }
                        }
                    }

                    const { action: sessionAction, needsAgentCommand } = stateMachine.getSessionAction(agentId, {
                        tmuxSessionStates: { [agentId]: tmuxSessionState },
                        agentStatuses: { [agentId]: cachedAgentStatus }
                    });

                    // Build the agent startup command (used for create-and-start and send-keys)
                    const agentCmd = isResearch
                        ? buildResearchAgentCommand(agentId, featureId)
                        : buildAgentCommand({ agent: agentId, featureId, path: worktreePath, desc });

                    if (sessionAction === 'attach') {
                        const activeSession = tmuxInfo.sessionName;
                        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(activeSession)}`, activeSession);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Attached to ${activeSession}`, sessionName: activeSession }));
                    } else if (sessionAction === 'send-keys') {
                        // Session alive but agent done — resend the agent command in the existing session
                        const activeSession = tmuxInfo.sessionName;
                        runTmux(['send-keys', '-t', activeSession, agentCmd, 'Enter'], { stdio: 'ignore' });
                        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(activeSession)}`, activeSession);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Restarted agent in ${activeSession}`, sessionName: activeSession }));
                    } else {
                        // create-and-start
                        createDetachedTmuxSession(sessionName, worktreePath, agentCmd);
                        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        const label = isResearch ? `R${featureId}` : `F${featureId}`;
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Opened worktree for ${label} ${agentId}`, sessionName }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open worktree: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/session/ask' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const repoPath = String(payload.repoPath || '').trim();
                const agentId = String(payload.agentId || 'cc').trim();
                if (!repoPath) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'repoPath is required' })); return;
                }
                try {
                    const absRepo = path.resolve(repoPath);
                    const repoName = path.basename(absRepo);
                    const sessionName = `ask-${repoName}-${agentId}`;
                    const cliConfig = getAgentCliConfig(agentId);
                    const agentBin = cliConfig.command || agentId;
                    const flags = cliConfig.implementFlag || '';
                    const agentCmd = flags ? `${agentBin} ${flags}` : agentBin;
                    if (tmuxSessionExists(sessionName)) {
                        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Attached to existing session ${sessionName}`, sessionName }));
                    } else {
                        createDetachedTmuxSession(sessionName, absRepo, agentCmd);
                        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Started ask session for ${repoName} (${agentId})`, sessionName }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to start ask session: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/open-terminal' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }
                const command = String(payload.command || '').trim();
                const cwd = String(payload.cwd || '').trim() || process.cwd();
                if (!command) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'command is required' }));
                    return;
                }
                try {
                    openTerminalAppWithCommand(cwd, command, command.split(' ').slice(0, 3).join(' '));
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open terminal: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/refresh' && req.method === 'POST') {
            pollStatus();
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(latestStatus));
            return;
        }

        if (reqPath === '/api/action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const actionStartTime = Date.now();
                const result = runDashboardInteractiveAction({
                    ...payload,
                    registeredRepos: readConductorReposFromGlobalConfig(),
                    defaultRepoPath: process.cwd()
                });
                const actionDuration = Date.now() - actionStartTime;

                logToConsole({
                    type: 'action',
                    action: payload.action,
                    args: payload.args || [],
                    repoPath: result.repoPath,
                    command: result.command,
                    exitCode: result.exitCode,
                    ok: result.ok,
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    duration: actionDuration
                });

                if (!result.ok) {
                    res.writeHead(result.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({
                        error: result.error || 'Action failed',
                        details: result.details || null
                    }));
                    return;
                }

                // Treat stderr containing an error emoji as a failure even when exit code is 0
                if (result.stderr && /^❌/.test(String(result.stderr).trim())) {
                    const errMsg = String(result.stderr).trim().split('\n')[0].replace(/^❌\s*/, '');
                    log(`Action stderr error (exit 0): ${errMsg}`);
                    res.writeHead(422, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: errMsg, details: result }));
                    return;
                }

                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(result));
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

        if (reqPath === '/api/analytics') {
            const forceReload = (req.url || '').includes('force=1');
            if (forceReload) analyticsCache = null;
            const analytics = getOrRecomputeAnalytics();
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(analytics));
            return;
        }

        // Create a new spec in the inbox
        if (reqPath === '/api/spec/create' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const repoPath = String(payload.repoPath || '').trim();
                    const type = String(payload.type || '').trim(); // features, research, feedback
                    const name = String(payload.name || '').trim();
                    if (!repoPath || !type || !name) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Missing repoPath, type, or name' }));
                        return;
                    }
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    if (!slug) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Invalid name' }));
                        return;
                    }
                    let inboxDir, fileName, template;
                    const titleName = name;
                    if (type === 'features') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'features', '01-inbox');
                        fileName = `feature-${slug}.md`;
                        template = `# Feature: ${titleName}\n\n## Summary\n\nDescribe the feature here.\n\n## User Stories\n\n- [ ] As a user, I can ...\n\n## Acceptance Criteria\n\n- [ ] ...\n\n## Technical Approach\n\n...\n\n## Validation\n\n...\n\n## Dependencies\n\n- None\n\n## Out of Scope\n\n- ...\n`;
                    } else if (type === 'research') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'research-topics', '01-inbox');
                        fileName = `research-${slug}.md`;
                        template = `# Research: ${titleName}\n\n## Context\n\nDescribe the research question or problem here.\n\n## Questions to Answer\n\n1. ...\n\n## Approach\n\n...\n\n## Success Criteria\n\nWhat does a good answer look like?\n`;
                    } else if (type === 'feedback') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'feedback', '01-inbox');
                        fileName = `feedback-${slug}.md`;
                        template = `---\ntitle: "${name}"\nstatus: "inbox"\ntype: "bug"\nreporter:\n  name: ""\n  identifier: ""\nsource:\n  channel: "dashboard"\n  reference: ""\n---\n\n## Summary\n\nDescribe the feedback here.\n\n## Steps to Reproduce\n\n1. ...\n\n## Expected Behaviour\n\n...\n\n## Actual Behaviour\n\n...\n`;
                    } else {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Invalid type: ' + type }));
                        return;
                    }
                    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
                    const filePath = path.join(inboxDir, fileName);
                    if (fs.existsSync(filePath)) {
                        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'File already exists: ' + fileName }));
                        return;
                    }
                    fs.writeFileSync(filePath, template, 'utf8');
                    log(`Created ${type} spec via dashboard: ${filePath}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, path: filePath, name: slug }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Read a spec file
        if (reqPath.startsWith('/api/spec') && req.method === 'GET') {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const filePath = url.searchParams.get('path') || '';
            if (!filePath || !filePath.endsWith('.md') || !fs.existsSync(filePath)) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'File not found' }));
                return;
            }
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ content, path: filePath }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // Write a spec file
        if (reqPath === '/api/spec' && req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const filePath = String(payload.path || '').trim();
                    const content = payload.content;
                    if (!filePath || !filePath.endsWith('.md') || typeof content !== 'string') {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Invalid path or content' }));
                        return;
                    }
                    if (!fs.existsSync(filePath)) {
                        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'File does not exist' }));
                        return;
                    }
                    fs.writeFileSync(filePath, content, 'utf8');
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Open file in default editor
        if (reqPath === '/api/open-in-editor' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const filePath = String(payload.path || '').trim();
                    if (!filePath || !fs.existsSync(filePath)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'File not found' }));
                        return;
                    }
                    execSync(`open ${JSON.stringify(filePath)}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/open-folder' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const folderPath = String(payload.path || '').trim();
                    if (!folderPath || !fs.existsSync(folderPath)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Path does not exist' }));
                        return;
                    }
                    execSync(`open ${JSON.stringify(folderPath)}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/repos/add' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const repoPath = String(payload.path || '').trim();
                    if (!repoPath) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'path is required' }));
                        return;
                    }
                    const expandedPath = repoPath.startsWith('~') ? repoPath.replace(/^~/, os.homedir()) : repoPath;
                    const absPath = path.resolve(expandedPath);
                    if (!fs.existsSync(absPath)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Path does not exist: ' + absPath }));
                        return;
                    }
                    const repos = readConductorReposFromGlobalConfig();
                    if (repos.includes(absPath)) {
                        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Repo already registered' }));
                        return;
                    }
                    repos.push(absPath);
                    writeRepoRegistry(repos);
                    log(`Repo added via dashboard: ${absPath}`);
                    latestStatus = collectDashboardStatusData();
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, repos }));
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/repos/remove' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const repoPath = String(payload.path || '').trim();
                    if (!repoPath) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'path is required' }));
                        return;
                    }
                    const repos = readConductorReposFromGlobalConfig();
                    const filtered = repos.filter(r => r !== repoPath);
                    if (filtered.length === repos.length) {
                        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Repo not found in registry' }));
                        return;
                    }
                    writeRepoRegistry(filtered);
                    log(`Repo removed via dashboard: ${repoPath}`);
                    latestStatus = collectDashboardStatusData();
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, repos: filtered }));
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // ── Session endpoints ──────────────────────────────────────────────────

        if (reqPath === '/api/sessions' && req.method === 'GET') {
            try {
                const enriched = getEnrichedSessions();
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(enriched));
            } catch (e) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ sessions: [], orphanCount: 0, error: e.message }));
            }
            return;
        }

        if (reqPath === '/api/sessions/cleanup' && req.method === 'POST') {
            try {
                const enriched = getEnrichedSessions();
                const orphans = enriched.sessions.filter(s => s.orphan);
                const killed = [];
                for (const s of orphans) {
                    try {
                        runTmux(['kill-session', '-t', s.name], { stdio: 'ignore' });
                        killed.push(s.name);
                        log(`Orphan killed: ${s.name} (reason: ${s.orphan.reason})`);
                    } catch (e) { /* ignore individual failures */ }
                }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true, killed, count: killed.length }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        if (reqPath === '/api/session/run' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const command = String(payload.command || '').trim();
                const cwd = String(payload.cwd || '').trim() || process.cwd();
                if (!command) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'command is required' })); return;
                }
                try {
                    const effectiveCwd = fs.existsSync(cwd) ? cwd : process.cwd();
                    const sessionStartTime = Date.now();
                    const result = spawnSync('sh', ['-c', command], {
                        cwd: effectiveCwd,
                        encoding: 'utf8',
                        timeout: 120000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, AIGON_DASHBOARD: '1' }
                    });
                    const exitCode = result.status !== null ? result.status : 1;
                    logToConsole({
                        type: 'session',
                        action: 'session/run',
                        args: [],
                        repoPath: effectiveCwd,
                        command,
                        exitCode,
                        ok: exitCode === 0,
                        stdout: result.stdout || '',
                        stderr: result.stderr || '',
                        duration: Date.now() - sessionStartTime
                    });
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: exitCode === 0, stdout: result.stdout || '', stderr: result.stderr || '', exitCode }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/session/stop' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const sessionName = String(payload.sessionName || '').trim();
                if (!sessionName) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'sessionName is required' })); return;
                }
                try {
                    runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
                    log(`Session killed: ${sessionName}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/session/status' && req.method === 'GET') {
            const sessionParam = (req.url || '').split('?')[1] || '';
            const session = (sessionParam.match(/(?:^|&)session=([^&]*)/) || [])[1] || '';
            if (!session) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'session query param is required' })); return;
            }
            const running = tmuxSessionExists(session);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ running }));
            return;
        }

        // ── Notification API ───────────────────────────────────────────────────
        if (reqPath === '/api/console' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ events: consoleBuffer.slice() }));
            return;
        }

        if (reqPath === '/api/notifications' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ events: notificationBuffer.slice(), unreadCount: notificationUnreadCount }));
            return;
        }

        if (reqPath === '/api/notifications/read' && req.method === 'POST') {
            notificationBuffer.forEach(e => { e.read = true; });
            notificationUnreadCount = 0;
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (reqPath === '/api/settings/notifications' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(getNotificationConfig()));
            return;
        }

        if (reqPath === '/api/settings/notifications' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const updates = JSON.parse(body || '{}');
                    // Read raw config file to avoid persisting computed defaults
                    let rawConfig = {};
                    try { rawConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8')); } catch (_) {}
                    const current = rawConfig.notifications || {};
                    const merged = { ...current };
                    if (typeof updates.enabled === 'boolean') merged.enabled = updates.enabled;
                    if (updates.types && typeof updates.types === 'object') {
                        merged.types = { ...(current.types || {}), ...updates.types };
                    }
                    rawConfig.notifications = merged;
                    saveGlobalConfig(rawConfig);
                    // Reload so in-memory state reflects new config
                    globalConfig = loadGlobalConfig();
                    log(`Notification settings updated: ${JSON.stringify(merged)}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, notifications: getNotificationConfig() }));
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath.startsWith('/assets/')) {
            const assetFile = path.join(ROOT_DIR, reqPath);
            if (fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
                const ext = path.extname(assetFile).toLowerCase();
                const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
                res.writeHead(200, { 'content-type': mime, 'cache-control': 'max-age=86400' });
                res.end(fs.readFileSync(assetFile));
            } else {
                res.writeHead(404);
                res.end();
            }
            return;
        }

        if (reqPath === '/favicon.ico') {
            const icoFile = path.join(ROOT_DIR, 'assets/icon/favicon.ico');
            if (fs.existsSync(icoFile)) {
                res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400' });
                res.end(fs.readFileSync(icoFile));
            } else {
                res.writeHead(204);
                res.end();
            }
            return;
        }

        const html = buildDashboardHtml(latestStatus, instanceName);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
    });

    const registryServerId = serverId || '';

    const shutdown = () => {
        log(`Dashboard shutting down (PID ${process.pid})`);
        deregisterDevServer(appId, registryServerId);
        server.close(() => process.exit(0));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    server.listen(port, host, () => {
        registerDevServer(appId, registryServerId, port, process.cwd(), process.pid);
        log(`Dashboard started (PID ${process.pid}, port ${port})`);
        if (proxyUrl) {
            console.log(`🚀 Dashboard: ${proxyUrl}  (also: ${localUrl})`);
        } else {
            console.log(`🚀 Dashboard: ${localUrl}`);
        }
        console.log('   Press Ctrl+C to stop');
        pollStatus();
        setInterval(pollStatus, 10000);
        resetIdleTimer();
        try { openInBrowser(dashboardUrl); } catch (e) { /* non-fatal */ }
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
        playwrightVerification: preset.playwrightVerification || '',
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
    const projectConfig = loadProjectConfig();
    const playwrightVerificationEnabled = projectConfig?.verification?.playwright?.enabled === true;
    const supportsPlaywrightVerification = profile.name === 'web' || profile.name === 'api';
    const playwrightVerification = playwrightVerificationEnabled && supportsPlaywrightVerification
        ? (profile.playwrightVerification || '')
        : '';

    return {
        WORKTREE_TEST_INSTRUCTIONS: profile.testInstructions,
        WORKTREE_DEP_CHECK: profile.depCheck,
        SETUP_ENV_LOCAL_LINE: profile.setupEnvLine,
        MANUAL_TESTING_GUIDANCE: profile.manualTestingGuidance || '',
        PLAYWRIGHT_VERIFICATION: playwrightVerification,
        STOP_DEV_SERVER_STEP: profile.devServer.enabled
            ? '## Step 2: Stop the dev server\n\nIf a dev server is running in this session, stop it now:\n```bash\naigon dev-server stop 2>/dev/null || true\n```'
            : ''
    };
}

/**
 * Resolve one task model override for an agent from a config object.
 * Supports both:
 * - agents.<agent>.<task>.model
 * - agents.<agent>.models.<task>
 * @returns {string|undefined}
 */
function getConfigModelValue(config, agentId, taskType) {
    if (!config || !config.agents || !config.agents[agentId]) return undefined;
    const agentConfig = config.agents[agentId];

    // Canonical shape: agents.<agent>.<task>.model
    if (agentConfig[taskType] && agentConfig[taskType].model) {
        return agentConfig[taskType].model;
    }

    // Backward-compatible shape: agents.<agent>.models.<task>
    if (agentConfig.models && agentConfig.models[taskType]) {
        return agentConfig.models[taskType];
    }

    return undefined;
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
        for (const taskType of ['research', 'implement', 'evaluate']) {
            const model = getConfigModelValue(globalConfig, agentId, taskType);
            if (model) {
                cli.models[taskType] = model;
            }
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
        for (const taskType of ['research', 'implement', 'evaluate']) {
            const model = getConfigModelValue(projectConfig, agentId, taskType);
            if (model) {
                cli.models[taskType] = model;
            }
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
    const projectModelValue = getConfigModelValue(projectConfig, agentId, taskType);
    if (projectModelValue) {
        return { value: projectModelValue, source: 'project' };
    }

    // 3. Global config
    const globalConfig = loadGlobalConfig();
    const globalModelValue = getConfigModelValue(globalConfig, agentId, taskType);
    if (globalModelValue) {
        return { value: globalModelValue, source: 'global' };
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

// Delegated to lib/git.js — single source of truth for git operations
const findWorktrees = git.listWorktrees;
const filterByFeatureId = git.filterWorktreesByFeature;

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
 * Parse a tmux session name to extract entity type, id, and agent.
 * Returns { type: 'f'|'r', id: string, agent: string } or null.
 */
function parseTmuxSessionName(name) {
    const match = name.match(/^.+-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!match) return null;
    return { type: match[1], id: match[2], agent: match[3] };
}

/**
 * Scan stage folders across all repos to find which stage an entity is in.
 * @param {string[]} repos - repo paths from conductor config
 * @param {'f'|'r'} entityType - 'f' for feature, 'r' for research
 * @param {string} entityId - numeric id (unpadded)
 * @returns {{ stage: string, repo: string } | null}
 */
function findEntityStage(repos, entityType, entityId) {
    const unpadded = toUnpaddedId(entityId);
    for (const repoPath of repos) {
        const absRepo = path.resolve(repoPath);
        if (entityType === 'f') {
            const featureRoot = path.join(absRepo, 'docs', 'specs', 'features');
            const stages = [
                { dir: '01-inbox', stage: 'inbox' },
                { dir: '02-backlog', stage: 'backlog' },
                { dir: '03-in-progress', stage: 'in-progress' },
                { dir: '04-in-evaluation', stage: 'in-evaluation' },
                { dir: '05-done', stage: 'done' },
                { dir: '06-paused', stage: 'paused' }
            ];
            for (const { dir, stage } of stages) {
                const fullDir = path.join(featureRoot, dir);
                if (!fs.existsSync(fullDir)) continue;
                try {
                    const files = fs.readdirSync(fullDir);
                    const pattern = new RegExp('^feature-0*' + unpadded + '-.+\\.md$');
                    if (files.some(f => pattern.test(f))) {
                        return { stage, repo: absRepo };
                    }
                } catch (e) { /* ignore */ }
            }
        } else {
            const researchRoot = path.join(absRepo, 'docs', 'specs', 'research-topics');
            const stages = [
                { dir: '01-inbox', stage: 'inbox' },
                { dir: '02-backlog', stage: 'backlog' },
                { dir: '03-in-progress', stage: 'in-progress' },
                { dir: '04-done', stage: 'done' },
                { dir: '05-paused', stage: 'paused' }
            ];
            for (const { dir, stage } of stages) {
                const fullDir = path.join(researchRoot, dir);
                if (!fs.existsSync(fullDir)) continue;
                try {
                    const files = fs.readdirSync(fullDir);
                    const pattern = new RegExp('^research-0*' + unpadded + '-.+\\.md$');
                    if (files.some(f => pattern.test(f))) {
                        return { stage, repo: absRepo };
                    }
                } catch (e) { /* ignore */ }
            }
        }
    }
    return null;
}

/**
 * Classify why a session is orphaned.
 * @returns {{ reason: string } | null}
 */
function classifyOrphanReason(parsed, stageResult) {
    if (!parsed) return null;
    if (!stageResult) return { reason: 'spec-missing' };
    if (stageResult.stage === 'done') return { reason: 'done' };
    if (stageResult.stage === 'paused') return { reason: 'paused' };
    return null;
}

/**
 * List tmux sessions enriched with entity and orphan data.
 * @returns {{ sessions: Array, orphanCount: number }}
 */
function getEnrichedSessions() {
    assertTmuxAvailable();
    const fmt = '#{session_name}\t#{session_created}\t#{session_attached}';
    const result = runTmux(['list-sessions', '-F', fmt], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) {
        return { sessions: [], orphanCount: 0 };
    }
    const repos = readConductorReposFromGlobalConfig();
    const sessions = result.stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, createdEpoch, attached] = line.split('\t');
        const trimmedName = name.trim();
        const parsed = parseTmuxSessionName(trimmedName);
        const stageResult = parsed ? findEntityStage(repos, parsed.type, parsed.id) : null;
        const orphan = parsed ? classifyOrphanReason(parsed, stageResult) : null;
        return {
            name: trimmedName,
            createdAt: new Date(parseInt(createdEpoch, 10) * 1000).toISOString(),
            attached: attached.trim() === '1',
            entityType: parsed ? parsed.type : null,
            entityId: parsed ? parsed.id : null,
            agent: parsed ? parsed.agent : null,
            stage: stageResult ? stageResult.stage : null,
            orphan: orphan
        };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const orphanCount = sessions.filter(s => s.orphan).length;
    return { sessions, orphanCount };
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

function resolveTmuxBinary() {
    const candidates = [
        process.env.AIGON_TMUX_PATH,
        process.env.TMUX_BINARY,
        '/opt/homebrew/bin/tmux',
        '/usr/local/bin/tmux',
        '/usr/bin/tmux',
        'tmux'
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const result = spawnSync(candidate, ['-V'], { stdio: 'ignore' });
            if (!result.error && result.status === 0) return candidate;
        } catch (e) {
            // continue
        }
    }
    return null;
}

function runTmux(args, options = {}) {
    const tmuxBin = resolveTmuxBinary();
    if (!tmuxBin) {
        return { status: 1, error: new Error('tmux is not installed or not available in PATH') };
    }
    return spawnSync(tmuxBin, args, options);
}

function assertTmuxAvailable() {
    const result = runTmux(['-V'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error('tmux is not installed or not available in PATH');
    }
}

function tmuxSessionExists(sessionName) {
    const result = runTmux(['has-session', '-t', sessionName], { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

function createDetachedTmuxSession(sessionName, cwd, command) {
    const args = ['new-session', '-d', '-s', sessionName, '-c', cwd];
    // Wrap in bash -c so shell syntax (&&, unset, etc.) works correctly.
    // Without this, tmux passes the command directly to exec() which can't handle shell builtins.
    if (command) args.push(`bash -lc ${shellQuote(command)}`);
    const result = runTmux(args, { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error(`Failed to create tmux session "${sessionName}"`);
    }
    // Set terminal window title to the session name so windows are identifiable
    runTmux(['set-option', '-t', sessionName, 'set-titles', 'on'], { stdio: 'ignore' });
    runTmux(['set-option', '-t', sessionName, 'set-titles-string', '#{session_name}'], { stdio: 'ignore' });
    // Name the default window so menubar and list-windows show meaningful names
    runTmux(['rename-window', '-t', `${sessionName}:0`, sessionName], { stdio: 'ignore' });
}

function isTmuxSessionAttached(sessionName) {
    if (!sessionName) return false;
    const result = runTmux(['list-clients', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) return false;
    return result.stdout
        .split('\n')
        .map(line => line.trim())
        .some(name => name === sessionName);
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

        // If the target tmux session is already attached anywhere, avoid spawning
        // another iTerm2 window; just bring iTerm2 forward.
        if (title && isTmuxSessionAttached(title)) {
            spawnSync('osascript', ['-e', 'tell application "iTerm2" to activate'], { stdio: 'ignore' });
            return;
        }

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
        // For tmux specifically, use resolveTmuxBinary() which has hardcoded paths as fallback
        // (the daemon's PATH may not include /opt/homebrew/bin).
        const resolvedCommand = command.replace(/^(\S+)/, (bin) => {
            if (bin === 'tmux') {
                const resolved = resolveTmuxBinary();
                if (resolved) return resolved;
            }
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

/**
 * Tile all iTerm2 windows into an optimal grid, grouped by session name prefix.
 * Windows with related titles (same repo + feature/research) are placed adjacent.
 * Layout: 3 columns, rows split evenly. Adjusts if fewer windows.
 */
function tileITerm2Windows() {
    // Step 1: Get all iTerm2 window IDs and session names via AppleScript
    const getWindowsScript = `
tell application "iTerm2"
    set output to ""
    repeat with w in windows
        set wId to id of w
        set wName to ""
        try
            set wName to name of current session of current tab of w
        end try
        set output to output & wId & "|||" & wName & "\\n"
    end repeat
    return output
end tell
`;
    const result = spawnSync('osascript', ['-e', getWindowsScript], { encoding: 'utf8', stdio: 'pipe' });
    if (result.error || result.status !== 0) {
        throw new Error('Failed to query iTerm2 windows. Is iTerm2 running?');
    }

    const windows = result.stdout.trim().split('\n')
        .map(line => {
            const [id, name] = line.split('|||');
            return { id: id ? id.trim() : '', name: name ? name.trim() : '' };
        })
        .filter(w => w.id);

    if (windows.length === 0) {
        console.log('No iTerm2 windows found.');
        return;
    }

    // Step 2: Parse session name into sortable parts
    // Patterns: "repo-f45-cc-desc" or "repo-r9-cc"
    const AGENT_ORDER = { cc: 0, cx: 1, gg: 2 };
    function parseName(name) {
        const m = name.match(/^(.+)-([fr])(\d+)-([a-z]{2})/);
        if (m) return { repo: m[1], type: m[2], id: Number(m[3]), agent: m[4] };
        return { repo: name || '~ungrouped', type: 'z', id: 0, agent: '' };
    }

    // Sort: repo → feature/research type+id → agent (cc, cx, gg)
    windows.sort((a, b) => {
        const pa = parseName(a.name);
        const pb = parseName(b.name);
        if (pa.repo !== pb.repo) return pa.repo.localeCompare(pb.repo);
        if (pa.type !== pb.type) return pa.type.localeCompare(pb.type);
        if (pa.id !== pb.id) return pa.id - pb.id;
        const ao = AGENT_ORDER[pa.agent] ?? 99;
        const bo = AGENT_ORDER[pb.agent] ?? 99;
        return ao - bo;
    });

    // Step 3: Calculate grid layout
    const count = windows.length;
    const cols = Math.min(count, 3);
    const rows = Math.ceil(count / cols);

    // Step 4: Get screen dimensions for the screen containing the front iTerm2 window.
    // Uses JXA to read the front window's position, then finds the matching NSScreen
    // visible frame (excludes menu bar and dock).
    const screenScript = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

// Get front iTerm2 window bounds
var app = Application('iTerm2');
var frontBounds = app.windows[0].bounds();
var winMidX = frontBounds.x + frontBounds.width / 2;
var winMidY = frontBounds.y + frontBounds.height / 2;

// Find which screen contains the window center
var screens = $.NSScreen.screens;
var count = screens.count;
var primaryHeight = $.NSScreen.screens.objectAtIndex(0).frame.size.height;

var bestX = 0, bestY = 0, bestW = 2560, bestH = 1400;
for (var i = 0; i < count; i++) {
    var scr = screens.objectAtIndex(i);
    var frame = scr.frame;
    // NSScreen uses bottom-left origin; convert to top-left for comparison with window bounds
    var tlX = frame.origin.x;
    var tlY = primaryHeight - frame.origin.y - frame.size.height;
    var tlX2 = tlX + frame.size.width;
    var tlY2 = tlY + frame.size.height;
    if (winMidX >= tlX && winMidX < tlX2 && winMidY >= tlY && winMidY < tlY2) {
        // Use visibleFrame to exclude menu bar and dock
        var vis = scr.visibleFrame;
        bestX = vis.origin.x;
        // Convert visibleFrame (bottom-left origin) to top-left origin
        bestY = primaryHeight - vis.origin.y - vis.size.height;
        bestW = vis.size.width;
        bestH = vis.size.height;
        break;
    }
}
bestX + ',' + bestY + ',' + bestW + ',' + bestH;
`;
    const screenResult = spawnSync('osascript', ['-l', 'JavaScript', '-e', screenScript], { encoding: 'utf8', stdio: 'pipe' });
    let screenX = 0, screenY = 25, screenW = 2560, screenH = 1415;
    if (screenResult.stdout) {
        const parts = screenResult.stdout.trim().split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            screenX = parts[0];
            screenY = parts[1];
            screenW = parts[2];
            screenH = parts[3];
        }
    }

    // Step 5: Position each window
    const cellW = Math.floor(screenW / cols);
    const cellH = Math.floor(screenH / rows);

    const positionLines = windows.map((w, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x1 = screenX + col * cellW;
        const y1 = screenY + row * cellH;
        const x2 = x1 + cellW;
        const y2 = y1 + cellH;
        return `
            repeat with w in windows
                if id of w is ${w.id} then
                    set bounds of w to {${x1}, ${y1}, ${x2}, ${y2}}
                end if
            end repeat`;
    }).join('\n');

    const tileScript = `
tell application "iTerm2"
${positionLines}
end tell
`;
    const tileResult = spawnSync('osascript', ['-e', tileScript], { encoding: 'utf8', stdio: 'pipe' });
    if (tileResult.error || tileResult.status !== 0) {
        const errMsg = tileResult.stderr ? tileResult.stderr.trim() : 'unknown error';
        throw new Error(`Failed to tile iTerm2 windows: ${errMsg}`);
    }

    console.log(`✅ Tiled ${count} iTerm2 window${count === 1 ? '' : 's'} into ${cols}×${rows} grid`);
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
        console.error(`\n   Override with: aigon feature-open <ID> --terminal=warp`);
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

    if (!fs.existsSync(logsDirPath)) {
        fs.mkdirSync(logsDirPath, { recursive: true });
    }
    const logName = `feature-${featureId}-${agentId}-${desc}-log.md`;
    const logPath = path.join(logsDirPath, logName);
    const nowIso = new Date().toISOString();
    const template = `---\nstatus: implementing\nupdated: ${nowIso}\nstartedAt: ${nowIso}\nevents:\n  - { ts: "${nowIso}", status: implementing }\n---\n\n# Implementation Log: Feature ${featureId} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
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

/**
 * Parse log file frontmatter, including a YAML events array.
 * Returns { fields: {key: value}, events: [{ts, status}] }
 */
function parseLogFrontmatterFull(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return { fields: {}, events: [] };
    const block = m[1];
    const fields = {};
    const events = [];
    let inEvents = false;
    for (const line of block.split('\n')) {
        if (/^events:/.test(line)) {
            inEvents = true;
            continue;
        }
        if (inEvents) {
            if (line.startsWith('  - ')) {
                const tsMatch = line.match(/ts:\s*"([^"]+)"/);
                const statusMatch = line.match(/status:\s*(\w+)/);
                if (tsMatch && statusMatch) {
                    events.push({ ts: tsMatch[1], status: statusMatch[1] });
                }
            } else if (line && !/^\s/.test(line)) {
                inEvents = false;
                const idx = line.indexOf(':');
                if (idx !== -1) {
                    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
                }
            }
        } else {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key) fields[key] = value;
        }
    }
    return { fields, events };
}

/**
 * Serialize frontmatter fields + events array back to YAML block string.
 */
function serializeLogFrontmatter(fields, events) {
    const lines = ['---'];
    const ordered = ['status', 'updated', 'startedAt', 'completedAt'];
    const written = new Set();
    for (const key of ordered) {
        if (fields[key] !== undefined) {
            lines.push(`${key}: ${fields[key]}`);
            written.add(key);
        }
    }
    for (const [key, value] of Object.entries(fields)) {
        if (!written.has(key)) {
            lines.push(`${key}: ${value}`);
        }
    }
    if (events && events.length > 0) {
        lines.push('events:');
        for (const e of events) {
            lines.push(`  - { ts: "${e.ts}", status: ${e.status} }`);
        }
    }
    lines.push('---');
    return lines.join('\n') + '\n';
}

/**
 * Update log frontmatter in place: update status/updated, optionally set
 * startedAt (first implementing), completedAt, and append an event entry.
 * @param {string} logPath - absolute path to the log file
 * @param {object} opts - { status, appendEvent, setStartedAt, setCompletedAt }
 */
function updateLogFrontmatterInPlace(logPath, opts) {
    let content;
    try {
        content = fs.readFileSync(logPath, 'utf8');
    } catch (e) {
        return false;
    }
    const nowIso = new Date().toISOString();
    const { fields, events } = parseLogFrontmatterFull(content);

    if (opts.status) fields.status = opts.status;
    fields.updated = nowIso;
    if (opts.setStartedAt && !fields.startedAt) {
        fields.startedAt = nowIso;
    }
    if (opts.setCompletedAt) {
        fields.completedAt = opts.setCompletedAt === true ? nowIso : opts.setCompletedAt;
    }
    if (opts.appendEvent) {
        events.push({ ts: nowIso, status: opts.appendEvent });
    }
    if (opts.setCycleTimeExclude) {
        fields.cycleTimeExclude = 'true';
    }

    const newFrontmatter = serializeLogFrontmatter(fields, events);
    if (content.startsWith('---\n')) {
        content = content.replace(/^---\n[\s\S]*?\n---\n/, newFrontmatter);
    } else {
        content = newFrontmatter + '\n' + content;
    }
    fs.writeFileSync(logPath, content);
    return true;
}

/**
 * Build series buckets for volume metrics.
 * Returns { daily: [{date, count}], weekly: [...], monthly: [...], quarterly: [...] }
 */
function buildCompletionSeries(allFeatures) {
    const now = new Date();
    function isoWeek(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y = t.getUTCFullYear();
        const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return `${y}-W${String(w).padStart(2, '0')}`;
    }
    function toDateKey(ts) {
        const d = new Date(ts);
        return d.toISOString().slice(0, 10);
    }
    function toMonthKey(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    function toQuarterKey(ts) {
        const d = new Date(ts);
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${q}`;
    }

    const daily = {}, weekly = {}, monthly = {}, quarterly = {};
    // Pre-populate last 30 days
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        daily[d.toISOString().slice(0, 10)] = 0;
    }
    // Pre-populate last 12 weeks
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 7 * 86400000);
        weekly[isoWeek(d)] = 0;
    }
    // Pre-populate last 12 months
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthly[toMonthKey(d)] = 0;
    }
    // Pre-populate last 8 quarters
    for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
        quarterly[toQuarterKey(d)] = 0;
    }

    allFeatures.forEach(f => {
        if (!f.completedTime) return;
        const ts = f.completedTime;
        const dk = toDateKey(ts);
        const wk = isoWeek(new Date(ts));
        const mk = toMonthKey(ts);
        const qk = toQuarterKey(ts);
        if (dk in daily) daily[dk]++;
        if (wk in weekly) weekly[wk]++;
        if (mk in monthly) monthly[mk]++;
        if (qk in quarterly) quarterly[qk]++;
    });

    return {
        daily: Object.entries(daily).map(([date, count]) => ({ date, count })),
        weekly: Object.entries(weekly).map(([week, count]) => ({ week, count })),
        monthly: Object.entries(monthly).map(([month, count]) => ({ month, count })),
        quarterly: Object.entries(quarterly).map(([quarter, count]) => ({ quarter, count }))
    };
}

/**
 * Build weekly autonomy trend from features.
 */
function buildWeeklyAutonomyTrend(allFeatures) {
    const byWeek = {};
    function isoWeek(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y = t.getUTCFullYear();
        const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return `${y}-W${String(w).padStart(2, '0')}`;
    }
    allFeatures.forEach(f => {
        if (!f.completedTime || f.autonomyRatio === null) return;
        const wk = isoWeek(new Date(f.completedTime));
        if (!byWeek[wk]) byWeek[wk] = { sum: 0, count: 0 };
        byWeek[wk].sum += f.autonomyRatio;
        byWeek[wk].count++;
    });
    return Object.entries(byWeek)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([week, { sum, count }]) => ({
            week,
            score: Math.round(sum / count * 100) / 100
        }));
}

/**
 * Collect analytics data across all registered repos.
 * Returns the analytics payload object.
 */
function collectAnalyticsData(globalConfig) {
    const repos = (globalConfig && Array.isArray(globalConfig.repos))
        ? globalConfig.repos
        : readConductorReposFromGlobalConfig();
    const now = new Date();
    const nowTs = now.getTime();
    const today = new Date(now.toDateString()).getTime();
    const d7 = nowTs - 7 * 24 * 60 * 60 * 1000;
    const d30 = nowTs - 30 * 24 * 60 * 60 * 1000;
    const d90 = nowTs - 90 * 24 * 60 * 60 * 1000;

    const analyticsConfig = (globalConfig && globalConfig.analytics) || {};
    const activeHours = analyticsConfig.activeHours || { start: 8, end: 23 };
    let timezone = analyticsConfig.timezone;
    if (!timezone) {
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { timezone = 'UTC'; }
    }

    const allFeatures = [];
    const evalWins = {}; // agent -> { wins, evals }
    const evalWinsByRepo = []; // { repoPath, agent, wins, evals } — for per-repo filtering

    repos.forEach(repoPath => {
        const absRepo = path.resolve(repoPath);
        const doneDir = path.join(absRepo, 'docs', 'specs', 'features', '05-done');
        const selectedLogsDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs', 'selected');
        const evalsDir = path.join(absRepo, 'docs', 'specs', 'features', 'evaluations');

        // Parse eval files for win rates
        if (fs.existsSync(evalsDir)) {
            try {
                const repoEvalMap = {}; // agent -> { wins, evals } for this repo
                fs.readdirSync(evalsDir)
                    .filter(f => f.endsWith('.md'))
                    .forEach(evalFile => {
                        try {
                            const content = fs.readFileSync(path.join(evalsDir, evalFile), 'utf8');
                            const participantMatches = content.match(/^- \[.?\] \*\*([a-z]{2})\*\*/gm) || [];
                            const participants = [...new Set(
                                participantMatches
                                    .map(m => { const mm = m.match(/\*\*([a-z]{2})\*\*/); return mm ? mm[1] : null; })
                                    .filter(Boolean)
                            )];
                            participants.forEach(a => {
                                if (!evalWins[a]) evalWins[a] = { wins: 0, evals: 0 };
                                evalWins[a].evals++;
                                if (!repoEvalMap[a]) repoEvalMap[a] = { wins: 0, evals: 0 };
                                repoEvalMap[a].evals++;
                            });
                            const winnerMatch = content.match(/\*\*Winner:\*\*\s*\*\*([a-z]{2})\b/mi);
                            if (winnerMatch) {
                                const winner = winnerMatch[1].toLowerCase();
                                if (!evalWins[winner]) evalWins[winner] = { wins: 0, evals: 0 };
                                evalWins[winner].wins++;
                                if (!repoEvalMap[winner]) repoEvalMap[winner] = { wins: 0, evals: 0 };
                                repoEvalMap[winner].wins++;
                            }
                        } catch (e) { /* ignore */ }
                    });
                Object.entries(repoEvalMap).forEach(([agent, data]) => {
                    evalWinsByRepo.push({ repoPath: absRepo, agent, wins: data.wins, evals: data.evals });
                });
            } catch (e) { /* ignore */ }
        }

        // Scan completed features
        if (!fs.existsSync(doneDir)) return;
        let doneFiles;
        try {
            doneFiles = fs.readdirSync(doneDir).filter(f => /^feature-\d+-.+\.md$/.test(f));
        } catch (e) { return; }

        doneFiles.forEach(specFile => {
            const specMatch = specFile.match(/^feature-(\d+)-(.+)\.md$/);
            if (!specMatch) return;
            const featureNum = specMatch[1];
            const desc = specMatch[2];

            // Find selected log — prefer standard *-log.md, fall back to legacy *-YYYY-MM-DD.md
            let selectedLogPath = null;
            let legacyLogDate = null; // date extracted from legacy filename
            let winnerAgent = 'solo';
            if (fs.existsSync(selectedLogsDir)) {
                try {
                    const allLogs = fs.readdirSync(selectedLogsDir)
                        .filter(f => f.startsWith(`feature-${featureNum}-`));
                    const standardLogs = allLogs.filter(f => f.endsWith('-log.md'));
                    const legacyLogs = allLogs.filter(f => /\d{4}-\d{2}-\d{2}\.md$/.test(f));
                    const chosen = standardLogs.length > 0 ? standardLogs[0]
                        : legacyLogs.length > 0 ? legacyLogs[0] : null;
                    if (chosen) {
                        selectedLogPath = path.join(selectedLogsDir, chosen);
                        const agentMatch = chosen.match(/^feature-\d+-([a-z]{2})-.+-log\.md$/);
                        winnerAgent = agentMatch ? agentMatch[1] : 'solo';
                        // For legacy filenames, extract date as completedAt fallback
                        const dateMatch = chosen.match(/(\d{4}-\d{2}-\d{2})\.md$/);
                        if (dateMatch) legacyLogDate = dateMatch[1] + 'T12:00:00.000Z';
                    }
                } catch (e) { /* ignore */ }
            }

            // Parse log frontmatter
            let fmFields = {};
            let fmEvents = [];
            if (selectedLogPath) {
                try {
                    const parsed = parseLogFrontmatterFull(fs.readFileSync(selectedLogPath, 'utf8'));
                    fmFields = parsed.fields;
                    fmEvents = parsed.events;
                } catch (e) { /* ignore */ }
            }

            let startedAt = fmFields.startedAt || null;
            let completedAt = fmFields.completedAt || null;

            // Infer completedAt: legacy log filename date > spec file mtime
            if (!completedAt && legacyLogDate) {
                completedAt = legacyLogDate;
            }
            if (!completedAt) {
                try {
                    completedAt = new Date(fs.statSync(path.join(doneDir, specFile)).mtime).toISOString();
                } catch (e) { /* ignore */ }
            }
            // Infer startedAt from log file mtime if missing
            if (!startedAt && selectedLogPath) {
                try {
                    startedAt = new Date(fs.statSync(selectedLogPath).mtime).toISOString();
                } catch (e) { /* ignore */ }
            }

            const completedTime = completedAt ? new Date(completedAt).getTime() : null;
            const startedTime = startedAt ? new Date(startedAt).getTime() : null;
            const durationMs = (startedTime && completedTime && completedTime > startedTime)
                ? completedTime - startedTime : null;

            // Check autonomous flag in log content
            let autonomousMode = false;
            if (selectedLogPath) {
                try {
                    autonomousMode = /--autonomous/.test(fs.readFileSync(selectedLogPath, 'utf8'));
                } catch (e) { /* ignore */ }
            }

            // Calculate autonomy from events
            let waitCount = 0;
            let totalWaitMs = 0;
            let wallTimeMs = null;
            let firstPassSuccess = null;

            if (fmEvents.length >= 2) {
                const firstImpl = fmEvents.find(e => e.status === 'implementing');
                const lastSubmit = [...fmEvents].reverse().find(e => e.status === 'submitted');
                if (firstImpl && lastSubmit) {
                    wallTimeMs = new Date(lastSubmit.ts).getTime() - new Date(firstImpl.ts).getTime();
                }
                for (let i = 0; i < fmEvents.length - 1; i++) {
                    if (fmEvents[i].status === 'waiting') {
                        waitCount++;
                        const nextImpl = fmEvents.slice(i + 1).find(e => e.status === 'implementing');
                        if (nextImpl) {
                            totalWaitMs += new Date(nextImpl.ts).getTime() - new Date(fmEvents[i].ts).getTime();
                        }
                    }
                }
                firstPassSuccess = !fmEvents.some(e => e.status === 'waiting');
            }

            const autonomyRatio = (wallTimeMs && wallTimeMs > 0)
                ? Math.max(0, Math.min(1, 1 - totalWaitMs / wallTimeMs))
                : null;

            const cycleTimeExclude = fmFields.cycleTimeExclude === 'true' || fmFields.cycleTimeExclude === true;

            allFeatures.push({
                repoPath: absRepo,
                featureNum,
                desc,
                winnerAgent,
                completedAt,
                startedAt,
                completedTime,
                startedTime,
                durationMs,
                wallTimeMs,
                totalWaitMs,
                waitCount,
                firstPassSuccess,
                autonomousMode,
                autonomyRatio,
                cycleTimeExclude
            });
        });
    });

    const inPeriod = (ts, since) => ts !== null && ts !== undefined && ts >= since;
    const f7d = allFeatures.filter(f => inPeriod(f.completedTime, d7));
    const f30d = allFeatures.filter(f => inPeriod(f.completedTime, d30));
    const f90d = allFeatures.filter(f => inPeriod(f.completedTime, d90));
    const fToday = allFeatures.filter(f => inPeriod(f.completedTime, today));

    // Volume
    const series = buildCompletionSeries(allFeatures);
    const volume = {
        completedToday: fToday.length,
        completed7d: f7d.length,
        completed30d: f30d.length,
        completed90d: f90d.length,
        series
    };

    // Compute trend indicators (30d vs prior 30d)
    const d60 = nowTs - 60 * 24 * 60 * 60 * 1000;
    const prior30d = allFeatures.filter(f => inPeriod(f.completedTime, d60) && !inPeriod(f.completedTime, d30));
    volume.trend30d = prior30d.length > 0
        ? Math.round(((f30d.length - prior30d.length) / prior30d.length) * 100)
        : null;

    // Autonomy
    const featWithAutonomy = f30d.filter(f => f.autonomyRatio !== null);
    const autonomyScore = featWithAutonomy.length > 0
        ? featWithAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / featWithAutonomy.length
        : null;
    const featWithWaits = f30d.filter(f => f.wallTimeMs !== null);
    const avgWaitEvents = featWithWaits.length > 0
        ? featWithWaits.reduce((s, f) => s + f.waitCount, 0) / featWithWaits.length
        : null;
    const featWithFirstPass = f30d.filter(f => f.firstPassSuccess !== null);
    const firstPassSuccessRate = featWithFirstPass.length > 0
        ? featWithFirstPass.filter(f => f.firstPassSuccess).length / featWithFirstPass.length
        : null;
    const autonomousModeAdoption = f30d.length > 0
        ? f30d.filter(f => f.autonomousMode).length / f30d.length
        : null;
    const featWithTouchTime = f30d.filter(f => f.wallTimeMs && f.wallTimeMs > 0);
    const avgTouchTimeRatio = featWithTouchTime.length > 0
        ? featWithTouchTime.reduce((s, f) => s + (f.totalWaitMs / f.wallTimeMs), 0) / featWithTouchTime.length
        : null;
    const weeklyTrend = buildWeeklyAutonomyTrend(allFeatures);

    const autonomy = {
        score: autonomyScore !== null ? Math.round(autonomyScore * 100) / 100 : null,
        avgWaitEventsPerFeature: avgWaitEvents !== null ? Math.round(avgWaitEvents * 10) / 10 : null,
        autonomousModeAdoption: autonomousModeAdoption !== null ? Math.round(autonomousModeAdoption * 100) / 100 : null,
        firstPassSuccessRate: firstPassSuccessRate !== null ? Math.round(firstPassSuccessRate * 100) / 100 : null,
        avgTouchTimeRatio: avgTouchTimeRatio !== null ? Math.round(avgTouchTimeRatio * 100) / 100 : null,
        overnightCommitPct: null,
        trend: weeklyTrend
    };

    // Quality
    const featWithDuration = f30d.filter(f => f.durationMs !== null && f.durationMs > 0 && !f.cycleTimeExclude);
    const durHours = featWithDuration.map(f => f.durationMs / (1000 * 3600)).sort((a, b) => a - b);
    const round1 = v => Math.round(v * 10) / 10;
    const durMid = Math.floor(durHours.length / 2);
    const quality = {
        durationHours: {
            average: durHours.length > 0 ? round1(durHours.reduce((s, v) => s + v, 0) / durHours.length) : null,
            median: durHours.length > 0 ? round1(durHours.length % 2 ? durHours[durMid] : (durHours[durMid - 1] + durHours[durMid]) / 2) : null,
            max: durHours.length > 0 ? round1(durHours[durHours.length - 1]) : null
        },
        avgIterationsPerFeature: avgWaitEvents !== null ? round1(1 + avgWaitEvents / 2) : null,
        cycleTrend: []
    };

    // Agent performance
    const agentMap = {};
    allFeatures.forEach(f => {
        const agent = f.winnerAgent || 'solo';
        if (!agentMap[agent]) agentMap[agent] = [];
        agentMap[agent].push(f);
    });
    const agents = Object.entries(agentMap).map(([agent, feats]) => {
        const recent = feats.filter(f => inPeriod(f.completedTime, d30));
        const withAutonomy = feats.filter(f => f.autonomyRatio !== null);
        const agentAutonomy = withAutonomy.length > 0
            ? withAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / withAutonomy.length : null;
        const withFP = feats.filter(f => f.firstPassSuccess !== null);
        const agentFP = withFP.length > 0
            ? withFP.filter(f => f.firstPassSuccess).length / withFP.length : null;
        const withDur = feats.filter(f => f.durationMs !== null && f.durationMs > 0 && !f.cycleTimeExclude);
        const agentDurSorted = withDur.map(f => f.durationMs / (1000 * 3600)).sort((a, b) => a - b);
        const agentMid = Math.floor(agentDurSorted.length / 2);
        const agentCycle = agentDurSorted.length > 0
            ? (agentDurSorted.length % 2 ? agentDurSorted[agentMid] : (agentDurSorted[agentMid - 1] + agentDurSorted[agentMid]) / 2) : null;
        return {
            agent,
            completed: feats.length,
            completed30d: recent.length,
            autonomyScore: agentAutonomy !== null ? Math.round(agentAutonomy * 100) / 100 : null,
            firstPassRate: agentFP !== null ? Math.round(agentFP * 100) / 100 : null,
            avgCycleHours: agentCycle !== null ? round1(agentCycle) : null
        };
    }).sort((a, b) => b.completed - a.completed);

    // Eval wins
    const evalWinsArray = Object.entries(evalWins)
        .map(([agent, data]) => ({
            agent,
            wins: data.wins,
            evals: data.evals,
            winRate: data.evals > 0 ? Math.round(data.wins / data.evals * 100) / 100 : 0
        }))
        .sort((a, b) => b.wins - a.wins);

    return {
        generatedAt: new Date().toISOString(),
        config: { activeHours, timezone },
        volume,
        autonomy,
        quality,
        agents,
        evalWins: evalWinsArray,
        evalWinsByRepo,
        features: allFeatures.map(f => ({
            featureNum: f.featureNum,
            desc: f.desc,
            repoPath: f.repoPath,
            winnerAgent: f.winnerAgent,
            completedAt: f.completedAt,
            startedAt: f.startedAt,
            durationMs: f.durationMs,
            waitCount: f.waitCount,
            firstPassSuccess: f.firstPassSuccess,
            autonomousMode: f.autonomousMode,
            autonomyRatio: f.autonomyRatio,
            cycleTimeExclude: f.cycleTimeExclude || false
        }))
    };
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

// Delegated to lib/git.js — single source of truth for git operations
const runGit = git.run;

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

// Replace both the pre-marker zone and the marker block in a root file.
// preMarkerContent: content from docs/aigon-project.md or scaffold fallback
// markerContent: the generated agent instructions (between AIGON_START/END)
function upsertRootFile(filePath, preMarkerContent, markerContent) {
    const markedBlock = `${MARKER_START}\n${markerContent}\n${MARKER_END}`;
    const fullContent = preMarkerContent + markedBlock + '\n';

    if (!fs.existsSync(filePath)) {
        safeWrite(filePath, fullContent);
        return 'created';
    }

    const existing = fs.readFileSync(filePath, 'utf8');
    // Match everything from start of file through the end marker (including trailing newline)
    const fullRegex = new RegExp(`[\\s\\S]*?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`);

    if (fullRegex.test(existing)) {
        const updated = existing.replace(fullRegex, () => fullContent);
        if (updated === existing) {
            return 'unchanged';
        }
        fs.writeFileSync(filePath, updated);
        return 'updated';
    } else {
        // No markers found: append markers at end
        fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + markedBlock + '\n');
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
    'feature-open': { aliases: ['afo'], argHints: '<ID> [agent] [--all] [--terminal=<type>]' },
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
    'dashboard': { argHints: '[list | open [name] | add [path] | remove [path]]', disableModelInvocation: true },
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

// Read docs/aigon-project.md if present; otherwise fall back to scaffold content.
function getProjectInstructions() {
    const projectFilePath = path.join(process.cwd(), 'docs', 'aigon-project.md');
    if (fs.existsSync(projectFilePath)) {
        return fs.readFileSync(projectFilePath, 'utf8');
    }
    return getScaffoldContent();
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
    return upsertRootFile(agentsFilePath, getProjectInstructions(), agentsContent);
}

// Delegated to lib/git.js — single source of truth for git operations
// getStatus(cwd) handles both current-dir and worktree-path status with .env filtering
const getWorktreeStatus = (worktreePath) => git.getStatus(worktreePath);

/**
 * Safely remove a git worktree by detaching it from git, then moving the
 * directory to macOS Trash (or falling back to rm -rf on other platforms).
 *
 * This ensures accidentally-uncommitted work can be recovered from the Trash.
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @param {object} [options] - Options
 * @param {boolean} [options.force] - Force removal even if dirty (still moves to Trash)
 * @returns {boolean} - True if removed successfully
 */
function safeRemoveWorktree(worktreePath) {
    if (!worktreePath || !fs.existsSync(worktreePath)) return false;

    // Step 1: Detach worktree from git (without --force which deletes files)
    try {
        // Use 'git worktree remove' with --force to detach, but we want to keep the files.
        // Instead, manually prune by removing the worktree link from .git/worktrees/
        // and then move the directory to Trash.
        const worktreeName = path.basename(worktreePath);
        const mainGitDir = execSync(`git -C "${worktreePath}" rev-parse --git-common-dir`, { encoding: 'utf8' }).trim();
        const wtGitLink = path.join(mainGitDir, 'worktrees', worktreeName);
        if (fs.existsSync(wtGitLink)) {
            fs.rmSync(wtGitLink, { recursive: true, force: true });
        }
        // Remove the .git file in the worktree (it's a link back to the main repo)
        const dotGitFile = path.join(worktreePath, '.git');
        if (fs.existsSync(dotGitFile)) {
            fs.unlinkSync(dotGitFile);
        }
    } catch (e) {
        // If git detach fails, fall back to force remove
        try {
            execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
            return true;
        } catch (e2) {
            return false;
        }
    }

    // Step 2: Move directory to Trash (macOS) or delete (other platforms)
    if (process.platform === 'darwin') {
        try {
            // Use macOS `trash` command via osascript — moves to Finder Trash
            const escapedPath = worktreePath.replace(/'/g, "'\\''");
            execSync(`osascript -e 'tell application "Finder" to delete POSIX file "${escapedPath}"'`, { stdio: 'pipe' });
            return true;
        } catch (e) {
            // Fallback: try the `trash` CLI if installed
            try {
                execSync(`trash "${worktreePath}"`, { stdio: 'pipe' });
                return true;
            } catch (e2) {
                // Last resort: manual delete
                try {
                    fs.rmSync(worktreePath, { recursive: true, force: true });
                    return true;
                } catch (e3) {
                    return false;
                }
            }
        }
    } else {
        try {
            fs.rmSync(worktreePath, { recursive: true, force: true });
            return true;
        } catch (e) {
            return false;
        }
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
    getShellProfile,
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
    proxyDiagnostics,
    loadProxyRegistry,
    saveProxyRegistry,
    loadPortRegistry,
    savePortRegistry,
    registerPort,
    deregisterPort,
    scanPortsFromFilesystem,
    getCaddyRouteId,
    isCaddyAdminAvailable,
    writeCaddyfileBackup,
    addCaddyRoute,
    removeCaddyRoute,
    getCaddyLiveRoutes,
    registryHasRoute,
    reconcileProxyRoutes,
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
    inferDashboardNextActions,
    getRecommendedActions: stateMachine.getRecommendedActions,
    getAvailableActions: stateMachine.getAvailableActions,
    getValidTransitions: stateMachine.getValidTransitions,
    getSessionAction: stateMachine.getSessionAction,
    isActionValid: stateMachine.isActionValid,
    safeTmuxSessionExists,
    collectDashboardStatusData,
    escapeForHtmlScript,
    buildDashboardHtml,
    escapeAppleScriptString,
    captureDashboardScreenshot,
    writeRepoRegistry,
    hashBranchToPort,
    sendMacNotification,
    DASHBOARD_INTERACTIVE_ACTIONS,
    resolveDashboardActionRepoPath,
    parseDashboardActionRequest,
    buildDashboardActionCommandArgs,
    runDashboardInteractiveAction,
    runDashboardServer,
    detectDashboardContext,
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
    tileITerm2Windows,
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
    parseNumericArray,
    stripInlineYamlComment,
    splitInlineYamlArray,
    parseYamlScalar,
    parseFrontMatter,
    serializeYamlScalar,
    escapeRegex,
    extractMarkdownSection,
    getWorktreeStatus,
    safeRemoveWorktree,
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
    isProcessAlive,
    parseLogFrontmatterFull,
    serializeLogFrontmatter,
    updateLogFrontmatterInPlace,
    collectAnalyticsData,
    organizeLogFiles,
    runGit,
    // New git.js functions — re-exported here so createAllCommands scope picks them up
    getCurrentBranch: git.getCurrentBranch,
    getCurrentHead: git.getCurrentHead,
    getDefaultBranch: git.getDefaultBranch,
    branchExists: git.branchExists,
    listBranches: git.listBranches,
    getCommonDir: git.getCommonDir,
    getStatusRaw: git.getStatusRaw,
    ensureCommit: git.ensureCommit,
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
    upsertRootFile,
    readTemplate,
    loadAgentConfig,
    getAvailableAgents,
    buildAgentAliasMap,
    processTemplate,
    readGenericTemplate,
    extractDescription,
    formatCommandOutput,
    getScaffoldContent,
    getProjectInstructions,
    getRootFileContent,
    syncAgentsMdFile,
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
    DASHBOARD_DEFAULT_PORT,
    DASHBOARD_DYNAMIC_PORT_START,
    DASHBOARD_DYNAMIC_PORT_END,
    DASHBOARD_LOG_FILE,
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
