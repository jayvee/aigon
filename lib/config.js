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
    // Skip when not interactive (e.g. piped output in tests or dashboard actions)
    if (!process.stdout.isTTY) return;

    const editor = detectEditor();
    if (!editor) return;

    try {
        spawnSync(editor, [filePath], { stdio: 'ignore' });
    } catch (e) {
        // Silently fail - opening editor is nice-to-have, not critical
    }
}

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
const DASHBOARD_DEFAULT_PORT = 4100;
const DASHBOARD_DYNAMIC_PORT_START = 4101;
const DASHBOARD_DYNAMIC_PORT_END = 4199;
const DASHBOARD_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'dashboard.log');
// Legacy aliases (kept for any remaining references in dev-server / proxy code)

const DEFAULT_SECURITY_CONFIG = {
    enabled: true,
    mode: 'enforce',
    stages: ['pre-commit'],
    scanners: ['env-local-blocker'],
    // Stage-to-scanner mapping for merge-gate scans
    mergeGateStages: {
        featureClose: ['gitleaks', 'semgrep'],
        featureSubmit: ['gitleaks'],
        researchClose: ['gitleaks'],
    },
    // Named scanner definitions (pluggable)
    scannerDefs: {
        gitleaks: {
            command: 'gitleaks detect --no-banner --no-git --source "{{scanPath}}"',
        },
        semgrep: {
            command: 'semgrep scan --config auto --json --severity ERROR --severity WARNING "{{scanPath}}"',
            outputFormat: 'semgrep-json',
            severityThreshold: 'high',
        },
    },
};

function mergeSecurityConfig(base = {}, overrides = {}) {
    const merged = {
        ...DEFAULT_SECURITY_CONFIG,
        ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}),
        ...(overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}),
    };
    // Deep-merge mergeGateStages if both layers provide them
    if (base.mergeGateStages || overrides.mergeGateStages) {
        merged.mergeGateStages = {
            ...DEFAULT_SECURITY_CONFIG.mergeGateStages,
            ...(base.mergeGateStages || {}),
            ...(overrides.mergeGateStages || {}),
        };
    }
    // Deep-merge scannerDefs if both layers provide them
    if (base.scannerDefs || overrides.scannerDefs) {
        merged.scannerDefs = {
            ...DEFAULT_SECURITY_CONFIG.scannerDefs,
            ...(base.scannerDefs || {}),
            ...(overrides.scannerDefs || {}),
        };
        for (const scannerName of Object.keys(merged.scannerDefs)) {
            merged.scannerDefs[scannerName] = {
                ...(DEFAULT_SECURITY_CONFIG.scannerDefs[scannerName] || {}),
                ...((base.scannerDefs || {})[scannerName] || {}),
                ...((overrides.scannerDefs || {})[scannerName] || {}),
            };
        }
    }
    return merged;
}

const DEFAULT_GLOBAL_CONFIG = {
    terminal: 'warp',
    tmuxApp: 'terminal',  // Terminal app for tmux attach: 'terminal' (Terminal.app) or 'iterm2' (iTerm2)
    linuxTerminal: null,  // Linux terminal emulator override: 'kitty', 'gnome-terminal', 'xterm', or null (auto-detect)
    backgroundAgents: false,
    agents: {
        cc: {
            cli: 'claude',
            implementFlag: '--permission-mode acceptEdits',
            models: {
                research: 'opus',
                implement: 'sonnet',
                evaluate: 'opus'
            }
        },
        cu: { cli: 'agent', implementFlag: '--force', models: {} },
        gg: {
            cli: 'gemini',
            implementFlag: '--yolo',
            models: {
                research: 'gemini-2.5-pro',
                implement: 'gemini-2.5-flash',
                evaluate: 'gemini-2.5-pro'
            }
        },
        cx: {
            cli: 'codex',
            implementFlag: '',
            models: {
                research: 'gpt-5.2',
                implement: 'gpt-5.3-codex',
                evaluate: 'gpt-5.4'
            }
        }
    },
    security: { ...DEFAULT_SECURITY_CONFIG },
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
        // Environment variable override for terminal still works.
        // Other built-in defaults are resolved by callers from DEFAULT_GLOBAL_CONFIG.
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
    if (userConfig.security && typeof userConfig.security === 'object' && !Array.isArray(userConfig.security)) {
        merged.security = mergeSecurityConfig({}, userConfig.security);
    }
    // Merge other user config keys (tmuxApp, etc.)
    Object.keys(userConfig).forEach(key => {
        if (key !== 'terminal' && key !== 'agents' && key !== 'security') {
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
            ports: { cc: 3001, gg: 3002, cx: 3003, cu: 3004, mv: 3005 }
        },
        setupEnvLine: '- Set up `.env.local` with agent-specific PORT (worktree modes)'
    },
    api: {
        devServer: {
            enabled: true,
            ports: { cc: 8001, gg: 8002, cx: 8003, cu: 8004, mv: 8005 }
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
    const filePath = PROJECT_CONFIG_PATH;
    const content = JSON.stringify(config, null, 2) + '\n';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

/**
 * Save global Aigon config to ~/.aigon/config.json
 * @param {Object} config - Config object to save
 */
function saveGlobalConfig(config) {
    const filePath = GLOBAL_CONFIG_PATH;
    const content = JSON.stringify(config, null, 2) + '\n';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

/**
 * Resolve config key aliases (new names → legacy internal names)
 * @param {string} keyPath - Config key path (e.g., "fleet.testInstructions")
 * @returns {string} Resolved path (e.g., "arena.testInstructions")
 */
function resolveConfigKeyAlias(keyPath) {
    const aliases = { fleet: 'arena', autonomous: 'ralph' };
    const parts = keyPath.split('.');
    if (aliases[parts[0]]) {
        parts[0] = aliases[parts[0]];
    }
    return parts.join('.');
}

/**
 * Get a nested value from an object using dot-notation path
 * @param {Object} obj - Object to get value from
 * @param {string} keyPath - Dot-notation path (e.g., "fleet.testInstructions")
 * @returns {any} Value at path, or undefined if not found
 */
function getNestedValue(obj, keyPath) {
    keyPath = resolveConfigKeyAlias(keyPath);
    const keys = keyPath.split('.');
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
 * @param {string} keyPath - Dot-notation path (e.g., "fleet.testInstructions")
 * @param {any} value - Value to set
 */
function setNestedValue(obj, keyPath, value) {
    keyPath = resolveConfigKeyAlias(keyPath);
    const keys = keyPath.split('.');
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
    if (globalConfig.security && typeof globalConfig.security === 'object' && !Array.isArray(globalConfig.security)) {
        merged.security = mergeSecurityConfig({}, globalConfig.security);
    }
    // Merge other global config keys (deep copy to avoid reference issues)
    Object.keys(globalConfig).forEach(key => {
        if (key !== 'terminal' && key !== 'agents' && key !== 'security') {
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
        } else if (key === 'security' && projectConfig.security && typeof projectConfig.security === 'object' && !Array.isArray(projectConfig.security)) {
            merged.security = mergeSecurityConfig(merged.security, projectConfig.security);
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
        console.log(`   Using defaults — Fleet: ${portsStr}`);
        console.log(`   💡 Add PORT=<number> to .env to avoid clashes with other projects`);
    }
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

/**
 * Auto-detect project profile from project files
 * @param {string} [repoPath] - Path to the repository root (defaults to process.cwd())
 * @returns {string} Profile name (web, api, ios, android, library, generic)
 */
function detectProjectProfile(repoPath) {
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();

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
 * @param {string} [repoPath] - Path to the repository root (defaults to process.cwd())
 * @returns {Object} Resolved profile with devServer, testInstructions, depCheck, setupEnvLine, and metadata
 */
function getActiveProfile(repoPath) {
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();
    const projectConfigPath = path.join(cwd, '.aigon', 'config.json');
    let projectConfig = {};
    if (fs.existsSync(projectConfigPath)) {
        try {
            projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        } catch (_) { /* ignore */ }
    }

    const profileName = projectConfig.profile || detectProjectProfile(cwd);
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
        setupEnvLine: preset.setupEnvLine,
        worktreeSetup: null
    };

    // worktreeSetup from project config — shell command to run after worktree creation
    if (projectConfig.worktreeSetup) {
        profile.worktreeSetup = projectConfig.worktreeSetup;
    }

    // Apply user overrides from .aigon/config.json (fleet is the new name; arena is legacy alias)
    const fleetConfig = projectConfig.fleet || projectConfig.arena;
    if (fleetConfig) {
        if (fleetConfig.testInstructions) {
            profile.testInstructions = fleetConfig.testInstructions;
        }
    }

    // Derive fleet ports from .env/.env.local PORT (overrides profile defaults)
    if (profile.devServer.enabled) {
        // Look for PORT in .env.local / .env in the repoPath
        let basePort = null;
        const envFiles = ['.env.local', '.env'];
        for (const file of envFiles) {
            const envPath = path.join(cwd, file);
            if (!fs.existsSync(envPath)) continue;
            try {
                const content = fs.readFileSync(envPath, 'utf8');
                const match = content.match(/^PORT=(\d+)/m);
                if (match) {
                    basePort = parseInt(match[1], 10);
                    break;
                }
            } catch (e) { /* ignore read errors */ }
        }

        if (basePort) {
            const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4, mv: 5 };
            for (const [agentId, offset] of Object.entries(agentOffsets)) {
                profile.devServer.ports[agentId] = basePort + offset;
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
 * Priority: project config > global config > built-in defaults
 * @param {string} agentId - Agent ID (cc, cu, gg, cx)
 * @returns {Object} CLI config with command, implementFlag, implementPrompt
 */
function isAgentDisabled(agentId) {
    const globalConfig = loadGlobalConfig();
    const projectConfig = loadProjectConfig();
    return !!(projectConfig.agents?.[agentId]?.disabled || globalConfig.agents?.[agentId]?.disabled);
}

function getAgentCliConfig(agentId) {
    const agentConfig = _loadAgentConfig(agentId);
    const globalConfig = loadGlobalConfig();
    const projectConfig = loadProjectConfig();

    // Start with built-in defaults from central config, then layer agent template prompts/CLI metadata on top.
    const cli = {
        command: agentConfig?.cli?.command || agentId,
        implementFlag: agentConfig?.cli?.implementFlag || '',
        implementPrompt: agentConfig?.cli?.implementPrompt || '',
        evalPrompt: agentConfig?.cli?.evalPrompt || '',
        reviewPrompt: agentConfig?.cli?.reviewPrompt || '',
        models: { ...((DEFAULT_GLOBAL_CONFIG.agents?.[agentId] && DEFAULT_GLOBAL_CONFIG.agents[agentId].models) || {}) }
    };

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
 * Checks in priority order: env var > project config > global config > built-in default.
 * @returns {{ value: string|undefined, source: 'env'|'project'|'global'|'default'|'none' }}
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

    // 4. Built-in default
    const defaultModelValue = DEFAULT_GLOBAL_CONFIG.agents?.[agentId]?.models?.[taskType];
    if (defaultModelValue) {
        return { value: defaultModelValue, source: 'default' };
    }

    return { value: undefined, source: 'none' };
}

// Lazy require to avoid circular dependency issues
function _loadAgentConfig(agentId) {
    return require('./templates').loadAgentConfig(agentId);
}

module.exports = {
    // Editor detection
    detectEditor,
    openInEditor,
    getShellProfile,
    detectActiveAgentSession,
    printAgentContextWarning,
    normalizeMode,
    isSameProviderFamily,
    PROVIDER_FAMILIES,
    // Config constants
    SPECS_ROOT,
    ROOT_DIR,
    CLI_ENTRY_PATH,
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
    DEFAULT_SECURITY_CONFIG,
    mergeSecurityConfig,
    DEFAULT_GLOBAL_CONFIG,
    PROFILE_PRESET_STRING_FILES,
    PROFILE_PRESETS,
    // Config functions
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
    readConductorReposFromGlobalConfig,
    // Profile detection
    detectProjectProfile,
    getActiveProfile,
    getProfilePlaceholders,
    getAgentCliConfig,
    isAgentDisabled,
    getConfigModelValue,
    parseCliFlagTokens,
    getAgentLaunchFlagTokens,
    getModelProvenance,
};
