#!/usr/bin/env node

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
 * This shared helper is used by shell-launch commands (e.g. feature-implement)
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
 * @param {string} commandName  e.g. 'feature-implement'
 * @param {string|undefined} id  The feature/research ID (for the suggested command)
 */
function printAgentContextWarning(commandName, id) {
    const session = detectActiveAgentSession();
    if (session.detected) return;

    const idPart = id ? ` ${id}` : '';
    const hasRalph = commandName === 'feature-implement';

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
const TEMPLATES_ROOT = path.join(__dirname, 'templates');
const CLAUDE_SETTINGS_PATH = path.join(process.cwd(), '.claude', 'settings.json');
const HOOKS_FILE_PATH = path.join(process.cwd(), 'docs', 'aigon-hooks.md');

// --- Project Configuration ---
const PROJECT_CONFIG_PATH = path.join(process.cwd(), '.aigon', 'config.json');

// --- Global User Configuration ---
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.aigon');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');

const DEFAULT_GLOBAL_CONFIG = {
    terminal: 'warp',
    tmuxApp: 'terminal',  // Terminal app for tmux attach: 'terminal' (Terminal.app) or 'iterm2' (iTerm2 with tmux -CC)
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

const PROFILE_PRESETS = {
    web: {
        devServer: {
            enabled: true,
            ports: { cc: 3001, gg: 3002, cx: 3003, cu: 3004 }
        },
        testInstructions: '- **NEVER run `npm run dev` or `next dev` directly** — this bypasses port allocation and will bind to port 3000 (the main app)\n- Run `aigon dev-server start` — allocates your agent\'s unique port, starts the server, registers with the proxy, and waits for healthy\n- Use the URL printed by the command (e.g. `http://cx-121.myapp.test`) — never use `http://localhost:3000`\n- Use `aigon dev-server logs` to check startup output if anything seems wrong\n- Ask the user to verify',
        manualTestingGuidance: '### Before stopping: set up for manual review\n\n1. Start the dev server (if not already running):\n   ```bash\n   aigon dev-server start\n   ```\n2. Open it in the browser:\n   ```bash\n   aigon dev-server open\n   ```\n3. Generate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each one (e.g. "Navigate to /settings → fill in the form → click Save → verify the success message appears"). Present the checklist in your response before stopping.',
        depCheck: '**Worktrees do not share `node_modules/` with the main repo.** Before running or testing, check if dependencies need to be installed:\n\n```bash\n# Check if node_modules exists\ntest -d node_modules && echo "Dependencies installed" || echo "Need to install dependencies"\n```\n\nIf missing, install them using the project\'s package manager:\n```bash\n# Detect and run the appropriate install command\nif [ -f "pnpm-lock.yaml" ]; then pnpm install\nelif [ -f "yarn.lock" ]; then yarn install\nelif [ -f "bun.lockb" ]; then bun install\nelif [ -f "package-lock.json" ]; then npm install\nelif [ -f "package.json" ]; then npm install\nfi\n```',
        setupEnvLine: '- Set up `.env.local` with agent-specific PORT (worktree modes)'
    },
    api: {
        devServer: {
            enabled: true,
            ports: { cc: 8001, gg: 8002, cx: 8003, cu: 8004 }
        },
        testInstructions: '- **NEVER run your dev command directly** — this bypasses port allocation and will cause port conflicts\n- Run `aigon dev-server start` — allocates your agent\'s unique port, starts the server, registers with the proxy, and waits for healthy\n- Use the URL printed by the command — never use `http://localhost:3000` or the default port\n- Use `aigon dev-server logs` to check startup output if anything seems wrong\n- Test endpoints using `curl` or a REST client\n- Ask the user to verify',
        manualTestingGuidance: '### Before stopping: set up for manual review\n\n1. Start the dev server (if not already running):\n   ```bash\n   aigon dev-server start\n   ```\n2. Open it in the browser:\n   ```bash\n   aigon dev-server open\n   ```\n3. Generate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each one, including example `curl` commands or REST client requests where applicable. Present the checklist in your response before stopping.',
        depCheck: '**Worktrees do not share dependencies with the main repo.** Before running or testing, check if dependencies need to be installed:\n\n```bash\n# Detect and install dependencies\nif [ -f "requirements.txt" ]; then pip install -r requirements.txt\nelif [ -f "Pipfile" ]; then pipenv install\nelif [ -f "go.mod" ]; then go mod download\nelif [ -f "package.json" ]; then npm install\nfi\n```',
        setupEnvLine: '- Set up `.env.local` with agent-specific PORT (worktree modes)'
    },
    ios: {
        devServer: { enabled: false, ports: {} },
        testInstructions: '- Build and test in Xcode/Simulator\n- Verify the changes work on the target device/simulator\n- Ask the user to verify',
        manualTestingGuidance: '### Before stopping: prepare a manual testing checklist\n\nGenerate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each criterion on device/simulator. Present the checklist in your response before stopping.',
        depCheck: '',
        setupEnvLine: ''
    },
    android: {
        devServer: { enabled: false, ports: {} },
        testInstructions: '- Build and test on emulator/device\n- Verify the changes work on the target device/emulator\n- Ask the user to verify',
        manualTestingGuidance: '### Before stopping: prepare a manual testing checklist\n\nGenerate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each criterion on emulator/device. Present the checklist in your response before stopping.',
        depCheck: '',
        setupEnvLine: ''
    },
    library: {
        devServer: { enabled: false, ports: {} },
        testInstructions: '- Run the test suite to verify changes\n- Ask the user to verify',
        manualTestingGuidance: '### Before stopping: prepare a manual testing checklist\n\nGenerate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each criterion. Present the checklist in your response before stopping.',
        depCheck: '**Worktrees do not share dependencies with the main repo.** Before running or testing, check if dependencies need to be installed:\n\n```bash\n# Detect and install dependencies\nif [ -f "Cargo.toml" ]; then cargo build\nelif [ -f "go.mod" ]; then go mod download\nelif [ -f "requirements.txt" ]; then pip install -r requirements.txt\nelif [ -f "pyproject.toml" ]; then pip install -e .\nelif [ -f "package.json" ]; then npm install\nfi\n```',
        setupEnvLine: ''
    },
    generic: {
        devServer: { enabled: false, ports: {} },
        testInstructions: '- Test the changes according to the project\'s testing approach\n- Ask the user to verify',
        manualTestingGuidance: '### Before stopping: prepare a manual testing checklist\n\nGenerate a **Manual Testing Checklist**: re-read the spec Acceptance Criteria and write a numbered list of concrete, human-executable steps to verify each criterion. Present the checklist in your response before stopping.',
        depCheck: '',
        setupEnvLine: ''
    }
};

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
 * @returns {string} Command string to run the agent CLI with research-conduct
 */
function buildResearchAgentCommand(agentId, researchId) {
    const cliConfig = getAgentCliConfig(agentId);
    const agentConfig = loadAgentConfig(agentId);

    // Research commands use the agent's CMD_PREFIX placeholder
    // e.g., "/aigon:research-conduct" for Claude/Gemini, "/aigon-research-conduct" for Cursor
    const cmdPrefix = agentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
    const prompt = `${cmdPrefix}research-conduct ${researchId}`;

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

function buildTmuxSessionName(featureId, agentId) {
    return `aigon-f${toUnpaddedId(featureId)}-${agentId || 'solo'}`;
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
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function openTerminalAppWithCommand(cwd, command) {
    const effectiveConfig = getEffectiveConfig();
    const tmuxApp = effectiveConfig.tmuxApp || 'terminal';

    if (tmuxApp === 'iterm2') {
        // iTerm2: use tmux -CC (control mode) for native tab/pane integration
        // Convert "tmux attach -t <session>" to "tmux -CC attach -t <session>"
        // Note: skip cd — the tmux session already has its working directory set
        const iterm2Command = command.replace(/^tmux attach/, 'tmux -CC attach');
        const escapedCommand = iterm2Command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const appleScript = `tell application "iTerm2"\nactivate\ncreate window with default profile command "${escapedCommand}"\nend tell`;
        const result = spawnSync('osascript', ['-e', appleScript], { stdio: 'pipe' });
        if (result.error || result.status !== 0) {
            const errMsg = result.stderr ? result.stderr.toString().trim() : 'unknown error';
            throw new Error(`Failed to open iTerm2: ${errMsg}. Is iTerm2 installed?`);
        }
    } else {
        // Default: Terminal.app
        const fullCommand = `cd ${shellQuote(cwd)} && ${command}`;
        const appleScript = [
            'tell application "Terminal"',
            'activate',
            `do script ${JSON.stringify(fullCommand)}`,
            'end tell'
        ].join('\n');
        const result = spawnSync('osascript', ['-e', appleScript], { stdio: 'ignore' });
        if (result.error || result.status !== 0) {
            throw new Error('Failed to open Terminal.app and run command');
        }
    }
}

function ensureTmuxSessionForWorktree(wt, agentCommand) {
    const sessionName = buildTmuxSessionName(wt.featureId, wt.agent);
    if (tmuxSessionExists(sessionName)) {
        return { sessionName, created: false };
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
            openTerminalAppWithCommand(wt.path, `tmux attach -t ${shellQuote(sessionName)}`);

            const tmuxAppName = (getEffectiveConfig().tmuxApp || 'terminal') === 'iterm2' ? 'iTerm2 (tmux -CC)' : 'Terminal.app';
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
    const pkgPath = path.join(__dirname, 'package.json');
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
    const changelogPath = path.join(__dirname, 'CHANGELOG.md');
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

// Commands that should not be autonomously invoked by the agent
const COMMANDS_DISABLE_MODEL_INVOCATION = new Set([
    'feature-done',
    'feature-cleanup',
    'feature-validate',
    'agent-status',
    'status',
    'conductor',
    'deploy',
]);

// Short aliases for commands (alias → full command name)
// These generate top-level command files so users can type e.g. /afs instead of /aigon:feature-submit
// All aliases start with 'a' (for aigon) to avoid namespace clashes with other tools
const COMMAND_ALIASES = {
    'afc':  'feature-create',
    'afn':  'feature-now',
    'afp':  'feature-prioritise',
    'afse': 'feature-setup',
    'afi':  'feature-implement',
    'afs':  'feature-submit',
    'afe':  'feature-eval',
    'afr':  'feature-review',
    'afd':  'feature-done',
    'ab':   'board',
    'arc':  'research-create',
    'arp':  'research-prioritise',
    'arse': 'research-setup',
    'aro':  'research-open',
    'ard':  'research-conduct',
    'ars':  'research-synthesize',
    'ardn': 'research-done',
    'afbc': 'feedback-create',
    'afbl': 'feedback-list',
    'afbt': 'feedback-triage',
    'ads':  'dev-server',
    'ad':   'deploy',
    'ah':   'help',
    'an':   'next',
};

// Reverse map: full command name → list of aliases
const COMMAND_ALIAS_REVERSE = Object.entries(COMMAND_ALIASES).reduce((acc, [alias, cmd]) => {
    if (!acc[cmd]) acc[cmd] = [];
    acc[cmd].push(alias);
    return acc;
}, {});

// Per-command argument hints for frontmatter
const COMMAND_ARG_HINTS = {
    'feature-create': '<feature-name>',
    'feature-now': '<existing-feature-name> OR <feature-description>',
    'feature-prioritise': '<feature-name or letter>',
    'feature-setup': '<ID> [agents...]',
    'feature-implement': '<ID> [--agent=<cc|gg|cx|cu>] [--autonomous] [--max-iterations=N] [--auto-submit] [--no-auto-submit] [--dry-run]',
    'feature-validate': '<ID> [--dry-run] [--no-update]',
    'feature-eval': '<ID> [--allow-same-model-judge]',
    'feature-review': '<ID>',
    'feature-done': '<ID> [agent] [--adopt <agents...|all>]',
    'feature-cleanup': '<ID> [--push]',
    'board': '[--list] [--features] [--research] [--active] [--all] [--inbox] [--backlog] [--done] [--no-actions]',
    'worktree-open': '[ID] [agent]',
    'sessions-close': '<ID>',
    'research-create': '<topic-name>',
    'research-prioritise': '<topic-name or letter>',
    'research-setup': '<ID> [agents...]',
    'research-conduct': '<ID>',
    'research-synthesize': '<ID>',
    'research-done': '<ID>',
    'feedback-create': '<title>',
    'feedback-list': '[--inbox|--triaged|--actionable|--done|--wont-fix|--duplicate|--all] [--type <type>] [--severity <severity>] [--tag <tag>]',
    'feedback-triage': '<ID> [--type <type>] [--severity <severity|none>] [--tags <csv|none>] [--status <status>] [--duplicate-of <ID|none>] [--action <keep|mark-duplicate|promote-feature|promote-research|wont-fix>] [--apply] [--yes]',
    'conductor': '<start|stop|status|add|remove|list|vscode-install|vscode-uninstall> [path]',
    'agent-status': '<implementing|waiting|submitted>',
    'status': '[ID]',
    'deploy': '[--preview]',
    'help': '',
    'next': '',
};

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
    return `# Project Instructions

<!--
  Add project-specific instructions below. Agents read this file at the
  start of every session. These sections are referenced by Aigon workflow
  commands and will NOT be overwritten by \`aigon update\`.
-->

## Testing
<!-- How to test this project, e.g.:
     - \`npm test\`
     - \`docker compose up -d && npm run test:e2e\`
     - \`xcodebuild test -scheme MyApp\` -->

## Build & Run
<!-- How to build/run this project, e.g.:
     - \`npm run dev\`
     - \`cargo build && cargo run\`
     - Open in Xcode, Cmd+R -->

## Dependencies
<!-- How to install dependencies, e.g.:
     - \`npm ci\`
     - \`pip install -r requirements.txt\`
     - \`pod install\` in ios/ directory -->

`;
}

function getRootFileContent(agentConfig) {
    return `## Aigon

This project uses the Aigon development workflow.

- Shared project instructions: \`AGENTS.md\`
- ${agentConfig.name}-specific notes: \`docs/agents/${agentConfig.agentFile}\`
- Development workflow: \`docs/development_workflow.md\`
`;
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

    return `You are iteration ${iteration} of ${maxIterations} for Feature ${featureNum} (${featureDesc}) in the Autopilot loop.

Goal:
- Implement/fix the feature so all validation checks pass.
${criteriaSection}
Hard requirements:
- Work only in the current repository and branch/worktree.
- Implement the spec faithfully.
- Commit your code changes before you exit this iteration.
- Use a conventional commit message (feat:, fix:, or chore:).
- Exit when done.

Validation checks that will run after you exit (all must pass):
${validationBlock}

Feature spec:
--- SPEC START ---
${specContent}
--- SPEC END ---

Prior Autopilot progress:
--- PROGRESS START ---
${priorProgress || '(no prior progress)'}
--- PROGRESS END ---
`;
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
        console.error(`Usage: aigon feature-implement <feature-id> --autonomous [--max-iterations=N] [--agent=<id>] [--auto-submit] [--no-auto-submit] [--dry-run]`);
        console.error(`\nExamples:`);
        console.error(`  aigon feature-implement 16 --autonomous`);
        console.error(`  aigon feature-implement 16 --autonomous --max-iterations=8 --agent=cx`);
        console.error(`  aigon feature-implement 16 --autonomous --auto-submit   # auto-submit on success`);
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
                console.log(`   Next: run: aigon feature-done ${featureNum}`);
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

// --- Commands ---

const commands = {
    'init': (args) => {
        console.log("ACTION: Initializing Aigon in ./docs/specs ...");
        const createDirs = (root, folders) => {
            folders.forEach(f => {
                const p = path.join(root, f);
                if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                // Add .gitkeep to ensure empty directories are tracked by git
                const gitkeepPath = path.join(p, '.gitkeep');
                if (!fs.existsSync(gitkeepPath)) {
                    fs.writeFileSync(gitkeepPath, '');
                }
            });
        };
        createDirs(PATHS.research.root, PATHS.research.folders);
        createDirs(PATHS.features.root, PATHS.features.folders);
        createDirs(PATHS.feedback.root, PATHS.feedback.folders);
        const featLogs = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
        if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
        if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
        // Add .gitkeep to log and evaluation folders
        [path.join(featLogs, 'selected'), path.join(featLogs, 'alternatives'), path.join(PATHS.features.root, 'evaluations')].forEach(p => {
            const gitkeepPath = path.join(p, '.gitkeep');
            if (!fs.existsSync(gitkeepPath)) fs.writeFileSync(gitkeepPath, '');
        });
        const readmePath = path.join(SPECS_ROOT, 'README.md');
        if (!fs.existsSync(readmePath)) {
            const readmeContent = `# Aigon Specs\n\n**This folder is the Single Source of Truth.**\n\n## Rules\n1. READ ONLY: backlog, inbox, done.\n2. WRITE: Only edit code if feature spec is in features/in-progress.\n`;
            fs.writeFileSync(readmePath, readmeContent);
        }
        
        // Ensure .aigon/.board-map.json is in .gitignore
        ensureBoardMapInGitignore();
        
        console.log("✅ ./docs/specs directory structure created.");
        showPortSummary();

        // Auto-register in global port registry
        const initProfile = getActiveProfile();
        if (initProfile.devServer.enabled) {
            const portResult = readBasePort();
            if (portResult) {
                registerPort(path.basename(process.cwd()), portResult.port, process.cwd());
            }
        }
    },
    'feature-create': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: aigon feature-create <name>\nExample: aigon feature-create dark-mode");

        // Ensure inbox exists
        const inboxDir = path.join(PATHS.features.root, '01-inbox');
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }

        // Create filename: feature-dark-mode.md
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filename = `feature-${slug}.md`;
        const filePath = path.join(inboxDir, filename);

        if (fs.existsSync(filePath)) {
            return console.error(`❌ Feature already exists: ${filename}`);
        }

        // Read template and replace placeholder
        const template = readTemplate('specs/feature-template.md');
        const content = template.replace(/\{\{NAME\}\}/g, name);

        fs.writeFileSync(filePath, content);
        console.log(`✅ Created: ./docs/specs/features/01-inbox/${filename}`);
        openInEditor(filePath);
        console.log(`📝 Edit the spec, then prioritise it using command: feature-prioritise ${slug}`);
    },
    'research-create': (args) => {
        const name = args[0];
        if (!name) return console.error("Usage: aigon research-create <name>\nExample: aigon research-create api-design");

        // Ensure inbox exists
        const inboxDir = path.join(PATHS.research.root, '01-inbox');
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }

        // Create filename: research-api-design.md
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filename = `research-${slug}.md`;
        const filePath = path.join(inboxDir, filename);

        if (fs.existsSync(filePath)) {
            return console.error(`❌ Research topic already exists: ${filename}`);
        }

        // Read template and replace placeholder
        const template = readTemplate('specs/research-template.md');
        const content = template.replace(/\{\{NAME\}\}/g, name);

        fs.writeFileSync(filePath, content);
        console.log(`✅ Created: ./docs/specs/research-topics/01-inbox/${filename}`);
        openInEditor(filePath);
        console.log(`📝 Edit the topic, then prioritise it using command: research-prioritise ${slug}`);
    },
    'feedback-create': (args) => {
        const title = args[0];
        if (!title) return console.error("Usage: aigon feedback-create <title>\nExample: aigon feedback-create \"Login fails on Safari\"");

        const inboxDir = path.join(PATHS.feedback.root, FEEDBACK_STATUS_TO_FOLDER['inbox']);
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }

        const nextId = getNextId(PATHS.feedback);
        const slug = slugify(title);
        const filename = `feedback-${nextId}-${slug}.md`;
        const filePath = path.join(inboxDir, filename);

        if (fs.existsSync(filePath)) {
            return console.error(`❌ Feedback already exists: ${filename}`);
        }

        const projectTemplatePath = path.join(SPECS_ROOT, 'templates', 'feedback-template.md');
        const template = fs.existsSync(projectTemplatePath)
            ? fs.readFileSync(projectTemplatePath, 'utf8')
            : readTemplate('specs/feedback-template.md');
        const parsedTemplate = parseFrontMatter(template);

        const metadata = normalizeFeedbackMetadata(parsedTemplate.data, {
            id: nextId,
            title,
            status: 'inbox',
            type: 'bug',
            reporter: { name: '', identifier: '' },
            source: { channel: '', reference: '' }
        });
        metadata.id = nextId;
        metadata.title = title;
        metadata.status = 'inbox';

        const content = buildFeedbackDocumentContent(metadata, parsedTemplate.body);
        fs.writeFileSync(filePath, content);

        console.log(`✅ Created: ./docs/specs/feedback/01-inbox/${filename}`);
        openInEditor(filePath);
        console.log(`📝 Next: fill in summary/evidence, then triage with: aigon feedback-triage ${nextId}`);
    },
    'feedback-list': (args) => {
        const options = parseCliOptions(args);
        const includeAll = options.all !== undefined;

        const explicitStatusFlags = Object.keys(FEEDBACK_STATUS_FLAG_TO_FOLDER)
            .filter(flag => options[flag] !== undefined);
        const targetFolders = includeAll
            ? PATHS.feedback.folders
            : explicitStatusFlags.length > 0
                ? explicitStatusFlags.map(flag => FEEDBACK_STATUS_FLAG_TO_FOLDER[flag])
                : FEEDBACK_DEFAULT_LIST_FOLDERS;

        const typeFilterRaw = getOptionValue(options, 'type');
        const typeFilter = typeFilterRaw ? String(typeFilterRaw).trim().toLowerCase() : null;
        const severityFilter = normalizeFeedbackSeverity(getOptionValue(options, 'severity'));

        const tagFilters = [...new Set([
            ...normalizeTagList(getOptionValue(options, 'tags')),
            ...normalizeTagList(options.tag !== undefined ? getOptionValues(options, 'tag') : [])
        ])];

        const items = collectFeedbackItems(targetFolders).filter(item => {
            const itemType = String(item.metadata.type || '').toLowerCase();
            const itemSeverity = normalizeFeedbackSeverity(item.metadata.severity);
            const itemTags = normalizeTagList(item.metadata.tags);

            if (typeFilter && itemType !== typeFilter) return false;
            if (severityFilter && itemSeverity !== severityFilter) return false;
            if (tagFilters.length > 0 && !tagFilters.every(tag => itemTags.includes(tag))) return false;
            return true;
        });

        const filterParts = [];
        if (includeAll) {
            filterParts.push('status=all');
        } else if (explicitStatusFlags.length > 0) {
            filterParts.push(`status=${explicitStatusFlags.join(',')}`);
        } else {
            filterParts.push('status=inbox,triaged,actionable');
        }
        if (typeFilter) filterParts.push(`type=${typeFilter}`);
        if (severityFilter) filterParts.push(`severity=${severityFilter}`);
        if (tagFilters.length > 0) filterParts.push(`tag=${tagFilters.join(',')}`);

        if (items.length === 0) {
            console.log('\nNo feedback items matched the current filters.');
            console.log(`   Filters: ${filterParts.join(' | ')}`);
            return;
        }

        console.log(`\n📬 Feedback items (${items.length})`);
        console.log(`   Filters: ${filterParts.join(' | ')}`);

        items.forEach(item => {
            const idLabel = item.metadata.id > 0 ? `#${item.metadata.id}` : '#?';
            const typeLabel = item.metadata.type || 'unknown';
            const severityLabel = item.metadata.severity || '-';
            const tagsLabel = item.metadata.tags && item.metadata.tags.length > 0
                ? item.metadata.tags.join(', ')
                : '-';
            const relPath = `./${path.relative(process.cwd(), item.fullPath)}`;

            console.log(`\n- ${idLabel} [${item.metadata.status}] ${item.metadata.title}`);
            console.log(`  type=${typeLabel}  severity=${severityLabel}  tags=${tagsLabel}`);
            if (item.metadata.duplicate_of) {
                console.log(`  duplicate_of=#${item.metadata.duplicate_of}`);
            }
            console.log(`  path=${relPath}`);
        });
    },
    'feedback-triage': (args) => {
        const id = args[0];
        if (!id) {
            return console.error(
                "Usage: aigon feedback-triage <ID> [--type <type>] [--severity <severity|none>] [--tags <csv|none>] [--tag <tag>] [--status <status>] [--duplicate-of <ID|none>] [--action <keep|mark-duplicate|promote-feature|promote-research|wont-fix>] [--apply] [--yes]"
            );
        }

        const options = parseCliOptions(args.slice(1));
        const found = findFile(PATHS.feedback, id, PATHS.feedback.folders);
        if (!found) return console.error(`❌ Could not find feedback "${id}" in docs/specs/feedback/.`);

        const item = readFeedbackDocument(found);
        const allItems = collectFeedbackItems(PATHS.feedback.folders);
        const duplicateCandidates = findDuplicateFeedbackCandidates(item, allItems, 5);

        const proposed = JSON.parse(JSON.stringify(item.metadata));

        const typeOption = getOptionValue(options, 'type');
        if (typeOption !== undefined) {
            const normalizedType = String(typeOption).trim().toLowerCase();
            if (!normalizedType) {
                return console.error('❌ --type cannot be empty.');
            }
            proposed.type = normalizedType;
        }

        const severityOption = getOptionValue(options, 'severity');
        if (severityOption !== undefined) {
            const normalizedSeverity = normalizeFeedbackSeverity(severityOption);
            if (normalizedSeverity) {
                proposed.severity = normalizedSeverity;
            } else {
                delete proposed.severity;
            }
        }

        let clearTags = false;
        const collectedTags = [];
        if (options.tags !== undefined) {
            const tags = parseTagListValue(getOptionValue(options, 'tags'));
            if (Array.isArray(tags) && tags.length === 0) clearTags = true;
            if (Array.isArray(tags) && tags.length > 0) collectedTags.push(...tags);
        }
        if (options.tag !== undefined) {
            const tags = parseTagListValue(getOptionValues(options, 'tag'));
            if (Array.isArray(tags) && tags.length === 0) clearTags = true;
            if (Array.isArray(tags) && tags.length > 0) collectedTags.push(...tags);
        }
        if (options.tags !== undefined || options.tag !== undefined) {
            if (clearTags) {
                delete proposed.tags;
            } else {
                const uniqueTags = [...new Set(collectedTags)];
                if (uniqueTags.length > 0) {
                    proposed.tags = uniqueTags;
                } else {
                    delete proposed.tags;
                }
            }
        }

        const duplicateOption = getOptionValue(options, 'duplicate-of');
        if (duplicateOption !== undefined) {
            const duplicateText = String(duplicateOption).trim().toLowerCase();
            if (duplicateText === 'none' || duplicateText === 'null') {
                delete proposed.duplicate_of;
            } else {
                const duplicateId = parseInt(duplicateText, 10);
                if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
                    return console.error('❌ --duplicate-of must be a positive numeric ID or "none".');
                }
                if (duplicateId === proposed.id) {
                    return console.error('❌ --duplicate-of cannot reference the same feedback ID.');
                }
                proposed.duplicate_of = duplicateId;
            }
        }

        const statusRaw = getOptionValue(options, 'status');
        const statusOption = statusRaw !== undefined ? normalizeFeedbackStatus(statusRaw) : null;
        if (statusRaw !== undefined && !statusOption) {
            return console.error('❌ Invalid --status. Use: inbox, triaged, actionable, done, wont-fix, duplicate');
        }

        const actionAliases = {
            'keep': 'keep',
            'mark-duplicate': 'mark-duplicate',
            'mark_duplicate': 'mark-duplicate',
            'duplicate': 'duplicate',
            'promote-feature': 'promote-feature',
            'promote_feature': 'promote-feature',
            'promote-research': 'promote-research',
            'promote_research': 'promote-research',
            'wont-fix': 'wont-fix',
            'wontfix': 'wont-fix'
        };
        const actionRaw = getOptionValue(options, 'action');
        const actionOption = actionRaw !== undefined
            ? actionAliases[String(actionRaw).trim().toLowerCase()]
            : null;
        if (actionRaw !== undefined && !actionOption) {
            return console.error('❌ Invalid --action. Use: keep, mark-duplicate, promote-feature, promote-research, wont-fix');
        }

        let nextStatus = statusOption;
        if (!nextStatus && actionOption) {
            nextStatus = FEEDBACK_ACTION_TO_STATUS[actionOption];
        }
        if (!nextStatus) {
            nextStatus = item.metadata.status === 'inbox' ? 'triaged' : (item.metadata.status || 'triaged');
        }
        proposed.status = nextStatus;

        if (proposed.duplicate_of && statusRaw === undefined && actionRaw === undefined) {
            proposed.status = 'duplicate';
        }
        if (proposed.status === 'duplicate' && !proposed.duplicate_of && duplicateCandidates.length > 0) {
            proposed.duplicate_of = duplicateCandidates[0].id;
        }
        if (proposed.status !== 'duplicate') {
            delete proposed.duplicate_of;
        }

        const recommendation = buildFeedbackTriageRecommendation(proposed, duplicateCandidates);
        const targetFolder = getFeedbackFolderFromStatus(proposed.status) || found.folder;

        const changedFields = [];
        const trackedFields = ['type', 'severity', 'status', 'duplicate_of'];
        trackedFields.forEach(field => {
            const currentValue = item.metadata[field];
            const nextValue = proposed[field];
            if (JSON.stringify(currentValue) !== JSON.stringify(nextValue)) {
                changedFields.push(`${field}: ${formatFeedbackFieldValue(currentValue)} -> ${formatFeedbackFieldValue(nextValue)}`);
            }
        });
        const currentTags = normalizeTagList(item.metadata.tags);
        const nextTags = normalizeTagList(proposed.tags);
        if (JSON.stringify(currentTags) !== JSON.stringify(nextTags)) {
            changedFields.push(`tags: ${formatFeedbackFieldValue(currentTags)} -> ${formatFeedbackFieldValue(nextTags)}`);
        }
        if (found.folder !== targetFolder) {
            changedFields.push(`folder: ${found.folder} -> ${targetFolder}`);
        }

        console.log(`\n📋 Feedback #${item.metadata.id}: ${item.metadata.title}`);
        console.log(`   Path: ./${path.relative(process.cwd(), found.fullPath)}`);
        console.log(`   Current: status=${item.metadata.status}, type=${item.metadata.type}, severity=${item.metadata.severity || 'unset'}, tags=${formatFeedbackFieldValue(item.metadata.tags)}`);
        console.log(`   Proposed: status=${proposed.status}, type=${proposed.type}, severity=${proposed.severity || 'unset'}, tags=${formatFeedbackFieldValue(proposed.tags)}`);
        if (proposed.duplicate_of) {
            console.log(`   Proposed duplicate_of: #${proposed.duplicate_of}`);
        }

        if (duplicateCandidates.length > 0) {
            console.log('\n🔎 Duplicate candidates:');
            duplicateCandidates.forEach(candidate => {
                console.log(`   #${candidate.id} (${Math.round(candidate.score * 100)}%) [${candidate.status}] ${candidate.title}`);
            });
        } else {
            console.log('\n🔎 Duplicate candidates: none found');
        }

        console.log(`\n🤖 Suggested next action: ${recommendation.action}`);
        console.log(`   Reason: ${recommendation.reason}`);

        if (changedFields.length === 0) {
            console.log('\nℹ️  No metadata changes are proposed.');
        } else {
            console.log('\n🛠️  Proposed changes:');
            changedFields.forEach(change => console.log(`   - ${change}`));
        }

        const applyRequested = options.apply !== undefined;
        const confirmed = options.yes !== undefined;
        const replayArgs = args
            .slice(1)
            .filter(arg => arg !== '--apply' && arg !== '--yes');

        if (!applyRequested) {
            console.log('\n🔒 Preview only. No changes written.');
            console.log(`   To apply: aigon feedback-triage ${id}${replayArgs.length ? ` ${replayArgs.join(' ')}` : ''} --apply --yes`);
            return;
        }

        if (!confirmed) {
            console.log('\n⚠️  Confirmation required. Re-run with --yes to apply these changes.');
            return;
        }

        if (proposed.status === 'duplicate' && !proposed.duplicate_of) {
            return console.error('❌ Duplicate status requires duplicate_of. Pass --duplicate-of <ID>.');
        }

        if (changedFields.length === 0) {
            console.log('\n✅ Nothing to apply.');
            return;
        }

        const updatedContent = buildFeedbackDocumentContent(proposed, item.body);
        fs.writeFileSync(found.fullPath, updatedContent);

        if (targetFolder !== found.folder) {
            moveFile(found, targetFolder);
        } else {
            console.log(`✅ Updated: ./${path.relative(process.cwd(), found.fullPath)}`);
        }

        console.log(`✅ Applied triage for feedback #${proposed.id}.`);
    },
    'research-prioritise': (args) => {
        let name = args[0];
        if (!name) return console.error("Usage: aigon research-prioritise <name or letter>");

        // Check if argument is a single letter (from board mapping)
        if (name.length === 1 && name >= 'a' && name <= 'z') {
            const mapping = loadBoardMapping();
            if (mapping && mapping.research[name]) {
                const mappedName = mapping.research[name];
                console.log(`📍 Letter '${name}' maps to: ${mappedName}`);
                name = mappedName;
            } else {
                return console.error(`❌ Letter '${name}' not found in board mapping. Run 'aigon board' first.`);
            }
        }

        const found = findUnprioritizedFile(PATHS.research, name);
        if (!found) return console.error(`❌ Could not find unprioritized research "${name}" in inbox.`);
        const nextId = getNextId(PATHS.research);
        const paddedId = String(nextId).padStart(2, '0');
        // Transform: research-topic-name.md -> research-55-topic-name.md
        // Also handles files without the prefix (e.g. topic-name.md -> research-55-topic-name.md)
        const prefix = PATHS.research.prefix;
        const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${prefix}-`), '');
        const newName = `${prefix}-${paddedId}-${baseName}.md`;
        moveFile(found, '02-backlog', newName);
        console.log(`📋 Assigned ID: ${paddedId}`);
    },
    'research-setup': (args) => {
        const id = args[0];
        const agentIds = args.slice(1);
        const mode = agentIds.length > 0 ? 'fleet' : 'drive';

        if (!id) {
            return console.error("Usage: aigon research-setup <ID> [agents...]\n\nExamples:\n  aigon research-setup 05              # Drive mode\n  aigon research-setup 05 cc gg        # Fleet mode");
        }

        // Find in backlog or in-progress (may already be started)
        let found = findFile(PATHS.research, id, ['02-backlog', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${id}" in backlog or in-progress.`);

        // Extract research name from filename
        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        const researchNum = match ? match[1] : id;
        const researchName = match ? match[2] : 'research';

        // Move to in-progress if in backlog
        if (found.folder === '02-backlog') {
            found = moveFile(found, '03-in-progress');
        } else {
            console.log(`ℹ️  Research already in progress: ${found.file}`);
        }

        if (mode === 'fleet') {
            // Fleet mode: Create findings files for each agent
            const logsDir = path.join(PATHS.research.root, 'logs');
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

            const findingsTemplate = readTemplate('specs/research-findings-template.md');
            const createdFiles = [];

            agentIds.forEach(agentId => {
                const agentConfig = loadAgentConfig(agentId);
                const agentName = agentConfig ? agentConfig.name : agentId;

                const findingsFilename = `research-${researchNum}-${agentId}-findings.md`;
                const findingsPath = path.join(logsDir, findingsFilename);

                if (fs.existsSync(findingsPath)) {
                    console.log(`ℹ️  Findings file already exists: ${findingsFilename}`);
                } else {
                    // Process template with placeholders
                    const content = findingsTemplate
                        .replace(/\{\{TOPIC_NAME\}\}/g, researchName.replace(/-/g, ' '))
                        .replace(/\{\{AGENT_NAME\}\}/g, agentName)
                        .replace(/\{\{AGENT_ID\}\}/g, agentId)
                        .replace(/\{\{ID\}\}/g, researchNum)
                        .replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);

                    fs.writeFileSync(findingsPath, content);
                    createdFiles.push(findingsFilename);
                    console.log(`📝 Created: logs/${findingsFilename}`);
                }
            });

            console.log(`\n🚛 Fleet mode started with ${agentIds.length} agents!`);
            console.log(`\n📋 Research topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
            console.log(`\n📂 Agent findings files:`);
            agentIds.forEach(agentId => {
                const agentConfig = loadAgentConfig(agentId);
                const agentName = agentConfig ? agentConfig.name : agentId;
                console.log(`   ${agentId} (${agentName}): logs/research-${researchNum}-${agentId}-findings.md`);
            });
            console.log(`\n💡 Next steps:`);
            console.log(`   Option 1: Open all agents side-by-side:`);
            console.log(`     aigon research-open ${researchNum}`);
            console.log(`\n   Option 2: Run each agent individually:`);
            const firstAgent = agentIds[0];
            const firstAgentConfig = loadAgentConfig(firstAgent);
            const cmdPrefix = firstAgentConfig?.placeholders?.CMD_PREFIX || '/aigon:';
            console.log(`     [Open each agent terminal] ${cmdPrefix}research-conduct ${researchNum}`);
            console.log(`\n   When done: aigon research-done ${researchNum}`);
        } else {
            // Drive mode: Just move to in-progress
            console.log(`\n🚗 Drive mode. Research moved to in-progress.`);
            console.log(`📋 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);
            console.log(`\n💡 Next: Run agent with /aigon-research-conduct ${researchNum}`);
            console.log(`   When done: aigon research-done ${researchNum}`);
        }
    },
    'research-conduct': (args) => {
        const id = args[0];
        printAgentContextWarning('research-conduct', id);
        if (!id) return console.error("Usage: aigon research-conduct <ID>\n\nRun this after 'aigon research-setup <ID>'\n\nExamples:\n  aigon research-conduct 05     # In Drive mode\n  aigon research-conduct 05     # In Fleet mode (writes to your findings file)");

        // Find the research topic
        let found = findFile(PATHS.research, id, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.\n\nRun 'aigon research-setup ${id}' first.`);

        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename.");
        const [_, num, desc] = match;

        // Check for fleet mode by looking for findings files
        const logsDir = path.join(PATHS.research.root, 'logs');
        let findingsFiles = [];
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            findingsFiles = files.filter(f =>
                f.startsWith(`research-${num}-`) && f.endsWith('-findings.md')
            );
        }

        const isFleetMode = findingsFiles.length > 0;

        console.log(`\n📋 Research ${num}: ${desc.replace(/-/g, ' ')}`);
        console.log(`   Mode: ${isFleetMode ? '🚛 Fleet' : '🚗 Drive'}`);
        console.log(`\n📄 Topic: ./docs/specs/research-topics/03-in-progress/${found.file}`);

        if (isFleetMode) {
            console.log(`\n📂 Findings files:`);
            findingsFiles.forEach(file => {
                const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                const agentId = agentMatch ? agentMatch[1] : 'unknown';
                const agentConfig = loadAgentConfig(agentId);
                const agentName = agentConfig ? agentConfig.name : agentId;
                console.log(`   ${agentId} (${agentName}): logs/${file}`);
            });

            console.log(`\n📝 Next Steps:`);
            console.log(`   1. Read the research topic (questions and scope)`);
            console.log(`   2. Write your findings to YOUR findings file only`);
            console.log(`   3. Do NOT modify other agents' files or the main doc`);
            console.log(`\n⚠️  IMPORTANT:`);
            console.log(`   - Do NOT run 'aigon research-done' from an agent session`);
            console.log(`   - The user will run 'aigon research-done ${num}' to synthesize`);
        } else {
            console.log(`\n📝 Next Steps:`);
            console.log(`   1. Read the research topic`);
            console.log(`   2. Conduct research based on questions and scope`);
            console.log(`   3. Write findings to the ## Findings section of the topic file`);
            console.log(`   4. Include sources and recommendation`);
            console.log(`\n   When done: aigon research-done ${num}`);
        }
    },
    'research-synthesize': (args) => {
        const id = args[0];
        printAgentContextWarning('research-synthesize', id);
    },
    'research-done': (args) => {
        const id = args[0];
        const forceComplete = args.includes('--complete');

        if (!id) return console.error("Usage: aigon research-done <ID> [--complete]\n\nOptions:\n  --complete  Move directly to done without showing summary");

        const found = findFile(PATHS.research, id, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find research "${id}" in in-progress.`);

        // Extract research ID from filename
        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        const researchNum = match ? match[1] : id;
        const researchName = match ? match[2] : 'research';

        // Check for fleet mode by looking for findings files
        const logsDir = path.join(PATHS.research.root, 'logs');
        let findingsFiles = [];
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            findingsFiles = files.filter(f =>
                f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
            );
        }

        const isFleetMode = findingsFiles.length > 0;

        if (isFleetMode && !forceComplete) {
            // Fleet mode: Show summary and suggest using research-synthesize
            console.log(`\n📋 Research ${researchNum}: ${researchName.replace(/-/g, ' ')} - Fleet Mode`);
            console.log(`\nFound ${findingsFiles.length} agent findings:\n`);

            findingsFiles.forEach(file => {
                const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
                const agentId = agentMatch ? agentMatch[1] : 'unknown';
                const agentConfig = loadAgentConfig(agentId);
                const agentName = agentConfig ? agentConfig.name : agentId;
                console.log(`   • ${agentName} (${agentId}): logs/${file}`);
            });

            console.log(`\n📋 Main research doc: ./docs/specs/research-topics/03-in-progress/${found.file}`);
            console.log(`\n💡 To synthesize findings with an agent:`);
            console.log(`   /aigon-research-synthesize ${researchNum}`);
            console.log(`\n   Or to complete without synthesis:`);
            console.log(`   aigon research-done ${researchNum} --complete`);
            return;
        }

        // Move to done (both modes, or arena with --complete)
        moveFile(found, '04-done');

        if (isFleetMode) {
            console.log(`\n✅ Research ${researchNum} complete! (Fleet mode)`);
            console.log(`📂 Findings files preserved in: ./docs/specs/research-topics/logs/`);
        } else {
            console.log(`\n✅ Research ${researchNum} complete! (Drive mode)`);
        }
    },
    'research-open': (args) => {
        const id = args[0];
        let terminalOverride = null;

        // Parse terminal override flag
        args.forEach(arg => {
            if (arg.startsWith('--terminal=')) {
                terminalOverride = arg.split('=')[1];
            } else if (arg.startsWith('-t=')) {
                terminalOverride = arg.split('=')[1];
            }
        });

        if (!id) {
            console.error(`❌ Research ID is required.\n`);
            console.error(`Usage:`);
            console.error(`  aigon research-open <ID> [--terminal=<type>]`);
            console.error(`\nExamples:`);
            console.error(`  aigon research-open 05              # Open all Fleet agents side-by-side`);
            console.error(`  aigon research-open 05 --terminal=code # Open in VS Code (manual setup)`);
            return;
        }

        // Find the research topic
        let found = findFile(PATHS.research, id, ['03-in-progress']);
        if (!found) {
            return console.error(`❌ Could not find research "${id}" in progress.\n\nRun 'aigon research-setup ${id} [agents...]' first.`);
        }

        const match = found.file.match(/^research-(\d+)-(.*)\.md$/);
        if (!match) {
            return console.error(`❌ Could not parse research filename: ${found.file}`);
        }
        const [_, researchNum, researchName] = match;
        const paddedId = String(researchNum).padStart(2, '0');

        // Check for fleet mode by looking for findings files
        const logsDir = path.join(PATHS.research.root, 'logs');
        let findingsFiles = [];
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            findingsFiles = files.filter(f =>
                f.startsWith(`research-${researchNum}-`) && f.endsWith('-findings.md')
            );
        }

        if (findingsFiles.length === 0) {
            return console.error(`❌ Research ${paddedId} is not in Fleet mode.\n\nTo start Fleet research:\n  aigon research-setup ${paddedId} cc gg cx\n\nFor Drive research, open a terminal manually and run:\n  /aigon:research-conduct ${paddedId}`);
        }

        // Extract agent IDs from findings filenames
        const agentConfigs = [];
        const errors = [];

        findingsFiles.forEach(file => {
            const agentMatch = file.match(/^research-\d+-(\w+)-findings\.md$/);
            if (!agentMatch) {
                errors.push(`Could not parse agent ID from filename: ${file}`);
                return;
            }

            const agentId = agentMatch[1];
            const agentConfig = loadAgentConfig(agentId);
            
            if (!agentConfig) {
                errors.push(`Agent "${agentId}" is not configured. Install with: aigon install-agent ${agentId}`);
                return;
            }

            agentConfigs.push({
                agent: agentId,
                agentName: agentConfig.name || agentId,
                researchId: paddedId,
                agentCommand: buildResearchAgentCommand(agentId, paddedId)
            });
        });

        if (errors.length > 0) {
            console.error(`❌ Errors detected:\n`);
            errors.forEach(err => console.error(`   ${err}`));
            return;
        }

        if (agentConfigs.length === 0) {
            return console.error(`❌ No valid agents found for research ${paddedId}.`);
        }

        // Sort alphabetically by agent for consistent ordering
        agentConfigs.sort((a, b) => a.agent.localeCompare(b.agent));

        // Determine terminal
        const effectiveConfig = getEffectiveConfig();
        const terminal = terminalOverride || effectiveConfig.terminal;

        if (terminal === 'warp') {
            const configName = `arena-research-${paddedId}`;
            const title = `Arena Research: ${paddedId} - ${researchName.replace(/-/g, ' ')}`;

            // Create config objects for Warp (all use main repo directory)
            const researchConfigs = agentConfigs.map(config => ({
                path: process.cwd(),
                agent: config.agent,
                researchId: config.researchId,
                agentCommand: config.agentCommand
            }));

            try {
                const configFile = openInWarpSplitPanes(researchConfigs, configName, title);

                console.log(`\n🚀 Opening ${agentConfigs.length} agents side-by-side in Warp:`);
                console.log(`   Research: ${paddedId} - ${researchName.replace(/-/g, ' ')}\n`);
                agentConfigs.forEach(config => {
                    console.log(`   ${config.agent.padEnd(8)} → ${process.cwd()}`);
                });
                console.log(`\n   Warp config: ${configFile}`);
            } catch (e) {
                console.error(`❌ Failed to open Warp: ${e.message}`);
            }
        } else {
            // Non-Warp terminals: print manual setup instructions
            console.log(`\n📋 Fleet research ${paddedId} - ${researchName.replace(/-/g, ' ')}:`);
            console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
            agentConfigs.forEach(config => {
                console.log(`   ${config.agent} (${config.agentName}):`);
                console.log(`     cd ${process.cwd()}`);
                console.log(`     ${config.agentCommand}\n`);
            });
        }
    },
    'feature-prioritise': (args) => {
        let name = args[0];
        if (!name) return console.error("Usage: aigon feature-prioritise <name or letter>");

        // Check if argument is a single letter (from board mapping)
        if (name.length === 1 && name >= 'a' && name <= 'z') {
            const mapping = loadBoardMapping();
            if (mapping && mapping.features[name]) {
                const mappedName = mapping.features[name];
                console.log(`📍 Letter '${name}' maps to: ${mappedName}`);
                name = mappedName;
            } else {
                return console.error(`❌ Letter '${name}' not found in board mapping. Run 'aigon board' first.`);
            }
        }

        const found = findUnprioritizedFile(PATHS.features, name);
        if (!found) return console.error(`❌ Could not find unprioritized feature "${name}" in inbox.`);
        const nextId = getNextId(PATHS.features);
        const paddedId = String(nextId).padStart(2, '0');
        // Transform: feature-dark-mode.md -> feature-55-dark-mode.md
        // Also handles files without the prefix (e.g. dark-mode.md -> feature-55-dark-mode.md)
        const prefix = PATHS.features.prefix;
        const baseName = found.file.replace(/\.md$/, '').replace(new RegExp(`^${prefix}-`), '');
        const newName = `${prefix}-${paddedId}-${baseName}.md`;
        moveFile(found, '02-backlog', newName);

        // Commit the prioritisation so it's available in worktrees
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: prioritise feature ${paddedId} - move to backlog"`);
            console.log(`📝 Committed feature prioritisation`);
        } catch (e) {
            console.warn(`⚠️  Could not commit: ${e.message}`);
        }

        console.log(`📋 Assigned ID: ${paddedId}`);
        console.log(`🚀 Next steps:`);
        console.log(`   Drive (branch):   aigon feature-setup ${paddedId}`);
        console.log(`   Drive (worktree): aigon feature-setup ${paddedId} <agent>`);
        console.log(`   Fleet:            aigon feature-setup ${paddedId} <agent1> <agent2> [agent3]`);
    },
    'feature-now': (args) => {
        const name = args.join(' ').trim();
        if (!name) return console.error("Usage: aigon feature-now <name>\nFast-track: create + prioritise + setup in one step (Drive mode)\nExample: aigon feature-now dark-mode");

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Check for existing feature with same slug
        const existing = findFile(PATHS.features, slug);
        if (existing) {
            return console.error(`❌ Feature already exists: ${existing.file} (in ${existing.folder})`);
        }

        // Assign ID
        const nextId = getNextId(PATHS.features);
        const paddedId = String(nextId).padStart(2, '0');
        const filename = `feature-${paddedId}-${slug}.md`;

        // Run pre-hook
        const hookContext = {
            featureId: paddedId,
            featureName: slug,
            mode: 'drive',
            agents: []
        };
        if (!runPreHook('feature-now', hookContext)) {
            return;
        }

        // Ensure in-progress directory exists
        const inProgressDir = path.join(PATHS.features.root, '03-in-progress');
        if (!fs.existsSync(inProgressDir)) {
            fs.mkdirSync(inProgressDir, { recursive: true });
        }

        // Create spec directly in 03-in-progress
        const template = readTemplate('specs/feature-template.md');
        const content = template.replace(/\{\{NAME\}\}/g, name);
        const specPath = path.join(inProgressDir, filename);
        fs.writeFileSync(specPath, content);
        console.log(`✅ Created spec: ./docs/specs/features/03-in-progress/${filename}`);

        // Create branch
        const branchName = `feature-${paddedId}-${slug}`;
        try {
            runGit(`git checkout -b ${branchName}`);
            console.log(`🌿 Created branch: ${branchName}`);
        } catch (e) {
            try {
                runGit(`git checkout ${branchName}`);
                console.log(`🌿 Switched to branch: ${branchName}`);
            } catch (e2) {
                console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                return;
            }
        }

        // Create log file
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        const logName = `feature-${paddedId}-${slug}-log.md`;
        const logPath = path.join(logsDir, logName);
        if (!fs.existsSync(logPath)) {
            const logTemplate = `# Implementation Log: Feature ${paddedId} - ${slug}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
            fs.writeFileSync(logPath, logTemplate);
            console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
        }

        // Single atomic commit
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: create and start feature ${paddedId} - ${slug}"`);
            console.log(`📝 Committed feature creation and setup`);
        } catch (e) {
            console.warn(`⚠️  Could not commit: ${e.message}`);
        }

        // Run post-hook
        runPostHook('feature-now', hookContext);

        console.log(`\n🚗 Feature ${paddedId} ready for implementation!`);
        console.log(`   Spec: ./docs/specs/features/03-in-progress/${filename}`);
        console.log(`   Log:  ./docs/specs/features/logs/${logName}`);
        console.log(`   Branch: ${branchName}`);
        console.log(`\n📝 Next: Write the spec, then implement.`);
        console.log(`   When done: aigon feature-done ${paddedId}`);
    },
    'feature-setup': (args) => {
        const name = args[0];
        const agentIds = args.slice(1);
        const mode = agentIds.length > 0 ? 'fleet' : 'drive';

        if (!name) {
            return console.error("Usage: aigon feature-setup <ID> [agents...]\n\nExamples:\n  aigon feature-setup 55              # Drive mode (branch)\n  aigon feature-setup 55 cc           # Drive mode (worktree, for parallel development)\n  aigon feature-setup 55 cc gg cx cu  # Fleet mode (multiple agents compete)");
        }

        // Find the feature first to get context for hooks
        let found = findFile(PATHS.features, name, ['02-backlog', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`);

        const preMatch = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        const featureId = preMatch ? preMatch[1] : name;
        const featureName = preMatch ? preMatch[2] : '';

        // Run pre-hook (can abort the command)
        const hookContext = {
            featureId,
            featureName,
            mode,
            agents: agentIds
        };
        if (!runPreHook('feature-setup', hookContext)) {
            return;
        }

        // Re-find and move spec to in-progress
        found = findFile(PATHS.features, name, ['02-backlog']);
        let movedFromBacklog = false;
        if (found) {
            moveFile(found, '03-in-progress');
            movedFromBacklog = true;
            found = findFile(PATHS.features, name, ['03-in-progress']);
        } else {
            found = findFile(PATHS.features, name, ['03-in-progress']);
            if (!found) return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`);
        }

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename for branch creation.");
        const [_, num, desc] = match;

        // Commit the spec move first (important for worktrees)
        if (movedFromBacklog) {
            try {
                runGit(`git add docs/specs/features/`);
                runGit(`git commit -m "chore: start feature ${num} - move spec to in-progress"`);
                console.log(`📝 Committed spec move to in-progress`);
            } catch (e) {
                if (mode !== 'drive') {
                    console.error(`❌ Could not commit spec move: ${e.message}`);
                    console.error(`   Worktrees require the spec move to be committed before creation.`);
                    console.error(`   Fix any uncommitted changes and try again.`);
                    return;
                }
                console.warn(`⚠️  Could not commit spec move: ${e.message}`);
            }
        }

        // Create log directory
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

        if (mode === 'drive') {
            // Drive mode: Create branch
            const branchName = `feature-${num}-${desc}`;
            try {
                runGit(`git checkout -b ${branchName}`);
                console.log(`🌿 Created branch: ${branchName}`);
            } catch (e) {
                // Branch may already exist
                try {
                    runGit(`git checkout ${branchName}`);
                    console.log(`🌿 Switched to branch: ${branchName}`);
                } catch (e2) {
                    console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                    return;
                }
            }

            // Create log file
            const logName = `feature-${num}-${desc}-log.md`;
            const logPath = path.join(logsDir, logName);
            if (!fs.existsSync(logPath)) {
                const nowIso = new Date().toISOString();
                const template = `---\nstatus: implementing\nupdated: ${nowIso}\n---\n\n# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                fs.writeFileSync(logPath, template);
                console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
            }

            console.log(`\n🚗 Drive mode. Ready to implement in current directory.`);
            console.log(`   When done: aigon feature-done ${num}`);
        } else {
            // Fleet/worktree mode: Create worktrees
            const wtBase = getWorktreeBase();
            if (!fs.existsSync(wtBase)) {
                fs.mkdirSync(wtBase, { recursive: true });
            }
            const effectiveConfig = getEffectiveConfig();
            const terminalPreference = effectiveConfig.terminal || 'warp';
            const useTmux = terminalPreference === 'tmux';
            if (useTmux) {
                try {
                    assertTmuxAvailable();
                } catch (e) {
                    console.error(`❌ ${e.message}`);
                    console.error(`   Install tmux: brew install tmux`);
                    return;
                }
            }

            const profile = getActiveProfile();
            if (profile.devServer.enabled && !readBasePort()) {
                console.warn(`\n⚠️  No PORT found in .env.local or .env — using default ports`);
                console.warn(`   💡 Add PORT=<number> to .env.local to avoid clashes with other projects`);
            }

            // Auto-register in global port registry
            if (profile.devServer.enabled) {
                const portResult = readBasePort();
                if (portResult) {
                    registerPort(path.basename(process.cwd()), portResult.port, process.cwd());
                }
            }

            const createdWorktrees = [];
            agentIds.forEach(agentId => {
                const branchName = `feature-${num}-${agentId}-${desc}`;
                const worktreePath = `${wtBase}/feature-${num}-${agentId}-${desc}`;

                if (fs.existsSync(worktreePath)) {
                    console.warn(`⚠️  Worktree path ${worktreePath} already exists. Skipping.`);
                    if (useTmux) {
                        try {
                            const wtConfig = {
                                path: worktreePath,
                                featureId: num,
                                agent: agentId
                            };
                            const agentCommand = buildAgentCommand(wtConfig);
                            const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                            console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                        } catch (tmuxErr) {
                            console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                        }
                    }
                } else {
                    try {
                        runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                        console.log(`📂 Worktree: ${worktreePath}`);
                        createdWorktrees.push({ agentId, worktreePath });

                        // Verify spec exists in the worktree
                        const wtSpecDir = path.join(worktreePath, 'docs', 'specs', 'features', '03-in-progress');
                        const specExistsInWt = fs.existsSync(wtSpecDir) &&
                            fs.readdirSync(wtSpecDir).some(f => f.startsWith(`feature-${num}-`) && f.endsWith('.md'));
                        if (!specExistsInWt) {
                            console.warn(`⚠️  Spec not found in worktree 03-in-progress.`);
                            console.warn(`   The spec move may not have been committed. Run from the worktree:`);
                            console.warn(`   git checkout main -- docs/specs/features/03-in-progress/`);
                            console.warn(`   git commit -m "chore: sync spec to worktree branch"`);
                        }

                        // Create .env.local (with PORT and banner env vars)
                        const envLocalPath = path.join(process.cwd(), '.env.local');
                        const agentMeta = AGENT_CONFIGS[agentId] || {};
                        const paddedFeatureId = String(num).padStart(2, '0');
                        if (profile.devServer.enabled) {
                            const port = profile.devServer.ports[agentId] || agentMeta.port || 3000;
                            const appId = getAppId();
                            const serverId = `${agentId}-${num}`;
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
                            // NEXT_PUBLIC_ prefixed vars for browser access (Next.js, Vite, etc.)
                            envContent += `NEXT_PUBLIC_AIGON_AGENT_NAME=${agentMeta.name || agentId}\n`;
                            envContent += `NEXT_PUBLIC_AIGON_BANNER_COLOR=${agentMeta.bannerColor || '#888888'}\n`;
                            envContent += `NEXT_PUBLIC_AIGON_FEATURE_ID=${paddedFeatureId}\n`;
                            envContent += `NEXT_PUBLIC_AIGON_DEV_URL=${devUrl}\n`;
                            fs.writeFileSync(path.join(worktreePath, '.env.local'), envContent);
                            console.log(`   📋 .env.local created with PORT=${port}, banner vars, dev URL`);
                        } else if (fs.existsSync(envLocalPath)) {
                            // Copy base .env.local and append banner vars
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

                        // Install agent commands in worktree (gitignored files don't exist in new worktrees)
                        try {
                            execSync(`aigon install-agent ${agentId}`, { cwd: worktreePath, stdio: 'pipe' });
                            console.log(`   🔧 Installed ${agentId} commands in worktree`);
                        } catch (installErr) {
                            console.warn(`   ⚠️  Failed to install ${agentId} commands in worktree: ${installErr.message}`);
                        }

                        // Add CC notification hooks so the user gets a macOS alert
                        // when the agent needs attention (permission prompt, question, etc.)
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

                        // Create log for this agent in the worktree
                        const worktreeLogsDir = path.join(worktreePath, 'docs/specs/features/logs');
                        if (!fs.existsSync(worktreeLogsDir)) {
                            fs.mkdirSync(worktreeLogsDir, { recursive: true });
                        }
                        const logName = `feature-${num}-${agentId}-${desc}-log.md`;
                        const logPath = path.join(worktreeLogsDir, logName);
                        const nowIso = new Date().toISOString();
                        const template = `---\nstatus: implementing\nupdated: ${nowIso}\n---\n\n# Implementation Log: Feature ${num} - ${desc}\nAgent: ${agentId}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                        fs.writeFileSync(logPath, template);
                        console.log(`   📝 Log: docs/specs/features/logs/${logName}`);

                        if (useTmux) {
                            try {
                                const wtConfig = {
                                    path: worktreePath,
                                    featureId: num,
                                    agent: agentId
                                };
                                const agentCommand = buildAgentCommand(wtConfig);
                                const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                                console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                            } catch (tmuxErr) {
                                console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                            }
                        }
                    } catch (e) {
                        console.error(`❌ Failed to create worktree for ${agentId}: ${e.message}`);
                    }
                }
            });

            // Add read permissions for all worktrees to Claude settings
            const allWorktreePaths = agentIds.map(agentId => `${wtBase}/feature-${num}-${agentId}-${desc}`);
            addWorktreePermissions(allWorktreePaths);
            presetWorktreeTrust(allWorktreePaths);
            if (agentIds.includes('cx')) {
                presetCodexTrust();
            }

            // Create tmux sessions if terminal is configured as tmux
            const fleetEffectiveConfig = getEffectiveConfig();
            const fleetTerminal = fleetEffectiveConfig.terminal;
            if (fleetTerminal === 'tmux' && createdWorktrees.length > 0) {
                console.log(`\n🖥️  Creating tmux sessions...`);
                createdWorktrees.forEach(({ agentId, worktreePath }) => {
                    const wt = { featureId: num, agent: agentId, path: worktreePath, desc };
                    const agentCmd = buildAgentCommand(wt);
                    const sessionName = `aigon-f${parseInt(num, 10)}-${agentId}`;
                    const createResult = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', worktreePath], { stdio: 'pipe' });
                    if (createResult.status !== 0) {
                        const errMsg = createResult.stderr ? createResult.stderr.toString().trim() : 'unknown error';
                        console.warn(`   ⚠️  Could not create tmux session ${sessionName}: ${errMsg}`);
                        return;
                    }
                    spawnSync('tmux', ['send-keys', '-t', sessionName, agentCmd, 'Enter'], { stdio: 'pipe' });
                    console.log(`   ✓ ${sessionName} → started`);
                });
                console.log(`\n   Attach: tmux attach -t aigon-f${parseInt(num, 10)}-<agent>`);
                console.log(`   List:   tmux ls`);
            }

            if (agentIds.length === 1) {
                const portSuffix = profile.devServer.enabled
                    ? ` (PORT=${profile.devServer.ports[agentIds[0]] || AGENT_CONFIGS[agentIds[0]]?.port || 3000})`
                    : '';
                console.log(`\n🚗 Drive worktree created for parallel development!`);
                console.log(`\n📂 Worktree: ${wtBase}/feature-${num}-${agentIds[0]}-${desc}${portSuffix}`);
                console.log(`\n💡 Next: Open the worktree with the agent CLI:`);
                console.log(`   aigon worktree-open ${num}                    # Opens in configured terminal (default: Warp)`);
                console.log(`   aigon worktree-open ${num} --terminal=code    # Opens in VS Code`);
                if (useTmux) {
                    console.log(`   aigon worktree-open ${num} --terminal=tmux    # Attaches to the tmux session`);
                }
                console.log(`\n   Or manually: Open the worktree and run /aigon-feature-implement ${num}`);
                console.log(`   When done: aigon feature-done ${num}`);
            } else {
                console.log(`\n🏁 Fleet started with ${agentIds.length} agents!`);
                console.log(`\n📂 Worktrees created:`);
                agentIds.forEach(agentId => {
                    const portSuffix = profile.devServer.enabled
                        ? ` (PORT=${profile.devServer.ports[agentId] || AGENT_CONFIGS[agentId]?.port || 3000})`
                        : '';
                    console.log(`   ${agentId}: ${wtBase}/feature-${num}-${agentId}-${desc}${portSuffix}`);
                });
                console.log(`\n💡 Next: Open all worktrees side-by-side:`);
                console.log(`   aigon worktree-open ${num} --all`);
                console.log(`\n   Or open individually:`);
                agentIds.forEach(agentId => {
                    console.log(`   aigon worktree-open ${num} ${agentId}`);
                });
                console.log(`\n   Or manually: Open each worktree and run /aigon-feature-implement ${num}`);
                console.log(`   When done: aigon feature-eval ${num}`);
            }
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-setup', hookContext);
    },
    'feature-implement': (args) => {
        const options = parseCliOptions(args);
        const id = options._[0];
        const ralphRequested = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
        if (ralphRequested) {
            return runRalphCommand(args);
        }
        printAgentContextWarning('feature-implement', id);
        if (!id) return console.error(
            "Usage: aigon feature-implement <ID> [--agent=<cc|gg|cx|cu>]\n\n" +
            "Run this after 'aigon feature-setup <ID>'\n\n" +
            "Examples:\n" +
            "  aigon feature-implement 55             # Launch default agent (cc) from shell\n" +
            "  aigon feature-implement 55 --agent=cx  # Launch Codex from shell\n" +
            "  aigon feature-implement 55 --autonomous # Run Autopilot autonomous loop\n" +
            "  /aigon:feature-implement 55            # Inside agent session: show instructions"
        );

        // Find the feature spec
        let found = findFile(PATHS.features, id, ['03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${id}" in in-progress.\n\nRun 'aigon feature-setup ${id}' first.`);

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename.");
        const [_, num, desc] = match;

        // Detect mode based on current location
        const cwd = process.cwd();
        const dirName = path.basename(cwd);
        const worktreeMatch = dirName.match(/^feature-(\d+)-(\w+)-(.+)$/);

        let mode, agentId;
        if (worktreeMatch) {
            agentId = worktreeMatch[2];

            // Verify we're in the right worktree
            const [__, wtNum] = worktreeMatch;
            if (wtNum !== num && wtNum !== String(num).padStart(2, '0')) {
                console.warn(`⚠️  Warning: Directory feature ID (${wtNum}) doesn't match argument (${num})`);
            }

            // Count worktrees for this feature to distinguish drive-wt from fleet
            let featureWorktreeCount = 0;
            try {
                const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
                const paddedNum = String(num).padStart(2, '0');
                const unpaddedNum = String(parseInt(num, 10));
                wtOutput.split('\n').forEach(line => {
                    if (line.match(new RegExp(`feature-(${paddedNum}|${unpaddedNum})-\\w+-`))) {
                        featureWorktreeCount++;
                    }
                });
            } catch (e) {
                // Default to fleet if we can't count
                featureWorktreeCount = 2;
            }

            mode = featureWorktreeCount > 1 ? 'fleet' : 'drive-wt';
        } else {
            mode = 'drive';
        }

        // Resolve the agent to use, taking worktree context into account
        const availableAgents = getAvailableAgents();
        const agentArgRaw = getOptionValue(options, 'agent');
        const agentAliasMap = buildAgentAliasMap();
        let resolvedAgent;

        if (agentId) {
            // Inside a worktree: default to the worktree's own agent
            if (agentArgRaw) {
                const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                if (normalized !== agentId) {
                    console.error(`❌ Agent mismatch: this worktree belongs to agent '${agentId}', but --agent='${normalized}' was requested.`);
                    console.error(`   Remove --agent to use '${agentId}', or open the correct worktree.`);
                    process.exitCode = 1;
                    return;
                }
                resolvedAgent = normalized;
            } else {
                resolvedAgent = agentId;
            }
        } else {
            // Drive branch mode: default to cc
            if (agentArgRaw) {
                const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                if (!availableAgents.includes(normalized)) {
                    console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${availableAgents.join(', ')}`);
                    process.exitCode = 1;
                    return;
                }
                resolvedAgent = normalized;
            } else {
                resolvedAgent = 'cc';
            }
        }

        if (!availableAgents.includes(resolvedAgent)) {
            console.error(`❌ Unknown agent '${resolvedAgent}'. Supported agents: ${availableAgents.join(', ')}`);
            process.exitCode = 1;
            return;
        }

        // Display header (common to both launch mode and instruction mode)
        const paddedNum = String(num).padStart(2, '0');
        if (agentId) {
            const agentConfig = AGENT_CONFIGS[agentId] || {};
            const agentName = agentConfig.name || agentId;
            if (mode === 'fleet') {
                setTerminalTitle(`🚛 Feature #${paddedNum} - ${agentName}`);
                console.log(`\n🚛 Fleet Mode - Agent: ${agentId}`);
            } else {
                setTerminalTitle(`🚗 Feature #${paddedNum} - ${agentName}`);
                console.log(`\n🚗 Drive Mode (worktree) - Agent: ${agentId}`);
            }
            console.log(`   Feature: ${num} - ${desc}`);
            console.log(`   Worktree: ${dirName}`);
        } else {
            setTerminalTitle(`🚗 Feature #${paddedNum}`);
            try {
                const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
                const expectedBranch = `feature-${num}-${desc}`;
                if (currentBranch !== expectedBranch) {
                    console.warn(`⚠️  Warning: Current branch (${currentBranch}) doesn't match expected (${expectedBranch})`);
                    console.warn(`    Run 'aigon feature-setup ${num}' first.`);
                }
                console.log(`\n🚗 Drive Mode`);
                console.log(`   Feature: ${num} - ${desc}`);
                console.log(`   Branch: ${currentBranch}`);
            } catch (e) {
                console.error(`❌ Could not determine git branch: ${e.message}`);
                return;
            }
        }

        // Detect whether we're already inside an active agent session
        const sessionInfo = detectActiveAgentSession();

        if (!sessionInfo.detected) {
            // --- LAUNCH MODE: spawn the selected agent in this context ---
            const cliConfig = getAgentCliConfig(resolvedAgent);
            const featureId = paddedNum;
            const prompt = cliConfig.implementPrompt.replace('{featureId}', featureId);
            const model = cliConfig.models?.['implement'];

            if (resolvedAgent === 'cu' && model) {
                console.warn(`⚠️  Model config ignored for Cursor — model selection is UI-only (no --model flag)`);
            }
            const modelTokens = (model && resolvedAgent !== 'cu') ? ['--model', model] : [];
            const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
            const spawnArgs = [...flagTokens, ...modelTokens, prompt];

            const agentDisplayName = AGENT_CONFIGS[resolvedAgent]?.name || resolvedAgent;
            console.log(`\n🚀 Launching ${agentDisplayName}...`);
            console.log(`   Agent:   ${resolvedAgent}`);
            console.log(`   Command: ${cliConfig.command} ${spawnArgs.join(' ')}`);
            console.log(`   Dir:     ${cwd}\n`);

            const env = { ...process.env };
            if (cliConfig.command === 'claude') {
                // Unset CLAUDECODE to prevent "nested session" error
                delete env.CLAUDECODE;
            }

            const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env, cwd });
            if (result.error) {
                console.error(`❌ Failed to launch agent: ${result.error.message}`);
                process.exitCode = 1;
            } else if (result.status !== 0) {
                process.exitCode = result.status || 1;
            }
            return;
        }

        // --- INSTRUCTION MODE: already inside an agent session, show next steps ---
        console.log(`\nℹ️  Running inside ${sessionInfo.agentName} session — showing instructions (nested launch prevented).`);

        // Check if spec exists
        const specPath = path.join(cwd, 'docs', 'specs', 'features', '03-in-progress');
        if (fs.existsSync(specPath)) {
            const specFiles = fs.readdirSync(specPath).filter(f => f.startsWith(`feature-${num}-`) && f.endsWith('.md'));
            if (specFiles.length > 0) {
                console.log(`\n📋 Spec: ./docs/specs/features/03-in-progress/${specFiles[0]}`);
            }
        }

        // Show log file location
        const logDir = './docs/specs/features/logs/';
        const logPattern = (mode === 'fleet' || mode === 'drive-wt') ? `feature-${num}-${agentId}-*-log.md` : `feature-${num}-*-log.md`;
        console.log(`📝 Log: ${logDir}${logPattern}`);

        console.log(`\n📝 Next Steps:`);
        console.log(`   1. Read the spec in ./docs/specs/features/03-in-progress/`);
        console.log(`   2. Implement the feature according to the spec`);
        console.log(`   3. Test your changes`);
        console.log(`   4. Commit your code with conventional commits (feat:, fix:, chore:)`);
        console.log(`   5. Update the implementation log`);
        console.log(`   6. Commit the log file`);

        if (mode === 'fleet') {
            console.log(`\n⚠️  IMPORTANT:`);
            console.log(`   - Do NOT run 'aigon feature-done' from a worktree`);
            console.log(`   - Return to main repo when done`);
            console.log(`   - Run 'aigon feature-eval ${num}' to compare implementations`);
        } else if (mode === 'drive-wt') {
            console.log(`\n⚠️  IMPORTANT:`);
            console.log(`   - Do NOT run 'aigon feature-done' from a worktree`);
            console.log(`   - Return to main repo when done`);
            console.log(`   - Run 'aigon feature-done ${num}' from the main repo`);
        } else {
            console.log(`\n   When done: aigon feature-done ${num}`);
        }
    },
    'feature-validate': (args) => {
        return runFeatureValidateCommand(args);
    },
    'feature-eval': (args) => {
        const allowSameModel = args.includes('--allow-same-model-judge');
        const forceEval = args.includes('--force');
        // Strip flags so positional arg parsing is unaffected
        const positionalArgs = args.filter(a => a !== '--allow-same-model-judge' && a !== '--force');
        const name = positionalArgs[0];
        printAgentContextWarning('feature-eval', name);
        if (!name) return console.error("Usage: aigon feature-eval <ID> [--allow-same-model-judge] [--force]\n\nExamples:\n  aigon feature-eval 55     # Drive mode: code review\n  aigon feature-eval 55     # Fleet mode: compare implementations\n  aigon feature-eval 55 --allow-same-model-judge  # Skip bias warning\n  aigon feature-eval 55 --force                    # Skip agent completion check");

        // Find the feature (may already be in evaluation)
        let found = findFile(PATHS.features, name, ['03-in-progress']);
        if (found) {
            moveFile(found, '04-in-evaluation');
            found = findFile(PATHS.features, name, ['04-in-evaluation']);
        } else {
            found = findFile(PATHS.features, name, ['04-in-evaluation']);
            if (!found) return console.error(`❌ Could not find feature "${name}" in in-progress or in-evaluation.`);
            console.log(`ℹ️  Feature already in evaluation: ${found.file}`);
        }

        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Could not parse filename.");
        const [_, num, desc] = match;

        // Detect mode: Find all worktrees for this feature
        let worktrees = [];
        try {
            const stdout = execSync('git worktree list', { encoding: 'utf8' });
            const lines = stdout.split('\n');
            lines.forEach(line => {
                const wtMatch = line.match(/^([^\s]+)\s+/);
                if (!wtMatch) return;
                const wtPath = wtMatch[1];
                // Match worktrees for this feature by path pattern
                const featureMatch = wtPath.match(new RegExp(`feature-${num}-(\\w+)-`));
                if (featureMatch) {
                    const agentId = featureMatch[1];
                    // Look up agent name from config
                    const agentConfig = loadAgentConfig(agentId);
                    const agentName = agentConfig ? agentConfig.name : agentId;
                    worktrees.push({ path: wtPath, agent: agentId, name: agentName });
                }
            });
        } catch (e) {
            console.warn("⚠️  Could not list worktrees");
        }

        const mode = worktrees.length > 1 ? 'fleet' : 'drive';

        // --- Agent completion check ---
        if (worktrees.length > 0 && !forceEval) {
            const incompleteAgents = [];
            worktrees.forEach(w => {
                // Log files live in the worktree: docs/specs/features/logs/feature-{num}-{agent}-{desc}-log.md
                const worktreeLogsDir = path.join(w.path, 'docs/specs/features/logs');
                if (!fs.existsSync(worktreeLogsDir)) return;
                try {
                    const logFiles = fs.readdirSync(worktreeLogsDir)
                        .filter(f => f.startsWith(`feature-${num}-${w.agent}-`) && f.endsWith('-log.md'));
                    if (logFiles.length === 0) return;
                    const logContent = fs.readFileSync(path.join(worktreeLogsDir, logFiles[0]), 'utf8');
                    const frontMatter = logContent.match(/^---\n([\s\S]*?)\n---\n/);
                    if (!frontMatter) return;
                    const statusMatch = frontMatter[1].match(/status:\s*(\S+)/);
                    const status = statusMatch ? statusMatch[1] : null;
                    if (status && status !== 'submitted') {
                        incompleteAgents.push({ agent: w.agent, name: w.name, status });
                    }
                } catch (e) { /* skip on read error */ }
            });

            if (incompleteAgents.length > 0) {
                console.log('');
                console.log(`⚠️  ${incompleteAgents.length} agent(s) not yet submitted:`);
                incompleteAgents.forEach(a => {
                    console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                    console.log(`     → aigon worktree-open ${num} ${a.agent}`);
                });
                console.log('');
                console.log(`   To proceed anyway: aigon feature-eval ${num} --force`);
                console.log('');
                return;
            }
        }

        // --- Cross-provider bias detection ---
        const evalSession = detectActiveAgentSession();
        const evalAgent = evalSession.detected ? evalSession.agentId : null;
        const evalCliConfig = evalAgent ? getAgentCliConfig(evalAgent) : null;
        const evalModel = evalCliConfig?.models?.['evaluate'] || null;

        if (!allowSameModel && evalAgent) {
            if (mode === 'fleet') {
                // Fleet: warn if evaluator matches ANY implementer's family
                const sameFamily = worktrees.filter(w => isSameProviderFamily(evalAgent, w.agent));
                if (sameFamily.length > 0) {
                    const evalFamily = PROVIDER_FAMILIES[evalAgent] || evalAgent;
                    const implAgents = sameFamily.map(w => w.agent).join(', ');
                    const altAgents = Object.keys(PROVIDER_FAMILIES)
                        .filter(a => !isSameProviderFamily(evalAgent, a) && PROVIDER_FAMILIES[a] !== 'varies')
                        .slice(0, 2);
                    console.log('');
                    console.log('⚠️  Self-evaluation bias warning:');
                    console.log(`   Evaluator:    ${evalAgent} (${evalFamily})`);
                    console.log(`   Implementer(s) same family: ${implAgents}`);
                    console.log('');
                    console.log('   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).');
                    if (altAgents.length > 0) {
                        const alt = altAgents[0];
                        console.log(`   Consider:  aigon feature-eval ${num} --agent=${alt}`);
                    }
                    console.log(`   Or suppress: aigon feature-eval ${num} --allow-same-model-judge`);
                    console.log('');
                }
            } else {
                // Solo: detect implementer from worktree or branch
                let implAgent = null;
                if (worktrees.length === 1) {
                    implAgent = worktrees[0].agent;
                } else {
                    // Try to infer from branch name
                    try {
                        const branch = execSync('git branch --show-current', { stdio: 'pipe', encoding: 'utf8' }).trim();
                        const branchMatch = branch.match(/^feature-\d+-([a-z]{2})-/);
                        if (branchMatch) implAgent = branchMatch[1];
                    } catch (_) { /* ignore */ }
                }

                if (implAgent && isSameProviderFamily(evalAgent, implAgent)) {
                    const evalFamily = PROVIDER_FAMILIES[evalAgent] || evalAgent;
                    const altAgents = Object.keys(PROVIDER_FAMILIES)
                        .filter(a => !isSameProviderFamily(evalAgent, a) && PROVIDER_FAMILIES[a] !== 'varies')
                        .slice(0, 2);
                    console.log('');
                    console.log('⚠️  Self-evaluation bias warning:');
                    console.log(`   Implementer: ${implAgent} (${PROVIDER_FAMILIES[implAgent] || implAgent})`);
                    console.log(`   Evaluator:   ${evalAgent} (${evalFamily})`);
                    console.log('');
                    console.log('   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).');
                    if (altAgents.length > 0) {
                        const alt = altAgents[0];
                        console.log(`   Consider:  aigon feature-eval ${num} --agent=${alt}`);
                    }
                    console.log(`   Or suppress: aigon feature-eval ${num} --allow-same-model-judge`);
                    console.log('');
                }
            }
        }

        // Create evaluation template
        const evalsDir = path.join(PATHS.features.root, 'evaluations');
        if (!fs.existsSync(evalsDir)) fs.mkdirSync(evalsDir, { recursive: true });

        const evalFile = path.join(evalsDir, `feature-${num}-eval.md`);
        if (!fs.existsSync(evalFile)) {
            let evalTemplate;

            if (mode === 'fleet') {
                // Fleet mode: comparison template
                const agentList = worktrees.map(w => `- [ ] **${w.agent}** (${w.name}): \`${w.path}\``).join('\n');

                evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementations to Compare

${agentList}

## Evaluation Criteria

| Criteria | ${worktrees.map(w => w.agent).join(' | ')} |
|----------|${worktrees.map(() => '---').join('|')}|
| Code Quality | ${worktrees.map(() => '').join(' | ')} |
| Spec Compliance | ${worktrees.map(() => '').join(' | ')} |
| Performance | ${worktrees.map(() => '').join(' | ')} |
| Maintainability | ${worktrees.map(() => '').join(' | ')} |

## Summary

### Strengths & Weaknesses

${worktrees.map(w => `#### ${w.agent} (${w.name})
- Strengths:
- Weaknesses:
`).join('\n')}

## Recommendation

**Winner:** (to be determined after review)

**Rationale:**

`;
            } else {
                // Drive mode: code review template
                // Determine branch name: if there's a drive worktree, use its branch name
                const soloBranch = worktrees.length === 1
                    ? `feature-${num}-${worktrees[0].agent}-${desc}`
                    : `feature-${num}-${desc}`;
                evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Drive (Code review)

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementation
Branch: \`${soloBranch}\`

## Code Review Checklist

### Spec Compliance
- [ ] All requirements from spec are met
- [ ] Feature works as described
- [ ] Edge cases are handled

### Code Quality
- [ ] Follows project coding standards
- [ ] Code is readable and maintainable
- [ ] Proper error handling
- [ ] No obvious bugs or issues

### Testing
- [ ] Feature has been tested manually
- [ ] Tests pass (if applicable)
- [ ] Edge cases are tested

### Documentation
- [ ] Code is adequately commented where needed
- [ ] README updated (if needed)
- [ ] Breaking changes documented (if any)

### Security
- [ ] No obvious security vulnerabilities
- [ ] Input validation where needed
- [ ] No hardcoded secrets or credentials

## Review Notes

### Strengths


### Areas for Improvement


## Decision

- [ ] **Approved** - Ready to merge
- [ ] **Needs Changes** - Issues must be addressed before merging

**Rationale:**

`;
            }

            fs.writeFileSync(evalFile, evalTemplate);
            console.log(`📝 Created: ./docs/specs/features/evaluations/feature-${num}-eval.md`);
        } else {
            console.log(`ℹ️  Evaluation file already exists: feature-${num}-eval.md`);
        }

        // Commit the changes
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: move feature ${num} to evaluation"`);
            console.log(`📝 Committed evaluation setup`);
        } catch (e) {
            // May fail if no changes, that's ok
        }

        console.log(`\n📋 Feature ${num} ready for evaluation`);
        console.log(`   Mode: ${mode === 'fleet' ? '🚛 Fleet (comparison)' : '🚗 Drive (code review)'}`);
        if (evalAgent) {
            const modelDisplay = evalModel ? evalModel : '(default)';
            console.log(`   Evaluator: ${evalAgent} (${PROVIDER_FAMILIES[evalAgent] || 'unknown'}) — model: ${modelDisplay}`);
        }

        if (mode === 'fleet') {
            console.log(`\n📂 Worktrees to compare:`);
            worktrees.forEach(w => console.log(`   ${w.agent}: ${w.path}`));
            console.log(`\n🔍 Review each implementation, then pick a winner.`);
            console.log(`\n⚠️  TO MERGE THE WINNER INTO MAIN, run:`);
            worktrees.forEach(w => {
                console.log(`   aigon feature-done ${num} ${w.agent}    # merge ${w.name}'s implementation`);
            });
        } else {
            console.log(`\n🔍 Review the implementation and complete the evaluation checklist.`);
            console.log(`\n⚠️  TO MERGE INTO MAIN, run:`);
            console.log(`   aigon feature-done ${num}`);
        }
    },
    'feature-review': (args) => {
        const id = args[0];
        printAgentContextWarning('feature-review', id);
    },
    'feature-done': (args) => {
        const keepBranch = args.includes('--keep-branch');

        // Parse --adopt flag and its trailing values (e.g. --adopt cc cu, --adopt all)
        let adoptAgents = [];
        const adoptIdx = args.indexOf('--adopt');
        if (adoptIdx !== -1) {
            for (let i = adoptIdx + 1; i < args.length; i++) {
                if (args[i].startsWith('--')) break;
                adoptAgents.push(args[i].toLowerCase());
            }
            if (adoptAgents.length === 0) {
                return console.error("Usage: --adopt requires at least one agent code or 'all'\n  Example: aigon feature-done 12 cx --adopt cc cu");
            }
        }

        // Positional args: everything before any flags
        const positionalArgs = [];
        for (const a of args) {
            if (a.startsWith('--')) break;
            positionalArgs.push(a);
        }
        const name = positionalArgs[0];
        const agentId = positionalArgs[1]; // Optional - if provided, multi-agent mode
        if (!name) return console.error("Usage: aigon feature-done <ID> [agent] [--adopt <agents...|all>] [--keep-branch]\n  Without agent: Drive mode (merges feature-ID-desc)\n  With agent: Fleet mode (merges feature-ID-agent-desc, cleans up worktree)\n  --adopt: print diffs from losing agents for selective adoption (Fleet only)\n  --keep-branch: Don't delete the local branch after merge");

        // Validate --adopt is only used in arena (multi-agent) mode
        if (adoptAgents.length > 0 && !agentId) {
            return console.error("❌ --adopt is only available in Fleet (multi-agent) mode.\n   Usage: aigon feature-done <ID> <winning-agent> --adopt <agents...|all>");
        }

        const found = findFile(PATHS.features, name, ['04-in-evaluation', '03-in-progress']);
        if (!found) return console.error(`❌ Could not find feature "${name}" in in-evaluation or in-progress.`);
        const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
        if (!match) return console.warn("⚠️  Bad filename. Cannot parse ID.");
        const [_, num, desc] = match;

        // Build hook context
        const hookContext = {
            featureId: num,
            featureName: desc,
            agent: agentId || '',
            adoptAgents: adoptAgents
        };

        // Run pre-hook (can abort the command)
        if (!runPreHook('feature-done', hookContext)) {
            return;
        }

        let branchName, worktreePath, mode;

        if (agentId) {
            // Multi-agent mode: feature-55-cc-dark-mode
            branchName = `feature-${num}-${agentId}-${desc}`;
            worktreePath = `${getWorktreeBase()}/feature-${num}-${agentId}-${desc}`;
            mode = 'multi-agent';
        } else {
            // Drive mode: feature-55-dark-mode
            branchName = `feature-${num}-${desc}`;
            worktreePath = null;
            mode = 'drive';
        }

        // Check if branch exists before attempting merge
        try {
            execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            if (agentId) {
                // Explicit agent specified but branch not found
                const altBranch = `feature-${num}-${desc}`;
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Did you mean: aigon feature-done ${num}?`);
                console.error(`   Looking for: ${altBranch}`);
                return;
            }

            // Drive branch not found — check for Drive worktree (auto-detect)
            let featureWorktrees = [];
            try {
                const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
                const paddedNum = String(num).padStart(2, '0');
                const unpaddedNum = String(parseInt(num, 10));
                wtOutput.split('\n').forEach(line => {
                    const wtMatch = line.match(/^([^\s]+)\s+/);
                    if (!wtMatch) return;
                    const wtPath = wtMatch[1];
                    const featureMatch = wtPath.match(new RegExp(`feature-(${paddedNum}|${unpaddedNum})-(\\w+)-`));
                    if (featureMatch) {
                        featureWorktrees.push({ path: wtPath, agent: featureMatch[2] });
                    }
                });
            } catch (wtErr) {
                // Ignore worktree listing errors
            }

            if (featureWorktrees.length === 1) {
                // Auto-detect: single worktree = Drive worktree mode
                const detectedAgent = featureWorktrees[0].agent;
                branchName = `feature-${num}-${detectedAgent}-${desc}`;
                worktreePath = featureWorktrees[0].path;
                mode = 'multi-agent';
                console.log(`🔍 Auto-detected Drive worktree (agent: ${detectedAgent})`);

                // Verify this branch exists
                try {
                    execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
                } catch (e2) {
                    console.error(`❌ Branch not found: ${branchName}`);
                    return;
                }
            } else if (featureWorktrees.length > 1) {
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Multiple worktrees found for feature ${num}. Specify the agent:`);
                featureWorktrees.forEach(wt => {
                    console.error(`   aigon feature-done ${num} ${wt.agent}`);
                });
                return;
            } else {
                console.error(`❌ Branch not found: ${branchName}`);
                console.error(`   Run 'aigon feature-setup ${num}' first.`);
                return;
            }
        }

        // Push branch to origin before merging (to save work remotely)
        try {
            runGit(`git push -u origin ${branchName}`);
            console.log(`📤 Pushed branch to origin: ${branchName}`);
        } catch (e) {
            // Push failed - warn but continue (remote might not exist or branch already pushed)
            console.warn(`⚠️  Could not push to origin (continuing anyway): ${e.message || 'push failed'}`);
        }

        // Detect default branch (main or master)
        let defaultBranch;
        try {
            // Try to get the default branch from remote
            defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main', { encoding: 'utf8' }).trim().replace('refs/remotes/origin/', '').replace('refs/heads/', '');
        } catch (e) {
            defaultBranch = 'main';
        }
        // Fallback: check if main exists, otherwise use master
        try {
            execSync(`git rev-parse --verify ${defaultBranch}`, { encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            defaultBranch = 'master';
        }

        // Switch to default branch before merging
        try {
            runGit(`git checkout ${defaultBranch}`);
            console.log(`🌿 Switched to ${defaultBranch}`);
        } catch (e) {
            console.error(`❌ Failed to switch to ${defaultBranch}. Are you in the main repository?`);
            return;
        }

        // Merge the branch FIRST (before moving files, so merge doesn't reintroduce them)
        const mergeMsg = agentId
            ? `Merge feature ${num} from agent ${agentId}`
            : `Merge feature ${num}`;
        try {
            runGit(`git merge --no-ff ${branchName} -m "${mergeMsg}"`);
            console.log(`✅ Merged branch: ${branchName}`);
        } catch (e) {
            console.error(`❌ Merge failed. You may need to resolve conflicts manually.`);
            return;
        }

        // Move spec to done (after merge so it doesn't get reintroduced)
        // Re-find the file since merge may have changed things
        const postMergeFound = findFile(PATHS.features, name, ['04-in-evaluation', '03-in-progress']);
        if (postMergeFound) {
            moveFile(postMergeFound, '05-done');
            console.log(`📋 Moved spec to done`);
        }

        // Organize log files (for both modes)
        organizeLogFiles(num, agentId);

        // Commit the moved spec and log files
        try {
            runGit(`git add docs/specs/features/`);
            runGit(`git commit -m "chore: complete feature ${num} - move spec and logs"`);
            console.log(`📝 Committed spec and log file moves`);
        } catch (e) {
            // May fail if no changes to commit, that's ok
        }

        // Clean up worktree if it exists (multi-agent mode or drive-wt)
        let worktreeRemoved = false;
        if (worktreePath && fs.existsSync(worktreePath)) {
            try {
                execSync(`git worktree remove "${worktreePath}" --force`);
                console.log(`🧹 Removed worktree: ${worktreePath}`);
                worktreeRemoved = true;
            } catch (e) {
                console.warn(`⚠️  Could not automatically remove worktree: ${worktreePath}`);
            }
        }

        // Delete the merged branch locally (skip if --keep-branch or worktree removal already handled it)
        if (keepBranch) {
            console.log(`📌 Keeping branch: ${branchName} (--keep-branch)`);
        } else if (worktreeRemoved) {
            // Worktree removal may have already deleted the branch; clean up if it still exists
            try {
                execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
                runGit(`git branch -d ${branchName}`);
                console.log(`🗑️  Deleted branch: ${branchName}`);
            } catch (e) {
                // Branch already gone from worktree removal — expected
            }
        } else {
            try {
                runGit(`git branch -d ${branchName}`);
                console.log(`🗑️  Deleted branch: ${branchName}`);
            } catch (e) {
                // Branch deletion is optional, don't fail if it doesn't work
            }
        }

        // In multi-agent mode, handle losing branches and adoption
        if (agentId) {
            // Find all other branches for this feature, extracting agent ID from each
            const losingBranches = []; // { branch, agent }
            try {
                const branchOutput = execSync('git branch --list', { encoding: 'utf8' });
                const branches = branchOutput.split('\n').map(b => b.trim().replace(/^[*+]\s+/, ''));
                const featurePattern = new RegExp(`^feature-${num}-(\\w+)-`);
                branches.forEach(branch => {
                    const m = branch.match(featurePattern);
                    if (m && branch !== branchName) {
                        losingBranches.push({ branch, agent: m[1] });
                    }
                });
            } catch (e) {
                // Ignore errors listing branches
            }

            // Resolve --adopt all to all losing agent IDs
            if (adoptAgents.includes('all')) {
                if (losingBranches.length === 0) {
                    console.warn(`\n⚠️  --adopt all: no losing branches found. Continuing normally.`);
                    adoptAgents = [];
                } else {
                    adoptAgents = losingBranches.map(lb => lb.agent);
                }
            }

            // Validate requested adopt agents exist in losing branches
            if (adoptAgents.length > 0) {
                const losingAgentIds = losingBranches.map(lb => lb.agent);
                const invalidAgents = adoptAgents.filter(a => !losingAgentIds.includes(a));
                if (invalidAgents.length > 0) {
                    console.error(`❌ No losing branch found for agent(s): ${invalidAgents.join(', ')}`);
                    if (losingAgentIds.length > 0) {
                        console.error(`   Available losing agents: ${losingAgentIds.join(', ')}`);
                    }
                    return;
                }
            }

            // Print adoption diffs
            if (adoptAgents.length > 0) {
                console.log(`\n🔍 Adoption diffs from ${adoptAgents.length} agent(s):`);
                for (const adoptAgent of adoptAgents) {
                    const lb = losingBranches.find(l => l.agent === adoptAgent);
                    if (!lb) continue;
                    console.log(`\n${'='.repeat(72)}`);
                    console.log(`📋 DIFF FROM AGENT: ${adoptAgent} (${lb.branch})`);
                    console.log(`${'='.repeat(72)}`);
                    try {
                        const diff = execSync(`git diff HEAD ${lb.branch}`, {
                            encoding: 'utf8',
                            maxBuffer: 10 * 1024 * 1024
                        });
                        if (diff.trim()) {
                            console.log(diff);
                        } else {
                            console.log(`   (no unique changes — diff is empty)`);
                        }
                    } catch (diffErr) {
                        console.error(`   ❌ Failed to generate diff for ${adoptAgent}: ${diffErr.message || 'diff failed'}`);
                    }
                }
                console.log(`\n${'='.repeat(72)}`);
                console.log(`END OF ADOPTION DIFFS`);
                console.log(`${'='.repeat(72)}`);
            }

            if (losingBranches.length > 0) {
                console.log(`\n📦 Found ${losingBranches.length} other implementation(s):`);

                // Partition: adopted branches kept for reference, others show cleanup
                const adoptedBranches = losingBranches.filter(lb => adoptAgents.includes(lb.agent));
                const nonAdoptedBranches = losingBranches.filter(lb => !adoptAgents.includes(lb.agent));

                if (adoptedBranches.length > 0) {
                    console.log(`\n   📌 Kept for adoption reference:`);
                    adoptedBranches.forEach(lb => console.log(`      - ${lb.branch} (agent: ${lb.agent})`));
                }
                if (nonAdoptedBranches.length > 0) {
                    nonAdoptedBranches.forEach(lb => console.log(`   - ${lb.branch}`));
                    console.log(`\n🧹 Cleanup options:`);
                    console.log(`   aigon feature-cleanup ${num}         # Delete worktrees and local branches`);
                    console.log(`   aigon feature-cleanup ${num} --push  # Push branches to origin first, then delete`);
                }
            }
        }

        console.log(`\n✅ Feature ${num} complete! (${mode} mode)`);

        // Auto-deploy if workflow.deployAfterDone is set
        const deployAfterDone = loadProjectConfig()?.workflow?.deployAfterDone;
        if (deployAfterDone) {
            console.log(`\n🚀 Deploying (workflow.deployAfterDone)...`);
            const deployExitCode = runDeployCommand(deployAfterDone === 'preview');
            if (deployExitCode !== 0) {
                console.error(`\n⚠️  Deploy failed (exit ${deployExitCode}) — merge is intact, deploy manually with: aigon deploy`);
                process.exitCode = deployExitCode;
            } else {
                console.log(`✅ Deployed.`);
            }
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-done', hookContext);
    },
    'feature-cleanup': (args) => {
        const id = args[0];
        const pushFlag = args.includes('--push');
        if (!id) return console.error("Usage: aigon feature-cleanup <ID> [--push]\n\nRemoves all worktrees and branches for a feature.\n\nOptions:\n  --push  Push branches to origin before deleting locally\n\nExample: aigon feature-cleanup 55");

        const paddedId = String(id).padStart(2, '0');
        const unpaddedId = String(parseInt(id, 10));

        // Build hook context
        const hookContext = {
            featureId: paddedId
        };

        // Run pre-hook (can abort the command)
        if (!runPreHook('feature-cleanup', hookContext)) {
            return;
        }

        // Remove worktrees and collect paths for permission cleanup
        let worktreeCount = 0;
        const removedWorktreePaths = [];
        try {
            const stdout = execSync('git worktree list', { encoding: 'utf8' });
            const lines = stdout.split('\n');
            lines.forEach(line => {
                const match = line.match(/^([^\s]+)\s+/);
                if (!match) return;
                const wtPath = match[1];
                if (wtPath === process.cwd()) return;
                if (wtPath.includes(`feature-${paddedId}-`) || wtPath.includes(`feature-${unpaddedId}-`)) {
                    console.log(`   Removing worktree: ${wtPath}`);
                    removedWorktreePaths.push(wtPath);
                    try { execSync(`git worktree remove "${wtPath}" --force`); worktreeCount++; }
                    catch (err) { console.error(`   ❌ Failed to remove ${wtPath}`); }
                }
            });
        } catch (e) { console.error("❌ Error reading git worktrees."); }

        // Clean up worktree permissions and trust from Claude settings
        if (removedWorktreePaths.length > 0) {
            removeWorktreePermissions(removedWorktreePaths);
            removeWorktreeTrust(removedWorktreePaths);
        }

        // Find and handle branches
        const featureBranches = [];
        try {
            const branchOutput = execSync('git branch --list', { encoding: 'utf8' });
            const branches = branchOutput.split('\n').map(b => b.trim().replace('* ', '')).filter(b => b);
            branches.forEach(branch => {
                if (branch.startsWith(`feature-${paddedId}-`) || branch.startsWith(`feature-${unpaddedId}-`)) {
                    featureBranches.push(branch);
                }
            });
        } catch (e) {
            // Ignore errors
        }

        let branchCount = 0;
        if (featureBranches.length > 0) {
            featureBranches.forEach(branch => {
                if (pushFlag) {
                    try {
                        execSync(`git push -u origin ${branch}`, { stdio: 'pipe' });
                        console.log(`   📤 Pushed: ${branch}`);
                    } catch (e) {
                        console.warn(`   ⚠️  Could not push ${branch} (may already exist on remote)`);
                    }
                }
                try {
                    execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                    console.log(`   🗑️  Deleted local branch: ${branch}`);
                    branchCount++;
                } catch (e) {
                    console.error(`   ❌ Failed to delete ${branch}`);
                }
            });
        }

        console.log(`\n✅ Cleanup complete: ${worktreeCount} worktree(s), ${branchCount} branch(es) removed.`);
        if (!pushFlag && branchCount > 0) {
            console.log(`💡 Tip: Use 'aigon feature-cleanup ${id} --push' to push branches to origin before deleting.`);
        }

        // Run post-hook (won't fail the command)
        runPostHook('feature-cleanup', hookContext);
    },

    'agent-status': (args) => {
        const status = args[0];
        const validStatuses = ['implementing', 'waiting', 'submitted'];
        if (!status || !validStatuses.includes(status)) {
            return console.error(`Usage: aigon agent-status <status>\n\nValid statuses: ${validStatuses.join(', ')}\n\nExample: aigon agent-status waiting`);
        }

        // Detect branch
        let branch;
        try {
            branch = require('child_process').execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        } catch (e) {
            return console.error('❌ Could not detect current branch.');
        }

        // Parse feature ID and agent from branch name
        // Arena/worktree: feature-<ID>-<agent>-<desc>
        // Solo: feature-<ID>-<desc>
        const arenaMatch = branch.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
        const soloMatch = branch.match(/^feature-(\d+)-(.+)$/);

        let featureNum, agentId;
        if (arenaMatch) {
            featureNum = arenaMatch[1].padStart(2, '0');
            agentId = arenaMatch[2];
        } else if (soloMatch) {
            featureNum = soloMatch[1].padStart(2, '0');
            agentId = null; // solo
        } else {
            return console.error(`❌ Branch "${branch}" does not match a feature branch pattern (feature-<ID>-...)`);
        }

        // Glob for the matching log file
        const logsDir = path.join(PATHS.features.root, 'logs');
        if (!fs.existsSync(logsDir)) {
            return console.error(`❌ Logs directory not found: ${logsDir}`);
        }

        const logPattern = agentId
            ? `feature-${featureNum}-${agentId}-`
            : `feature-${featureNum}-`;
        const logFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(logPattern) && f.endsWith('-log.md') && !f.includes('/selected/') && !f.includes('/alternatives/'));

        // For drive mode, exclude files with an agent suffix (2-letter code after the ID)
        const filteredLogs = agentId
            ? logFiles
            : logFiles.filter(f => !f.match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`)));

        if (filteredLogs.length === 0) {
            return console.error(`❌ No log file found matching feature-${featureNum}${agentId ? '-' + agentId : ''}-*-log.md in ${logsDir}`);
        }

        const logFile = filteredLogs[0];
        const logPath = path.join(logsDir, logFile);
        let content = fs.readFileSync(logPath, 'utf8');

        const nowIso = new Date().toISOString();
        const newFrontMatter = `---\nstatus: ${status}\nupdated: ${nowIso}\n---\n`;

        // Replace existing front matter or prepend
        if (content.startsWith('---\n')) {
            content = content.replace(/^---\n[\s\S]*?\n---\n/, newFrontMatter);
        } else {
            content = newFrontMatter + '\n' + content;
        }

        fs.writeFileSync(logPath, content);
        console.log(`✅ Status updated: ${status} (${logFile})`);
    },

    'status': (args) => {
        const idArg = args[0] && !args[0].startsWith('--') ? args[0] : null;
        const logsDir = path.join(PATHS.features.root, 'logs');
        const inProgressDir = path.join(PATHS.features.root, '03-in-progress');

        if (!fs.existsSync(logsDir)) {
            return console.error('❌ No logs directory found. Run aigon feature-setup first.');
        }

        // Helper: parse front matter from log file content
        function parseFrontMatter(content) {
            const match = content.match(/^---\n([\s\S]*?)\n---\n/);
            if (!match) return null;
            const fm = {};
            match[1].split('\n').forEach(line => {
                const [key, ...rest] = line.split(':');
                if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
            });
            return fm;
        }

        // Helper: extract feature name from spec filename
        function featureNameFromSpec(filename) {
            // feature-31-log-status-tracking.md -> log-status-tracking
            const m = filename.match(/^feature-\d+-(.+)\.md$/);
            return m ? m[1] : filename;
        }

        let featureIds = [];
        if (idArg) {
            featureIds = [String(parseInt(idArg, 10)).padStart(2, '0')];
        } else {
            // Find all in-progress features
            if (!fs.existsSync(inProgressDir)) {
                return console.log('No features in progress.');
            }
            featureIds = fs.readdirSync(inProgressDir)
                .filter(f => f.match(/^feature-\d+-.+\.md$/))
                .map(f => {
                    const m = f.match(/^feature-(\d+)-/);
                    return m ? m[1].padStart(2, '0') : null;
                })
                .filter(Boolean);
        }

        if (featureIds.length === 0) {
            return console.log('No features in progress.');
        }

        let anyOutput = false;
        featureIds.forEach(featureNum => {
            // Get feature name from spec file
            let featureName = featureNum;
            if (fs.existsSync(inProgressDir)) {
                const specFile = fs.readdirSync(inProgressDir).find(f => f.startsWith(`feature-${featureNum}-`));
                if (specFile) featureName = featureNameFromSpec(specFile);
            }

            // Find all log files for this feature (excluding selected/alternatives subdirs)
            const allLogs = fs.readdirSync(logsDir)
                .filter(f => f.startsWith(`feature-${featureNum}-`) && f.endsWith('-log.md'));

            if (allLogs.length === 0) return;

            anyOutput = true;
            console.log(`\n#${featureNum}  ${featureName}`);

            allLogs.forEach(logFile => {
                const logPath = path.join(logsDir, logFile);
                const content = fs.readFileSync(logPath, 'utf8');
                const fm = parseFrontMatter(content);
                const status = fm ? fm.status || 'unknown' : 'unknown';
                const updated = fm ? fm.updated || '' : '';

                // Determine agent label
                // Arena: feature-31-cc-desc-log.md -> cc
                // Solo: feature-31-desc-log.md -> solo
                const arenaM = logFile.match(new RegExp(`^feature-${featureNum}-([a-z]{2})-`));
                const agent = arenaM ? arenaM[1] : 'solo';

                // Format time from ISO string
                let timeStr = '';
                if (updated) {
                    const d = new Date(updated);
                    if (!isNaN(d)) {
                        timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    }
                }

                const statusPad = status.padEnd(14);
                const agentPad = agent.padEnd(6);
                console.log(`  ${agentPad} ${statusPad} ${timeStr}`);
            });
        });

        if (!anyOutput) {
            console.log(idArg ? `No log files found for feature #${idArg}.` : 'No log files found for in-progress features.');
        }
    },

    'deploy': (args) => {
        const isPreview = args.includes('--preview');
        const exitCode = runDeployCommand(isPreview);
        if (exitCode !== 0) process.exitCode = exitCode;
    },

    'conductor': (args) => {
        const CONDUCTOR_PID_FILE = path.join(GLOBAL_CONFIG_DIR, 'conductor.pid');
        const CONDUCTOR_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'conductor.log');

        // --- Helpers ---

        function readConductorRepos() {
            try {
                if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
                const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
                return Array.isArray(cfg.repos) ? cfg.repos : [];
            } catch (e) {
                return [];
            }
        }

        function writeConductorRepos(repos) {
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

        function isDaemonAlive() {
            if (!fs.existsSync(CONDUCTOR_PID_FILE)) return false;
            try {
                const pid = parseInt(fs.readFileSync(CONDUCTOR_PID_FILE, 'utf8').trim(), 10);
                process.kill(pid, 0);
                return pid;
            } catch (e) {
                return false;
            }
        }

        function parseFrontMatterStatus(content) {
            const m = content.match(/^---\n([\s\S]*?)\n---\n/);
            if (!m) return null;
            const sm = m[1].match(/status:\s*(\S+)/);
            return sm ? sm[1] : null;
        }

        // --- Daemon implementation (runs as detached child) ---

        function runConductorDaemon() {
            const { execSync: exec } = require('child_process');

            function log(msg) {
                try {
                    fs.appendFileSync(CONDUCTOR_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
                } catch (e) { /* ignore */ }
            }

            // Write our own PID (complements what the parent wrote — same value)
            fs.writeFileSync(CONDUCTOR_PID_FILE, String(process.pid));
            log(`Conductor daemon started (PID ${process.pid})`);

            // In-memory state: log file key -> last status
            const lastStatus = {};
            // Track which feature+repo combos have had all-submitted notification sent
            const allSubmittedNotified = new Set();

            function sendNotification(message, title) {
                try {
                    exec(`osascript -e 'display notification "${message}" with title "${title}"'`);
                } catch (e) {
                    log(`Notification failed: ${e.message}`);
                }
            }

            function poll() {
                let repos;
                try {
                    repos = readConductorRepos();
                } catch (e) {
                    log(`Error reading config: ${e.message}`);
                    return;
                }

                repos.forEach(repoPath => {
                    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                    if (!fs.existsSync(logsDir)) return;

                    let logFiles;
                    try {
                        logFiles = fs.readdirSync(logsDir)
                            .filter(f => /^feature-\d+-.+-log\.md$/.test(f));
                    } catch (e) {
                        log(`Error reading logs dir ${logsDir}: ${e.message}`);
                        return;
                    }

                    // Per-feature tracking for all-submitted notification
                    const featureAgents = {}; // featureId -> { total, submitted, name }

                    logFiles.forEach(logFile => {
                        const logPath = path.join(logsDir, logFile);
                        let content;
                        try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { return; }

                        const status = parseFrontMatterStatus(content) || 'unknown';
                        const key = `${repoPath}:${logFile}`;
                        const prev = lastStatus[key];
                        lastStatus[key] = status;

                        // Parse feature ID and agent
                        const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                        const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                        const featureId = arenaM ? arenaM[1] : (soloM ? soloM[1] : null);
                        const agent = arenaM ? arenaM[2] : 'solo';
                        const featureName = arenaM ? arenaM[3] : (soloM ? soloM[2] : featureId);

                        if (!featureId) return;

                        // Track totals for all-submitted check
                        if (!featureAgents[featureId]) featureAgents[featureId] = { total: 0, submitted: 0, name: featureName };
                        featureAgents[featureId].total++;
                        if (status === 'submitted') featureAgents[featureId].submitted++;

                        // Notify on transition to waiting
                        if (prev !== undefined && prev !== 'waiting' && status === 'waiting') {
                            const repoName = path.basename(repoPath);
                            sendNotification(
                                `${agent} is waiting on #${featureId} ${featureName}`,
                                `Aigon · ${repoName}`
                            );
                            log(`Notified: ${agent} waiting on #${featureId} in ${repoName}`);
                        }
                    });

                    // Check all-submitted per feature
                    Object.entries(featureAgents).forEach(([featureId, data]) => {
                        const allKey = `${repoPath}:${featureId}`;
                        if (data.total > 0 && data.submitted === data.total && !allSubmittedNotified.has(allKey)) {
                            allSubmittedNotified.add(allKey);
                            const repoName = path.basename(repoPath);
                            sendNotification(
                                `All agents submitted #${featureId} ${data.name} — ready for eval`,
                                `Aigon · ${repoName}`
                            );
                            log(`Notified: all submitted #${featureId} in ${repoName}`);
                        }
                        // Reset if no longer all submitted (e.g. new agent added)
                        if (data.submitted < data.total) {
                            allSubmittedNotified.delete(allKey);
                        }
                    });
                });

                log(`Poll complete (${repos.length} repo${repos.length !== 1 ? 's' : ''})`);
            }

            // Initial poll then every 30 seconds
            try { poll(); } catch (e) { log(`Poll error: ${e.message}`); }
            setInterval(() => {
                try { poll(); } catch (e) { log(`Poll error: ${e.message}`); }
            }, 30000);

            // Keep process alive
            process.stdin.resume();
        }

        // --- Subcommand dispatch ---

        const sub = args[0];

        // Internal: daemon mode (called as detached child)
        if (sub === '--daemon') {
            return runConductorDaemon();
        }

        if (sub === 'start') {
            const pid = isDaemonAlive();
            if (pid) {
                console.log(`⚠️  Conductor already running (PID ${pid})`);
                console.log(`   Run: aigon conductor stop`);
                return;
            }
            // Clear stale PID file
            if (fs.existsSync(CONDUCTOR_PID_FILE)) fs.unlinkSync(CONDUCTOR_PID_FILE);

            const { spawn } = require('child_process');
            const child = spawn(process.execPath, [__filename, 'conductor', '--daemon'], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            });
            child.unref();
            if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
            fs.writeFileSync(CONDUCTOR_PID_FILE, String(child.pid));
            console.log(`✅ Conductor started (PID ${child.pid})`);
            console.log(`   Polling every 30s across ${readConductorRepos().length} repo(s)`);
            console.log(`📋 Logs: ${CONDUCTOR_LOG_FILE}`);
            return;
        }

        if (sub === 'stop') {
            const pid = isDaemonAlive();
            if (!pid) {
                console.log('⛔ Conductor is not running.');
                if (fs.existsSync(CONDUCTOR_PID_FILE)) fs.unlinkSync(CONDUCTOR_PID_FILE);
                return;
            }
            try {
                process.kill(pid, 'SIGTERM');
                fs.unlinkSync(CONDUCTOR_PID_FILE);
                console.log(`✅ Conductor stopped (PID ${pid})`);
            } catch (e) {
                console.error(`❌ Failed to stop conductor: ${e.message}`);
            }
            return;
        }

        if (sub === 'status') {
            const pid = isDaemonAlive();
            console.log(`Conductor: ${pid ? `✅ running (PID ${pid})` : '⛔ stopped'}`);

            const repos = readConductorRepos();
            if (repos.length === 0) {
                console.log('Repos:     (none — run: aigon conductor add)');
            } else {
                console.log(`Repos (${repos.length}):`);
                repos.forEach(r => console.log(`  ${r}`));
            }

            // Last log line
            if (fs.existsSync(CONDUCTOR_LOG_FILE)) {
                const lines = fs.readFileSync(CONDUCTOR_LOG_FILE, 'utf8').trim().split('\n');
                const last = lines[lines.length - 1];
                if (last) console.log(`Last poll: ${last}`);
            }

            // Show currently waiting agents
            const waiting = [];
            repos.forEach(repoPath => {
                const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                if (!fs.existsSync(logsDir)) return;
                fs.readdirSync(logsDir)
                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                    .forEach(logFile => {
                        try {
                            const content = fs.readFileSync(path.join(logsDir, logFile), 'utf8');
                            const status = parseFrontMatterStatus(content);
                            if (status === 'waiting') {
                                const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                                const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                                const featureId = arenaM ? arenaM[1] : soloM?.[1];
                                const agent = arenaM ? arenaM[2] : 'solo';
                                const name = arenaM ? arenaM[3] : soloM?.[2];
                                waiting.push(`  ${path.basename(repoPath)}: #${featureId} ${name} (${agent})`);
                            }
                        } catch (e) { /* skip */ }
                    });
            });
            if (waiting.length > 0) {
                console.log(`Waiting agents (${waiting.length}):`);
                waiting.forEach(w => console.log(w));
            } else if (repos.length > 0) {
                console.log('Waiting:   none');
            }
            return;
        }

        if (sub === 'add') {
            const repoPath = path.resolve(args[1] || process.cwd());
            const repos = readConductorRepos();
            if (repos.includes(repoPath)) {
                console.log(`⚠️  Already registered: ${repoPath}`);
                return;
            }
            repos.push(repoPath);
            writeConductorRepos(repos);
            console.log(`✅ Registered: ${repoPath}`);
            console.log(`   Total repos: ${repos.length}`);
            return;
        }

        if (sub === 'remove') {
            const repoPath = path.resolve(args[1] || process.cwd());
            const repos = readConductorRepos();
            const idx = repos.indexOf(repoPath);
            if (idx === -1) {
                console.log(`⚠️  Not registered: ${repoPath}`);
                return;
            }
            repos.splice(idx, 1);
            writeConductorRepos(repos);
            console.log(`✅ Removed: ${repoPath}`);
            return;
        }

        if (sub === 'list') {
            const repos = readConductorRepos();
            if (repos.length === 0) {
                console.log('No repos registered. Run: aigon conductor add');
                return;
            }
            console.log(`Watched repos (${repos.length}):`);
            repos.forEach(r => console.log(`  ${r}`));
            return;
        }

        if (sub === 'vscode-install') {
            const vsixPath = path.join(__dirname, 'vscode-extension', 'aigon-conductor-1.0.0.vsix');
            if (!fs.existsSync(vsixPath)) {
                console.error(`❌ Extension bundle not found: ${vsixPath}`);
                console.error(`   Try rebuilding: cd vscode-extension && npm run package`);
                return;
            }
            // Check code CLI is available
            try {
                execSync('code --version', { stdio: 'ignore' });
            } catch (e) {
                console.error('❌ VS Code CLI not found. Make sure "code" is in your PATH.');
                console.error('   In VS Code: Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH"');
                return;
            }
            console.log('📦 Installing Aigon Conductor extension...');
            try {
                execSync(`code --install-extension "${vsixPath}" --force`, { stdio: 'inherit' });
                console.log('✅ Aigon Conductor installed. Reload VS Code to activate.');
            } catch (e) {
                console.error(`❌ Installation failed: ${e.message}`);
            }
            return;
        }

        if (sub === 'vscode-uninstall') {
            try {
                execSync('code --version', { stdio: 'ignore' });
            } catch (e) {
                console.error('❌ VS Code CLI not found.');
                return;
            }
            console.log('🗑️  Uninstalling Aigon Conductor extension...');
            try {
                execSync('code --uninstall-extension aigon.aigon-conductor', { stdio: 'inherit' });
                console.log('✅ Aigon Conductor uninstalled.');
            } catch (e) {
                console.error(`❌ Uninstall failed: ${e.message}`);
            }
            return;
        }

        if (sub === 'menubar-render') {
            const repos = readConductorRepos();
            if (repos.length === 0) {
                console.log('⚙ –');
                console.log('---');
                console.log('No repos registered');
                console.log('Run: aigon conductor add | href=https://github.com/jviner/aigon');
                return;
            }

            const nodeExec = process.execPath;
            const aigonScript = __filename;
            let waitingCount = 0;
            let implementingCount = 0;
            const sections = [];

            repos.forEach(repoPath => {
                const inProgressDir = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress');
                const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');

                // Source of truth: specs in 03-in-progress/
                let specFiles = [];
                if (fs.existsSync(inProgressDir)) {
                    try {
                        specFiles = fs.readdirSync(inProgressDir)
                            .filter(f => /^feature-\d+-.+\.md$/.test(f));
                    } catch (e) { /* skip */ }
                }

                if (specFiles.length === 0) return;

                // Build a map of log statuses for enrichment
                const logStatuses = {}; // key: "featureId" or "featureId-agent" -> status
                if (fs.existsSync(logsDir)) {
                    try {
                        fs.readdirSync(logsDir)
                            .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                            .forEach(logFile => {
                                const logPath = path.join(logsDir, logFile);
                                let content;
                                try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { return; }
                                const status = parseFrontMatterStatus(content);

                                const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                                const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                                const featureId = arenaM ? arenaM[1] : (soloM ? soloM[1] : null);
                                const agent = arenaM ? arenaM[2] : null;

                                if (!featureId) return;
                                if (agent) {
                                    logStatuses[`${featureId}-${agent}`] = status || 'implementing';
                                } else {
                                    logStatuses[featureId] = status || 'implementing';
                                }
                            });
                    } catch (e) { /* skip */ }
                }

                // Discover worktrees for this repo to detect fleet agents
                const worktreeAgents = {}; // featureId -> [agent, agent, ...]
                const worktreeBaseDir = repoPath + '-worktrees';
                if (fs.existsSync(worktreeBaseDir)) {
                    try {
                        fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                            const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                            if (wtM) {
                                const fid = wtM[1];
                                if (!worktreeAgents[fid]) worktreeAgents[fid] = [];
                                worktreeAgents[fid].push(wtM[2]);
                            }
                        });
                    } catch (e) { /* skip */ }
                }

                // Group by feature from specs, enrich with log status + worktree agents
                const features = {};
                specFiles.forEach(specFile => {
                    const m = specFile.match(/^feature-(\d+)-(.+)\.md$/);
                    if (!m) return;
                    const featureId = m[1];
                    const featureName = m[2];

                    if (!features[featureId]) features[featureId] = { name: featureName, agents: [] };

                    // Collect known agents from both log files and worktrees
                    const agentSet = new Set();
                    Object.keys(logStatuses)
                        .filter(k => k.startsWith(`${featureId}-`) && k.includes('-'))
                        .forEach(k => agentSet.add(k.split('-').slice(1).join('-')));
                    if (worktreeAgents[featureId]) {
                        worktreeAgents[featureId].forEach(a => agentSet.add(a));
                    }

                    if (agentSet.size > 0) {
                        // Fleet mode: multiple agents (from logs and/or worktrees)
                        agentSet.forEach(agent => {
                            const status = logStatuses[`${featureId}-${agent}`] || 'implementing';
                            features[featureId].agents.push({ agent, status });
                            if (status === 'waiting') waitingCount++;
                            else if (status === 'implementing') implementingCount++;
                        });
                    } else {
                        // Solo mode: single log or no log
                        const status = logStatuses[featureId] || 'implementing';
                        features[featureId].agents.push({ agent: 'solo', status });
                        if (status === 'waiting') waitingCount++;
                        else if (status === 'implementing') implementingCount++;
                    }
                });

                if (Object.keys(features).length === 0) return;

                const repoShort = repoPath.replace(os.homedir(), '~');
                const lines = [];
                lines.push(repoShort + ' | size=14');

                Object.entries(features).sort((a, b) => a[0].localeCompare(b[0])).forEach(([fid, data]) => {
                    lines.push(`#${fid} ${data.name} | size=13`);
                    data.agents.forEach(({ agent, status }) => {
                        const icon = status === 'waiting' ? '●' : status === 'submitted' ? '✓' : '○';
                        const focusParams = agent === 'solo'
                            ? `param1="${aigonScript}" param2=terminal-focus param3=${fid} param4=--repo param5="${repoPath}"`
                            : `param1="${aigonScript}" param2=terminal-focus param3=${fid} param4=${agent} param5=--repo param6="${repoPath}"`;
                        const paddedId = String(fid).padStart(2, '0');
                        const slashCmd = `/afd ${paddedId}`;

                        lines.push(`-- ${icon} ${agent}: ${status} | bash="${nodeExec}" ${focusParams} terminal=false`);
                        lines.push(`-- ${icon} ${agent}: ${status} — copy cmd | alternate=true bash=/bin/bash param1=-c param2="echo '${slashCmd}' | pbcopy" terminal=false`);
                    });
                });

                sections.push(lines);
            });

            // Menubar title
            if (waitingCount > 0) {
                console.log(`⚙ ${waitingCount} waiting`);
            } else if (implementingCount > 0) {
                console.log(`⚙ ${implementingCount} running`);
            } else {
                console.log('⚙ –');
            }
            console.log('---');

            if (sections.length === 0) {
                console.log('No active features');
            } else {
                sections.forEach((lines, i) => {
                    if (i > 0) console.log('---');
                    lines.forEach(l => console.log(l));
                });
            }

            console.log('---');
            console.log('Refresh | refresh=true');
            return;
        }

        if (sub === 'menubar-install') {
            // Detect SwiftBar or xbar
            const swiftBarApp = '/Applications/SwiftBar.app';
            const xbarApp = '/Applications/xbar.app';
            const swiftBarDir = path.join(os.homedir(), '.swiftbar');
            const xbarDir = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins');

            let pluginDir;
            let appName;

            if (fs.existsSync(swiftBarApp)) {
                pluginDir = swiftBarDir;
                appName = 'SwiftBar';
            } else if (fs.existsSync(xbarApp)) {
                pluginDir = xbarDir;
                appName = 'xbar';
            } else {
                console.error('❌ Neither SwiftBar nor xbar found in /Applications/');
                console.error('');
                console.error('   Install SwiftBar (recommended):');
                console.error('   brew install --cask swiftbar');
                console.error('');
                console.error('   Or install xbar:');
                console.error('   brew install --cask xbar');
                return;
            }

            if (!fs.existsSync(pluginDir)) {
                fs.mkdirSync(pluginDir, { recursive: true });
            }

            const pluginPath = path.join(pluginDir, 'aigon.30s.sh');
            const nodeExec = process.execPath;
            const aigonScript = __filename;

            const pluginContent = `#!/bin/bash
# Aigon Conductor Menubar Plugin
# Installed by: aigon conductor menubar-install
# Refresh: every 30 seconds (.30s. in filename)

"${nodeExec}" "${aigonScript}" conductor menubar-render
`;

            fs.writeFileSync(pluginPath, pluginContent);
            fs.chmodSync(pluginPath, '755');

            console.log(`✅ Menubar plugin installed for ${appName}`);
            console.log(`   Plugin: ${pluginPath}`);
            console.log(`   Refresh: every 30 seconds`);
            console.log('');
            console.log(`   Make sure ${appName} is running to see the menubar icon.`);
            if (readConductorRepos().length === 0) {
                console.log('');
                console.log('   ⚠️  No repos registered. Run: aigon conductor add');
            }
            return;
        }

        if (sub === 'menubar-uninstall') {
            const swiftBarPlugin = path.join(os.homedir(), '.swiftbar', 'aigon.30s.sh');
            const xbarPlugin = path.join(os.homedir(), 'Library', 'Application Support', 'xbar', 'plugins', 'aigon.30s.sh');

            let removed = false;
            if (fs.existsSync(swiftBarPlugin)) {
                fs.unlinkSync(swiftBarPlugin);
                console.log(`✅ Removed SwiftBar plugin: ${swiftBarPlugin}`);
                removed = true;
            }
            if (fs.existsSync(xbarPlugin)) {
                fs.unlinkSync(xbarPlugin);
                console.log(`✅ Removed xbar plugin: ${xbarPlugin}`);
                removed = true;
            }
            if (!removed) {
                console.log('⚠️  No menubar plugin found to remove.');
            }
            return;
        }

        // Default: show usage
        console.log('Usage: aigon conductor <subcommand>\n');
        console.log('Subcommands:');
        console.log('  start              Start the background daemon');
        console.log('  stop               Stop the daemon');
        console.log('  status             Show daemon state, watched repos, waiting agents');
        console.log('  add [path]         Register a repo (default: cwd)');
        console.log('  remove [path]      Unregister a repo (default: cwd)');
        console.log('  list               List registered repos');
        console.log('  vscode-install     Install the Aigon VS Code extension');
        console.log('  vscode-uninstall   Uninstall the Aigon VS Code extension');
        console.log('  menubar-install    Install SwiftBar/xbar menubar plugin');
        console.log('  menubar-uninstall  Remove the menubar plugin');
        console.log('  menubar-render     Output menubar plugin content (used by plugin)');
    },

    'terminal-focus': (args) => {
        // Parse --repo flag from args
        let repoFlag = null;
        const filteredArgs = [];
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--repo' && args[i + 1]) {
                repoFlag = args[i + 1];
                i++; // skip value
            } else if (args[i].startsWith('--repo=')) {
                repoFlag = args[i].slice('--repo='.length);
            } else {
                filteredArgs.push(args[i]);
            }
        }

        const featureId = filteredArgs[0];
        if (!featureId) {
            console.error('Usage: aigon terminal-focus <featureId> [agent] [--repo <path>]');
            console.error('  Opens or focuses the terminal for a running feature agent.');
            return;
        }
        const requestedAgent = filteredArgs[1] || null;

        // Resolve terminal preference: project config > global config > default
        const effectiveConfig = getEffectiveConfig();
        const terminal = effectiveConfig.terminal || 'warp';

        const repoPath = repoFlag || process.cwd();

        // Scan worktrees directory directly (works cross-repo, no git dependency)
        const worktreeBaseDir = repoPath + '-worktrees';
        const worktrees = [];
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
                    if (wtM) {
                        const wtPath = path.join(worktreeBaseDir, dirName);
                        worktrees.push({
                            path: wtPath,
                            featureId: wtM[1],
                            agent: wtM[2],
                            desc: wtM[3],
                            mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
                        });
                    }
                });
            } catch (e) { /* skip */ }
        }

        // Also try git worktree list if in the right repo
        if (worktrees.length === 0) {
            try {
                const found = findWorktrees();
                worktrees.push(...found);
            } catch (e) { /* skip */ }
        }

        const matching = filterByFeatureId(worktrees, featureId);

        if (matching.length > 0) {
            let target;
            if (requestedAgent) {
                target = matching.find(wt => wt.agent === requestedAgent);
                if (!target) {
                    console.error(`❌ No worktree found for feature #${featureId} agent ${requestedAgent}`);
                    console.error(`   Available: ${matching.map(wt => wt.agent).join(', ')}`);
                    return;
                }
            } else {
                // Pick most recently modified
                target = matching.sort((a, b) => b.mtime - a.mtime)[0];
            }

            const focusCommand = terminal === 'tmux'
                ? buildAgentCommand(target)
                : 'echo "Ready — run your agent command here"';
            openSingleWorktree(target, focusCommand, terminal);
            return;
        }

        // No worktree — solo branch mode. Open terminal at repo root.
        const fakeWt = {
            path: repoPath,
            featureId: String(featureId).padStart(2, '0'),
            agent: requestedAgent || 'solo',
            desc: 'branch-mode'
        };
        const fallbackCommand = terminal === 'tmux' ? '' : 'echo "Ready — run your agent command here"';
        openSingleWorktree(fakeWt, fallbackCommand, terminal);
    },

    'board': (args) => {
        const flags = new Set(args.filter(a => a.startsWith('--')));
        const listMode = flags.has('--list');
        const showFeatures = flags.has('--features');
        const showResearch = flags.has('--research');
        const showAll = flags.has('--all');
        const showActive = flags.has('--active');
        const showInbox = flags.has('--inbox');
        const showBacklog = flags.has('--backlog');
        const showDone = flags.has('--done');
        const showActions = !flags.has('--no-actions');

        // If neither --features nor --research, show both
        const includeFeatures = !showResearch || showFeatures;
        const includeResearch = !showFeatures || showResearch;

        if (listMode) {
            // Detailed list view
            displayBoardListView({
                includeFeatures,
                includeResearch,
                showAll,
                showActive,
                showInbox,
                showBacklog,
                showDone,
                showActions
            });
        } else {
            // Kanban board view
            displayBoardKanbanView({
                includeFeatures,
                includeResearch,
                showAll,
                showActive,
                showInbox,
                showBacklog,
                showDone,
                showActions
            });
        }
    },
    'install-agent': (args) => {
        // Use new config-driven approach
        const availableAgents = getAvailableAgents();

        if (args.length === 0) {
            const agentList = availableAgents.join('|');
            return console.error(`Usage: aigon install-agent <${agentList}> [${agentList}] ...\nExample: aigon install-agent cc gg`);
        }

        // Build alias map dynamically from agent configs
        const agentMap = buildAgentAliasMap();

        const agents = args.map(a => agentMap[a.toLowerCase()]).filter(Boolean);
        if (agents.length === 0) {
            return console.error(`❌ No valid agents specified. Available: ${availableAgents.join(', ')}`);
        }

        const uniqueAgents = [...new Set(agents)];

        try {
            // 1. Create shared workflow documentation (always)
            const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
            const workflowContent = readTemplate('docs/development_workflow.md');
            const workflowStatus = safeWriteWithStatus(workflowPath, workflowContent);
            if (workflowStatus !== 'unchanged') {
                console.log(`✅ ${workflowStatus.charAt(0).toUpperCase() + workflowStatus.slice(1)}: docs/development_workflow.md`);
            }

            // 2. Create/update shared AGENTS.md root instructions
            const agentsMdStatus = syncAgentsMdFile();
            if (agentsMdStatus !== 'unchanged') {
                console.log(`✅ ${agentsMdStatus.charAt(0).toUpperCase() + agentsMdStatus.slice(1)}: AGENTS.md`);
            }

            // 3. Install each agent using its config
            uniqueAgents.forEach(agentKey => {
                const config = loadAgentConfig(agentKey);
                if (!config) {
                    console.warn(`⚠️  No config found for agent: ${agentKey}`);
                    return;
                }

                console.log(`\n📦 Installing ${config.name} (${config.id})...`);

                // Create/update docs/agents/<agent>.md from template (preserves user additions)
                const agentDocPath = path.join(process.cwd(), 'docs', 'agents', config.agentFile);
                const agentTemplateRaw = readTemplate(config.templatePath);
                // Process template with agent-specific placeholders
                const agentTemplateContent = processTemplate(agentTemplateRaw, config.placeholders);
                // Template already contains markers, extract content between them for upsert
                const markerContentMatch = agentTemplateContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                const agentContent = markerContentMatch ? markerContentMatch[1] : agentTemplateContent;
                const agentAction = upsertMarkedContent(agentDocPath, agentContent);
                if (agentAction !== 'unchanged') {
                    console.log(`   ✅ ${agentAction.charAt(0).toUpperCase() + agentAction.slice(1)}: docs/agents/${config.agentFile}`);
                }

                // Create/update root <AGENT>.md with markers (if agent uses one)
                if (config.rootFile) {
                    const rootFilePath = path.join(process.cwd(), config.rootFile);
                    const rootContent = getRootFileContent(config);
                    const markedContent = `${MARKER_START}\n${rootContent}\n${MARKER_END}`;

                    if (!fs.existsSync(rootFilePath)) {
                        // First creation: prepend scaffold sections above markers
                        safeWrite(rootFilePath, getScaffoldContent() + markedContent + '\n');
                        console.log(`   ✅ Created: ${config.rootFile}`);
                    } else {
                        // File exists: only update marker content (preserves scaffold & user edits)
                        const action = upsertMarkedContent(rootFilePath, rootContent);
                        if (action !== 'unchanged') {
                            console.log(`   ✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${config.rootFile}`);
                        }
                    }
                }

                // Generate and install commands from generic templates
                if (config.commands && config.commands.length > 0 && config.output) {
                    // Expand ~ to home directory for global commands
                    let cmdDir = config.output.commandDir;
                    if (cmdDir.startsWith('~')) {
                        cmdDir = cmdDir.replace('~', process.env.HOME || process.env.USERPROFILE);
                    } else {
                        cmdDir = path.join(process.cwd(), cmdDir);
                    }

                    // Merge profile-derived placeholders into config
                    const profilePlaceholders = getProfilePlaceholders();
                    const mergedConfig = { ...config, placeholders: { ...config.placeholders, ...profilePlaceholders } };

                    let cmdChanges = { created: 0, updated: 0 };
                    mergedConfig.commands.forEach(cmdName => {
                        // Read generic template and process placeholders (includes profile-derived values)
                        const genericContent = readGenericTemplate(`commands/${cmdName}.md`, mergedConfig);
                        const description = extractDescription(genericContent);

                        // Format output based on agent's output format
                        const outputContent = formatCommandOutput(genericContent, description, cmdName, config);

                        // Write to agent's command directory
                        const fileName = `${config.output.commandFilePrefix}${cmdName}${config.output.commandFileExtension}`;
                        const status = safeWriteWithStatus(path.join(cmdDir, fileName), outputContent);
                        if (status === 'created') cmdChanges.created++;
                        else if (status === 'updated') cmdChanges.updated++;

                        // Generate short alias files in parent directory for top-level access
                        // e.g., .claude/commands/fs.md → user types /fs instead of /aigon:feature-submit
                        const aliases = COMMAND_ALIAS_REVERSE[cmdName] || [];
                        const aliasDir = path.dirname(cmdDir);
                        aliases.forEach(alias => {
                            const aliasDesc = `${description} (shortcut for ${cmdName})`;
                            const aliasContent = formatCommandOutput(genericContent, aliasDesc, cmdName, config);
                            const aliasFileName = `${config.output.commandFilePrefix}${alias}${config.output.commandFileExtension}`;
                            const aliasStatus = safeWriteWithStatus(path.join(aliasDir, aliasFileName), aliasContent);
                            if (aliasStatus === 'created') cmdChanges.created++;
                            else if (aliasStatus === 'updated') cmdChanges.updated++;
                        });
                    });

                    const removed = removeDeprecatedCommands(cmdDir, config);

                    // Clean up deprecated alias files in parent directory
                    // Uses content-based detection: only removes files containing '(shortcut for '
                    const aliasParentDir = path.dirname(cmdDir);
                    const expectedAliasFiles = new Set(
                        Object.keys(COMMAND_ALIASES).map(alias =>
                            `${config.output.commandFilePrefix}${alias}${config.output.commandFileExtension}`
                        )
                    );
                    const removedAliases = [];
                    if (fs.existsSync(aliasParentDir)) {
                        for (const file of fs.readdirSync(aliasParentDir)) {
                            if (!file.endsWith(config.output.commandFileExtension)) continue;
                            const filePath = path.join(aliasParentDir, file);
                            if (!fs.statSync(filePath).isFile()) continue;
                            // Skip current aliases
                            if (expectedAliasFiles.has(file)) continue;
                            // Only remove files generated by us (contain shortcut marker in description)
                            try {
                                const content = fs.readFileSync(filePath, 'utf8');
                                if (!content.includes('(shortcut for ')) continue;
                                fs.unlinkSync(filePath);
                                removedAliases.push(file);
                            } catch (e) { /* ignore */ }
                        }
                    }

                    // Migrate: clean up old flat commands when agent now uses subdirectory
                    // e.g., CC moved from .claude/commands/aigon-*.md to .claude/commands/aigon/*.md
                    const migrated = migrateOldFlatCommands(cmdDir, config);

                    // Only report if there were actual changes
                    const totalChanges = cmdChanges.created + cmdChanges.updated + removed.length + removedAliases.length + migrated.length;
                    if (totalChanges > 0) {
                        if (config.output.global) {
                            console.log(`   ✅ Installed global prompts: ${config.output.commandDir}`);
                            console.log(`   ⚠️  Note: Codex prompts are global (shared across all projects)`);
                        } else {
                            const parts = [];
                            if (cmdChanges.created > 0) parts.push(`${cmdChanges.created} created`);
                            if (cmdChanges.updated > 0) parts.push(`${cmdChanges.updated} updated`);
                            console.log(`   ✅ Commands: ${parts.join(', ') || 'synced'}`);
                        }
                        if (removed.length > 0) {
                            console.log(`   🧹 Removed ${removed.length} deprecated command(s): ${removed.join(', ')}`);
                        }
                        if (migrated.length > 0) {
                            console.log(`   🔄 Migrated: removed ${migrated.length} old flat command(s) from parent directory`);
                        }
                    }
                }

                // Process extras (skill, settings, prompt, config)
                const extras = config.extras || {};

                // Claude: SKILL.md
                if (extras.skill && extras.skill.enabled) {
                    // Add AGENT_FILE placeholder for skill template
                    const skillPlaceholders = { ...config.placeholders, AGENT_FILE: config.agentFile.replace('.md', '') };
                    const skillContent = processTemplate(readTemplate('generic/skill.md'), skillPlaceholders);
                    const skillStatus = safeWriteWithStatus(path.join(process.cwd(), extras.skill.path), skillContent);
                    if (skillStatus !== 'unchanged') {
                        console.log(`   ✅ ${skillStatus.charAt(0).toUpperCase() + skillStatus.slice(1)}: ${extras.skill.path}`);
                    }
                }

                // Settings files (Claude permissions, Gemini allowedTools)
                if (extras.settings && extras.settings.enabled) {
                    const settingsPath = path.join(process.cwd(), extras.settings.path);
                    let settings = {};
                    let existingContent = '';
                    if (fs.existsSync(settingsPath)) {
                        try {
                            existingContent = fs.readFileSync(settingsPath, 'utf8');
                            settings = JSON.parse(existingContent);
                        } catch (e) {
                            console.warn(`   ⚠️  Could not parse existing ${extras.settings.path}, creating new one`);
                        }
                    }

                    let settingsChanged = false;

                    // Add permissions (Claude, Cursor)
                    if (extras.settings.permissions) {
                        if (!settings.permissions) settings.permissions = {};
                        if (!settings.permissions.allow) settings.permissions.allow = [];
                        if (!settings.permissions.deny) settings.permissions.deny = [];
                        extras.settings.permissions.forEach(perm => {
                            if (!settings.permissions.allow.includes(perm)) {
                                settings.permissions.allow.push(perm);
                                settingsChanged = true;
                            }
                        });
                        if (settingsChanged) {
                            console.log(`   ✅ Added permissions to ${extras.settings.path}`);
                        }
                    }

                    // Add deny permissions (Claude)
                    if (extras.settings.denyPermissions) {
                        if (!settings.permissions) settings.permissions = {};
                        if (!settings.permissions.deny) settings.permissions.deny = [];
                        let deniesAdded = false;
                        extras.settings.denyPermissions.forEach(perm => {
                            if (!settings.permissions.deny.includes(perm)) {
                                settings.permissions.deny.push(perm);
                                deniesAdded = true;
                            }
                        });
                        if (deniesAdded) {
                            console.log(`   🛡️  Added deny rules to ${extras.settings.path}`);
                            settingsChanged = true;
                        }
                    }

                    // Add allowedTools (Gemini)
                    if (extras.settings.allowedTools) {
                        if (!settings.allowedTools) settings.allowedTools = [];
                        let toolsAdded = false;
                        extras.settings.allowedTools.forEach(tool => {
                            if (!settings.allowedTools.includes(tool)) {
                                settings.allowedTools.push(tool);
                                toolsAdded = true;
                            }
                        });
                        if (toolsAdded) {
                            console.log(`   ✅ Added allowedTools to ${extras.settings.path}`);
                            settingsChanged = true;
                        }
                    }

                    // Add SessionStart hooks (Claude, Gemini — embedded in settings file)
                    if (extras.settings.hooks) {
                        if (!settings.hooks) settings.hooks = {};
                        Object.entries(extras.settings.hooks).forEach(([event, hookConfigs]) => {
                            if (!settings.hooks[event]) settings.hooks[event] = [];
                            hookConfigs.forEach(hookConfig => {
                                // Check if an Aigon hook already exists (by matching command string)
                                const aigonCmd = 'aigon check-version';
                                const alreadyExists = settings.hooks[event].some(existing => {
                                    // Claude/Gemini format: nested hooks array with command field
                                    if (existing.hooks) {
                                        return existing.hooks.some(h => h.command && h.command.includes(aigonCmd));
                                    }
                                    // Flat format: command field directly
                                    return existing.command && existing.command.includes(aigonCmd);
                                });
                                if (!alreadyExists) {
                                    settings.hooks[event].push(hookConfig);
                                    settingsChanged = true;
                                }
                            });
                        });
                        if (settingsChanged) {
                            console.log(`   🔄 Added SessionStart hook to ${extras.settings.path}`);
                        }
                    }

                    // Only write if something changed
                    const newContent = JSON.stringify(settings, null, 2);
                    if (newContent !== existingContent) {
                        safeWrite(settingsPath, newContent);
                    }
                }

                // Standalone hooks file (Cursor — separate from settings)
                if (extras.hooks && extras.hooks.enabled) {
                    const hooksPath = path.join(process.cwd(), extras.hooks.path);
                    let hooksFile = {};
                    let existingHooksContent = '';
                    if (fs.existsSync(hooksPath)) {
                        try {
                            existingHooksContent = fs.readFileSync(hooksPath, 'utf8');
                            hooksFile = JSON.parse(existingHooksContent);
                        } catch (e) {
                            console.warn(`   ⚠️  Could not parse existing ${extras.hooks.path}, creating new one`);
                        }
                    }

                    // Merge hook content
                    const hookContent = extras.hooks.content;
                    let hooksChanged = false;
                    if (hookContent.hooks) {
                        if (!hooksFile.hooks) hooksFile.hooks = {};
                        Object.entries(hookContent.hooks).forEach(([event, hookConfigs]) => {
                            if (!hooksFile.hooks[event]) hooksFile.hooks[event] = [];
                            hookConfigs.forEach(hookConfig => {
                                const aigonCmd = 'aigon check-version';
                                const alreadyExists = hooksFile.hooks[event].some(existing =>
                                    existing.command && existing.command.includes(aigonCmd)
                                );
                                if (!alreadyExists) {
                                    hooksFile.hooks[event].push(hookConfig);
                                    hooksChanged = true;
                                }
                            });
                        });
                    }

                    if (hooksChanged) {
                        const newHooksContent = JSON.stringify(hooksFile, null, 2);
                        if (newHooksContent !== existingHooksContent) {
                            safeWrite(hooksPath, newHooksContent);
                            console.log(`   🔄 Added SessionStart hook to ${extras.hooks.path}`);
                        }
                    }
                }

                // Codex: prompt.md (uses upsert to preserve user content outside markers)
                if (extras.prompt && extras.prompt.enabled) {
                    // Add AGENT_FILE placeholder for prompt template
                    const promptPlaceholders = { ...config.placeholders, AGENT_FILE: config.agentFile };
                    const promptContent = processTemplate(readTemplate('generic/prompt.md'), promptPlaceholders);
                    // Extract content between markers (template already has markers)
                    const markerContentMatch = promptContent.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
                    const innerContent = markerContentMatch ? markerContentMatch[1] : promptContent;
                    const promptPath = path.join(process.cwd(), extras.prompt.path);
                    const action = upsertMarkedContent(promptPath, innerContent);
                    if (action !== 'unchanged') {
                        console.log(`   ✅ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${extras.prompt.path}`);
                    }
                }

                // Codex: config.toml (uses legacy template - not generic)
                if (extras.config && extras.config.enabled) {
                    const configPath = path.join(process.cwd(), extras.config.path);
                    let configContent = '';
                    if (fs.existsSync(configPath)) {
                        configContent = fs.readFileSync(configPath, 'utf8');
                    }
                    if (!configContent.includes('[_aigon]')) {
                        const ffConfig = fs.readFileSync(path.join(TEMPLATES_ROOT, 'cx/config.toml'), 'utf8');
                        if (configContent.length > 0 && !configContent.endsWith('\n')) {
                            configContent += '\n';
                        }
                        configContent += '\n' + ffConfig;
                        safeWrite(configPath, configContent);
                        console.log(`   ✅ Created: ${extras.config.path}`);
                    } else {
                        console.log(`   ℹ️  ${extras.config.path} already has Aigon settings`);
                    }
                }
            });

            const agentNames = uniqueAgents.map(a => {
                const cfg = loadAgentConfig(a);
                return cfg ? cfg.name : a;
            }).join(', ');
            console.log(`\n🎉 Installed Aigon for: ${agentNames}`);
            showPortSummary();

            // Ensure .aigon/.board-map.json is in .gitignore
            ensureBoardMapInGitignore();

            // Update installed version
            const currentVersion = getAigonVersion();
            if (currentVersion) {
                setInstalledVersion(currentVersion);
            }

            // Git commit suggestion - only if there are actual changes
            try {
                const gitStatus = execSync('git status --porcelain docs/ AGENTS.md CLAUDE.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null', { encoding: 'utf8' });
                if (gitStatus.trim()) {
                    console.log(`\n📝 To commit these changes:`);
                    console.log(`   git add docs/ AGENTS.md CLAUDE.md .claude/ .cursor/ .codex/ .gemini/ 2>/dev/null; git commit -m "chore: install Aigon v${currentVersion || 'latest'}"`);
                }
            } catch (e) {
                // Not a git repo or git not available - skip suggestion
            }

        } catch (e) {
            console.error(`❌ Failed: ${e.message}`);
        }
    },
    'check-version': (args = []) => {
        const currentVersion = getAigonVersion();
        const installedVersion = getInstalledVersion();

        if (!currentVersion) {
            console.error('❌ Could not determine Aigon CLI version');
            process.exit(1);
        }

        if (!installedVersion || compareVersions(currentVersion, installedVersion) !== 0) {
            const from = installedVersion || 'unknown';
            console.log(`🔄 Aigon version mismatch (project: ${from}, CLI: ${currentVersion}). Updating...`);
            commands['update'](args);
        } else {
            console.log(`✅ Aigon is up to date (v${currentVersion})`);
        }
    },
    'update': (args = []) => {
        const currentVersion = getAigonVersion();
        const installedVersion = getInstalledVersion();

        console.log("🔄 Updating Aigon installation...");
        if (installedVersion && currentVersion) {
            console.log(`   ${installedVersion} → ${currentVersion}`);
        } else if (currentVersion) {
            console.log(`   Installing version ${currentVersion}`);
        }
        console.log();

        // Show changelog entries since last installed version
        if (installedVersion && currentVersion && compareVersions(currentVersion, installedVersion) > 0) {
            const entries = getChangelogEntriesSince(installedVersion);
            if (entries.length > 0) {
                console.log(`📋 What's new since ${installedVersion}:\n`);
                entries.forEach(entry => {
                    console.log(`   ## ${entry.version}`);
                    // Show just the section headers and first items, not full body
                    const lines = entry.body.split('\n').filter(l => l.trim());
                    lines.slice(0, 6).forEach(line => {
                        console.log(`   ${line}`);
                    });
                    if (lines.length > 6) {
                        console.log(`   ... (${lines.length - 6} more lines)`);
                    }
                    console.log();
                });
            }
        }

        try {
            // Track changed files for summary
            const changes = { created: [], updated: [], unchanged: [] };
            const noCommit = args.includes('--no-commit');

            // 1. Detect installed agents from project artifacts
            const installedAgents = [];
            const legacyGeminiRootPath = path.join(process.cwd(), 'GEMINI.md');
            const legacyCodexPromptPath = path.join(process.cwd(), '.codex', 'prompt.md');
            getAvailableAgents().forEach(agentId => {
                const config = loadAgentConfig(agentId);
                if (!config) return;

                const docsAgentPath = config.agentFile
                    ? path.join(process.cwd(), 'docs', 'agents', config.agentFile)
                    : null;
                const localCommandDir = (config.output && !config.output.global && config.output.commandDir)
                    ? path.join(process.cwd(), config.output.commandDir)
                    : null;
                const rootFilePath = config.rootFile ? path.join(process.cwd(), config.rootFile) : null;
                const extras = config.extras || {};
                const settingsPath = extras.settings?.enabled ? path.join(process.cwd(), extras.settings.path) : null;
                const configPath = extras.config?.enabled ? path.join(process.cwd(), extras.config.path) : null;

                const isInstalled =
                    (rootFilePath && fs.existsSync(rootFilePath)) ||
                    (docsAgentPath && fs.existsSync(docsAgentPath)) ||
                    (localCommandDir && fs.existsSync(localCommandDir)) ||
                    (settingsPath && fs.existsSync(settingsPath)) ||
                    (configPath && fs.existsSync(configPath)) ||
                    (agentId === 'gg' && fs.existsSync(legacyGeminiRootPath)) ||
                    (agentId === 'cx' && fs.existsSync(legacyCodexPromptPath));

                if (isInstalled) {
                    installedAgents.push(agentId);
                }
            });

            const uniqueInstalledAgents = [...new Set(installedAgents)];

            // 1.5 Migration notices for legacy root files
            if (fs.existsSync(legacyGeminiRootPath) || fs.existsSync(legacyCodexPromptPath)) {
                console.log(`⚠️  Migration notice: AGENTS.md is now the shared root instruction file.`);
                if (fs.existsSync(legacyGeminiRootPath)) {
                    console.log(`   - Detected legacy GEMINI.md. New installs no longer generate this file.`);
                }
                if (fs.existsSync(legacyCodexPromptPath)) {
                    console.log(`   - Detected legacy .codex/prompt.md. New installs no longer generate this file.`);
                }
                console.log(`   - Legacy files are not auto-deleted. Review and remove them manually when ready.\n`);
            }

            // 2. Ensure spec folder structure exists (same as init)
            const createDirs = (root, folders) => {
                folders.forEach(f => {
                    const p = path.join(root, f);
                    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
                });
            };
            createDirs(PATHS.research.root, PATHS.research.folders);
            createDirs(PATHS.features.root, PATHS.features.folders);
            createDirs(PATHS.feedback.root, PATHS.feedback.folders);
            const featLogs = path.join(PATHS.features.root, 'logs');
            if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
            if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
            if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
            console.log(`✅ Verified: docs/specs directory structure`);

            // 3. Update shared workflow documentation
            const workflowPath = path.join(process.cwd(), 'docs', 'development_workflow.md');
            const workflowContent = readTemplate('docs/development_workflow.md');
            const workflowStatus = safeWriteWithStatus(workflowPath, workflowContent);
            changes[workflowStatus].push('docs/development_workflow.md');
            if (workflowStatus !== 'unchanged') {
                console.log(`✅ ${workflowStatus.charAt(0).toUpperCase() + workflowStatus.slice(1)}: docs/development_workflow.md`);
            }

            // 4. Install/update spec templates
            const specsTemplatesDir = path.join(process.cwd(), 'docs', 'specs', 'templates');
            if (!fs.existsSync(specsTemplatesDir)) {
                fs.mkdirSync(specsTemplatesDir, { recursive: true });
            }

            const featureTemplate = readTemplate('specs/feature-template.md');
            const featureStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'feature-template.md'), featureTemplate);
            changes[featureStatus].push('docs/specs/templates/feature-template.md');
            if (featureStatus !== 'unchanged') {
                console.log(`✅ ${featureStatus.charAt(0).toUpperCase() + featureStatus.slice(1)}: docs/specs/templates/feature-template.md`);
            }

            const researchTemplate = readTemplate('specs/research-template.md');
            const researchStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'research-template.md'), researchTemplate);
            changes[researchStatus].push('docs/specs/templates/research-template.md');
            if (researchStatus !== 'unchanged') {
                console.log(`✅ ${researchStatus.charAt(0).toUpperCase() + researchStatus.slice(1)}: docs/specs/templates/research-template.md`);
            }

            const feedbackTemplate = readTemplate('specs/feedback-template.md');
            const feedbackStatus = safeWriteWithStatus(path.join(specsTemplatesDir, 'feedback-template.md'), feedbackTemplate);
            changes[feedbackStatus].push('docs/specs/templates/feedback-template.md');
            if (feedbackStatus !== 'unchanged') {
                console.log(`✅ ${feedbackStatus.charAt(0).toUpperCase() + feedbackStatus.slice(1)}: docs/specs/templates/feedback-template.md`);
            }

            // 5. Re-run install-agent for detected agents
            if (uniqueInstalledAgents.length > 0) {
                console.log(`\n📦 Re-installing agents: ${uniqueInstalledAgents.join(', ')}`);
                commands['install-agent'](uniqueInstalledAgents);
            } else {
                console.log(`\nℹ️  No agents detected. Run 'aigon install-agent <cc|gg|cx|cu>' to install.`);
            }

            // 6. Update installed version
            if (currentVersion) {
                setInstalledVersion(currentVersion);
            }

            // Summary - version changed OR file changes means we updated
            const versionChanged = installedVersion && currentVersion && installedVersion !== currentVersion;
            let hasFileChanges = false;
            const aigonPaths = 'docs/ AGENTS.md CLAUDE.md .claude/ .cursor/ .codex/ .gemini/ .aigon/';
            try {
                const gitStatus = execSync(`git status --porcelain ${aigonPaths} 2>/dev/null`, { encoding: 'utf8' });
                hasFileChanges = gitStatus.trim().length > 0;
            } catch (e) {
                // Not a git repo - can't determine
            }

            if (versionChanged || hasFileChanges) {
                console.log(`\n✅ Aigon updated to v${currentVersion || 'unknown'}.`);
                showPortSummary();
                if (hasFileChanges) {
                    if (noCommit) {
                        console.log(`\n📝 To commit these changes:`);
                        console.log(`   git add ${aigonPaths} 2>/dev/null; git commit -m "chore: update Aigon to v${currentVersion || 'latest'}"`);
                    } else {
                        try {
                            execSync(`git add ${aigonPaths} 2>/dev/null`, { encoding: 'utf8' });
                            execSync(`git commit -m "chore: update Aigon to v${currentVersion || 'latest'}"`, { encoding: 'utf8' });
                            console.log(`\n📦 Committed Aigon update (v${currentVersion || 'latest'}).`);
                        } catch (e) {
                            console.log(`\n⚠️  Could not auto-commit: ${e.message}`);
                            console.log(`   git add ${aigonPaths} 2>/dev/null; git commit -m "chore: update Aigon to v${currentVersion || 'latest'}"`);
                        }
                    }
                }
            } else {
                console.log(`\n✅ Aigon is already up to date (v${currentVersion || 'unknown'}).`);
            }

        } catch (e) {
            console.error(`❌ Update failed: ${e.message}`);
        }
    },

    'hooks': (args) => {
        const subcommand = args[0] || 'list';

        if (subcommand === 'list') {
            const hooks = getDefinedHooks();

            if (hooks.length === 0) {
                console.log(`\n🪝 No hooks defined.`);
                console.log(`\n   Create hooks in: docs/aigon-hooks.md`);
                console.log(`\n   Example format:`);
                console.log(`   ## pre-feature-setup`);
                console.log(`   \`\`\`bash`);
                console.log(`   echo "Setting up feature $AIGON_FEATURE_ID in $AIGON_MODE mode"`);
                console.log(`   \`\`\``);
                return;
            }

            console.log(`\n🪝 Defined Hooks (${hooks.length}):\n`);

            // Group by command
            const byCommand = {};
            hooks.forEach(hook => {
                if (!byCommand[hook.command]) {
                    byCommand[hook.command] = [];
                }
                byCommand[hook.command].push(hook);
            });

            Object.entries(byCommand).forEach(([command, cmdHooks]) => {
                console.log(`   ${command}:`);
                cmdHooks.forEach(hook => {
                    const preview = hook.script.split('\n')[0].substring(0, 50);
                    console.log(`      ${hook.type}: ${preview}${hook.script.length > 50 ? '...' : ''}`);
                });
            });

            console.log(`\n   Hooks file: docs/aigon-hooks.md`);
        } else {
            console.error(`Unknown hooks subcommand: ${subcommand}`);
            console.error(`Usage: aigon hooks [list]`);
        }
    },

    'config': (args) => {
        const subcommand = args[0];

        if (subcommand === 'init') {
            const { scope } = parseConfigScope(args.slice(1));

            if (scope === 'global') {
                // Create global config file
                if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
                    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
                }

                if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
                    console.log(`ℹ️  Config already exists: ${GLOBAL_CONFIG_PATH}`);
                    console.log(`   Edit it to customize agent CLI commands.`);
                    return;
                }

                fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(DEFAULT_GLOBAL_CONFIG, null, 2));
                console.log(`✅ Created: ${GLOBAL_CONFIG_PATH}`);
                console.log(`\n   The config includes default "yolo mode" flags that auto-approve commands.`);
                console.log(`   To use stricter permissions, set implementFlag to "" (empty string) for any agent.`);
                console.log(`\n   You can customize:`);
                console.log(`   - terminal: Terminal to use (warp, code, cursor, terminal, tmux)`);
                console.log(`   - tmuxApp: Terminal app for tmux sessions (terminal, iterm2)`);
                console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                console.log(`   - agents.{id}.implementFlag: Override CLI flags (set to "" to require manual approval)`);
                console.log(`\n   Example (corporate/safer defaults - removes auto-approval flags):`);
                console.log(`   {`);
                console.log(`     "terminal": "warp",             // warp, code, cursor, terminal, tmux`);
                console.log(`     "tmuxApp": "iterm2",            // terminal (Terminal.app) or iterm2 (native tmux -CC)`);
                console.log(`     "agents": {`);
                console.log(`       "cc": { "cli": "claude", "implementFlag": "" },`);
                console.log(`       "cu": { "cli": "agent", "implementFlag": "" },`);
                console.log(`       "gg": { "cli": "gemini", "implementFlag": "" },`);
                console.log(`       "cx": { "cli": "codex", "implementFlag": "" }`);
                console.log(`     }`);
                console.log(`   }`);
                console.log(`\n   Default flags (can be overridden):`);
                console.log(`   - cc: --permission-mode acceptEdits`);
                console.log(`   - cu: --force`);
                console.log(`   - gg: --yolo`);
                console.log(`   - cx: (none; interactive by default, --full-auto is applied only in --autonomous mode)`);
            } else {
                // Create project config file with detected profile
                const detectedProfile = detectProjectProfile();
                const projectConfig = {
                    profile: detectedProfile
                };
                
                if (fs.existsSync(PROJECT_CONFIG_PATH)) {
                    console.log(`ℹ️  Config already exists: ${PROJECT_CONFIG_PATH}`);
                    console.log(`   Edit it to customize project settings.`);
                    return;
                }

                saveProjectConfig(projectConfig);
                console.log(`✅ Created: ${PROJECT_CONFIG_PATH}`);
                console.log(`\n   Profile: ${detectedProfile} (auto-detected)`);
                console.log(`\n   You can customize:`);
                console.log(`   - profile: Project profile (web, api, ios, android, library, generic)`);
                console.log(`   - fleet.testInstructions: Custom test instructions`);
                console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                console.log(`   - agents.{id}.implementFlag: Override CLI flags`);
                console.log(`\n💡 Run 'aigon update' to regenerate templates with the new profile.`);
            }
        } else if (subcommand === 'set') {
            const { scope, remainingArgs } = parseConfigScope(args.slice(1));
            
            if (remainingArgs.length < 2) {
                console.error(`Usage: aigon config set [--global|--project] <key> <value>`);
                console.error(`\n  --global   - Set in global config (~/.aigon/config.json)`);
                console.error(`  --project   - Set in project config (.aigon/config.json) [default]`);
                console.error(`\n  Examples:`);
                console.error(`    aigon config set profile web`);
                console.error(`    aigon config set --global terminal warp`);
                console.error(`    aigon config set fleet.testInstructions "run npm test"`);
                return;
            }
            
            const key = remainingArgs[0];
            const value = remainingArgs.slice(1).join(' '); // Join remaining args in case value has spaces
            
            // Try to parse as JSON if it looks like JSON, otherwise treat as string
            let parsedValue = value;
            if ((value.startsWith('{') && value.endsWith('}')) || 
                (value.startsWith('[') && value.endsWith(']'))) {
                try {
                    parsedValue = JSON.parse(value);
                } catch (e) {
                    // Not valid JSON, use as string
                }
            } else if (value === 'true') {
                parsedValue = true;
            } else if (value === 'false') {
                parsedValue = false;
            } else if (value === 'null') {
                parsedValue = null;
            } else if (/^-?\d+$/.test(value)) {
                parsedValue = parseInt(value, 10);
            } else if (/^-?\d+\.\d+$/.test(value)) {
                parsedValue = parseFloat(value);
            }
            
            if (scope === 'global') {
                const config = loadGlobalConfig();
                setNestedValue(config, key, parsedValue);
                saveGlobalConfig(config);
                console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
                console.log(`   Saved to: ${GLOBAL_CONFIG_PATH}`);
            } else {
                const config = loadProjectConfig();
                setNestedValue(config, key, parsedValue);
                saveProjectConfig(config);
                console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
                console.log(`   Saved to: ${PROJECT_CONFIG_PATH}`);
            }
        } else if (subcommand === 'get') {
            if (args.length < 2) {
                console.error(`Usage: aigon config get <key>`);
                console.error(`\n  Examples:`);
                console.error(`    aigon config get profile`);
                console.error(`    aigon config get terminal`);
                console.error(`    aigon config get fleet.testInstructions`);
                return;
            }
            
            const key = args[1];
            const result = getConfigValueWithProvenance(key);
            
            if (result.value === undefined) {
                console.log(`❌ Config key "${key}" not found`);
                return;
            }
            
            const valueStr = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
            let sourceStr;
            if (result.source === 'project') {
                sourceStr = `.aigon/config.json`;
            } else if (result.source === 'global') {
                sourceStr = `~/.aigon/config.json`;
            } else {
                sourceStr = `default`;
            }
            
            console.log(`${valueStr} (from ${sourceStr})`);
        } else if (subcommand === 'show') {
            // For 'show', check flags directly (don't default to project - default to merged)
            const hasGlobal = args.slice(1).includes('--global');
            const hasProject = args.slice(1).includes('--project');
            
            if (hasGlobal) {
                const config = loadGlobalConfig();
                console.log(`\n📋 Global Configuration (~/.aigon/config.json):\n`);
                console.log(JSON.stringify(config, null, 2));
                console.log(`\n   Config file: ${GLOBAL_CONFIG_PATH}`);
                console.log(`   Exists: ${fs.existsSync(GLOBAL_CONFIG_PATH) ? 'yes' : 'no (using defaults)'}`);
            } else if (hasProject) {
                const config = loadProjectConfig();
                console.log(`\n📋 Project Configuration (.aigon/config.json):\n`);
                if (Object.keys(config).length === 0) {
                    console.log(`   (empty - using auto-detection)`);
                } else {
                    console.log(JSON.stringify(config, null, 2));
                }
                console.log(`\n   Config file: ${PROJECT_CONFIG_PATH}`);
                console.log(`   Exists: ${fs.existsSync(PROJECT_CONFIG_PATH) ? 'yes' : 'no (using auto-detection)'}`);
            } else {
                // Show merged effective config (default for 'show')
                const effectiveConfig = getEffectiveConfig();
                
                console.log(`\n📋 Effective Configuration (merged from all levels):\n`);
                console.log(JSON.stringify(effectiveConfig, null, 2));
                console.log(`\n   Precedence: project > global > defaults`);
                console.log(`\n   Project config: ${PROJECT_CONFIG_PATH}`);
                console.log(`   ${fs.existsSync(PROJECT_CONFIG_PATH) ? '✅ exists' : '❌ not found (using auto-detection)'}`);
                console.log(`\n   Global config: ${GLOBAL_CONFIG_PATH}`);
                console.log(`   ${fs.existsSync(GLOBAL_CONFIG_PATH) ? '✅ exists' : '❌ not found (using defaults)'}`);
            }
        } else if (subcommand === 'models') {
            const agents = getAvailableAgents();
            const taskTypes = ['research', 'implement', 'evaluate'];
            // Agents without --model CLI flag support
            const noModelFlag = new Set(['cu']);

            const rows = [];
            for (const agentId of agents) {
                const agentConfig = loadAgentConfig(agentId);
                if (!agentConfig) continue;

                for (const taskType of taskTypes) {
                    const provenance = getModelProvenance(agentId, taskType);
                    let model, source;
                    if (noModelFlag.has(agentId)) {
                        model = '(n/a — no CLI flag)';
                        source = '-';
                    } else if (provenance.source === 'none') {
                        model = '(not set)';
                        source = '-';
                    } else {
                        model = provenance.value;
                        source = provenance.source;
                    }
                    rows.push({ agent: agentId, task: taskType, model, source });
                }
            }

            // Calculate column widths
            const colAgent = Math.max(5, ...rows.map(r => r.agent.length));
            const colTask = Math.max(10, ...rows.map(r => r.task.length));
            const colModel = Math.max(5, ...rows.map(r => r.model.length));
            const colSource = Math.max(6, ...rows.map(r => r.source.length));

            console.log(`\nModel Configuration (resolved):\n`);
            console.log(`  ${'AGENT'.padEnd(colAgent + 2)}${'TASK'.padEnd(colTask + 2)}${'MODEL'.padEnd(colModel + 2)}SOURCE`);
            console.log(`  ${'─'.repeat(colAgent)}  ${'─'.repeat(colTask)}  ${'─'.repeat(colModel)}  ${'─'.repeat(colSource)}`);

            for (const row of rows) {
                console.log(`  ${row.agent.padEnd(colAgent + 2)}${row.task.padEnd(colTask + 2)}${row.model.padEnd(colModel + 2)}${row.source}`);
            }

            console.log(`\n  Precedence: env var > project config > global config > template default`);
            console.log(`  Env var pattern: AIGON_{AGENT}_{TASK}_MODEL (e.g. AIGON_CC_RESEARCH_MODEL=haiku)`);
        } else {
            console.error(`Usage: aigon config <init|set|get|show|models>`);
            console.error(`\n  init [--global]     - Initialize config (project by default, --global for user-wide)`);
            console.error(`  set [--global] <key> <value>`);
            console.error(`                       - Set config value (project by default)`);
            console.error(`  get <key>           - Get config value with provenance`);
            console.error(`  show [--global|--project]`);
            console.error(`                       - Show config (merged by default, --global or --project for specific level)`);
            console.error(`  models              - Show resolved model configuration for all agents`);
            console.error(`\n  Examples:`);
            console.error(`    aigon config init                    # Create project config`);
            console.error(`    aigon config init --global           # Create global config`);
            console.error(`    aigon config set profile web        # Set project profile`);
            console.error(`    aigon config set --global terminal warp`);
            console.error(`    aigon config get profile             # Show value + source`);
            console.error(`    aigon config show                   # Show merged config`);
            console.error(`    aigon config show --project         # Show project config only`);
            console.error(`    aigon config models                 # Show model config for all agents`);
        }
    },

    'profile': (args) => {
        const subcommand = args[0] || 'show';

        if (subcommand === 'show') {
            const profile = getActiveProfile();
            const projectConfig = loadProjectConfig();
            console.log(`\n📋 Project Profile: ${profile.name}${profile.detected ? ' (auto-detected)' : ' (set in .aigon/config.json)'}`);
            console.log(`\n   Dev server: ${profile.devServer.enabled ? 'enabled' : 'disabled'}`);
            if (profile.devServer.enabled) {
                showPortSummary();
            }
            console.log(`\n   Test instructions:`);
            profile.testInstructions.split('\n').forEach(line => console.log(`     ${line}`));
            if (profile.depCheck) {
                console.log(`\n   Dependency check: yes`);
            }
            if (profile.setupEnvLine) {
                console.log(`   .env.local setup: yes`);
            }
            console.log(`\n   Config file: ${PROJECT_CONFIG_PATH}`);
            console.log(`   Exists: ${fs.existsSync(PROJECT_CONFIG_PATH) ? 'yes' : 'no (using auto-detection)'}`);
            if (Object.keys(projectConfig).length > 0) {
                console.log(`\n   Raw config:`);
                console.log(`   ${JSON.stringify(projectConfig, null, 2).split('\n').join('\n   ')}`);
            }
        } else if (subcommand === 'set') {
            const profileName = args[1];
            if (!profileName) {
                console.error(`Usage: aigon profile set <type>`);
                console.error(`\nAvailable profiles: ${Object.keys(PROFILE_PRESETS).join(', ')}`);
                return;
            }
            if (!PROFILE_PRESETS[profileName]) {
                console.error(`❌ Unknown profile: ${profileName}`);
                console.error(`Available profiles: ${Object.keys(PROFILE_PRESETS).join(', ')}`);
                return;
            }
            const projectConfig = loadProjectConfig();
            projectConfig.profile = profileName;
            saveProjectConfig(projectConfig);
            console.log(`✅ Profile set to: ${profileName}`);
            console.log(`   Saved to: ${PROJECT_CONFIG_PATH}`);
            console.log(`\n💡 Run 'aigon update' to regenerate templates with the new profile.`);
        } else if (subcommand === 'detect') {
            const detected = detectProjectProfile();
            console.log(`\n🔍 Auto-detected profile: ${detected}`);
            const preset = PROFILE_PRESETS[detected];
            console.log(`   Dev server: ${preset.devServer.enabled ? 'enabled' : 'disabled'}`);
            if (preset.devServer.enabled && Object.keys(preset.devServer.ports).length > 0) {
                console.log(`   Ports: ${Object.entries(preset.devServer.ports).map(([k, v]) => `${k}=${v}`).join(', ')}`);
            }
            const projectConfig = loadProjectConfig();
            if (projectConfig.profile) {
                console.log(`\n   ⚠️  Note: .aigon/config.json overrides detection with profile "${projectConfig.profile}"`);
            }
        } else {
            console.error(`Usage: aigon profile [show|set|detect]`);
            console.error(`\n  show    - Display current profile and settings`);
            console.error(`  set     - Set project profile (web, api, ios, android, library, generic)`);
            console.error(`  detect  - Show what auto-detection would choose`);
        }
    },

    'worktree-open': (args) => {
        // Parse arguments: collect feature IDs, flags, and optional agent code
        const featureIds = [];
        let agentCode = null;
        let terminalOverride = null;
        let allFlag = false;

        args.forEach(arg => {
            if (arg.startsWith('--terminal=')) {
                terminalOverride = arg.split('=')[1];
            } else if (arg.startsWith('-t=')) {
                terminalOverride = arg.split('=')[1];
            } else if (arg.startsWith('--agent=')) {
                agentCode = arg.split('=')[1];
            } else if (arg === '--all') {
                allFlag = true;
            } else if (/^\d+$/.test(arg)) {
                featureIds.push(arg);
            } else if (!arg.startsWith('-')) {
                // Legacy: positional agent code (e.g. `worktree-open 55 cc`)
                agentCode = arg;
            }
        });

        if (featureIds.length === 0) {
            console.error(`❌ Feature ID is required.\n`);
            console.error(`Usage:`);
            console.error(`  aigon worktree-open <ID> [agent]         Open single worktree`);
            console.error(`  aigon worktree-open <ID> --all           Open all Fleet worktrees side-by-side`);
            console.error(`  aigon worktree-open <ID> <ID>... [--agent=<code>]`);
            console.error(`                                           Open multiple features side-by-side`);
            return;
        }

        // Find all worktrees
        let allWorktrees;
        try {
            allWorktrees = findWorktrees();
        } catch (e) {
            return console.error(`❌ Could not list worktrees: ${e.message}`);
        }

        if (allWorktrees.length === 0) {
            return console.error(`❌ No worktrees found.\n\n   Create one with: aigon feature-setup <ID> <agent>`);
        }

        // Determine terminal (project config > global config > default)
        const effectiveConfig = getEffectiveConfig();
        const terminal = terminalOverride || effectiveConfig.terminal;

        // Determine mode
        if (featureIds.length > 1) {
            // --- PARALLEL MODE: multiple features side-by-side ---
            const worktreeConfigs = [];
            const errors = [];

            for (const fid of featureIds) {
                let matches = filterByFeatureId(allWorktrees, fid);

                if (agentCode) {
                    const agentMap = buildAgentAliasMap();
                    const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                    matches = matches.filter(wt => wt.agent === normalizedAgent);
                }

                if (matches.length === 0) {
                    errors.push(`Feature ${fid}: no worktree found${agentCode ? ` for agent ${agentCode}` : ''}`);
                } else if (matches.length > 1 && !agentCode) {
                    const agents = matches.map(wt => wt.agent).join(', ');
                    errors.push(`Feature ${fid}: multiple worktrees (${agents}). Use --agent=<code> to specify.`);
                } else {
                    // Pick first match (if --agent filtered, there's 1; otherwise exactly 1 exists)
                    const wt = matches[0];
                    worktreeConfigs.push({ ...wt, agentCommand: buildAgentCommand(wt) });
                }
            }

            if (errors.length > 0) {
                console.error(`❌ Cannot open parallel worktrees:\n`);
                errors.forEach(err => console.error(`   ${err}`));
                return;
            }

            const idsLabel = featureIds.join(', ');

            if (terminal === 'warp') {
                const configName = `parallel-features-${featureIds.join('-')}`;
                const title = `Parallel: Features ${idsLabel}`;

                try {
                    const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title);

                    console.log(`\n🚀 Opening ${worktreeConfigs.length} features side-by-side in Warp:`);
                    console.log(`   Features: ${idsLabel}\n`);
                    worktreeConfigs.forEach(wt => {
                        console.log(`   ${wt.featureId.padEnd(4)} ${wt.agent.padEnd(8)} → ${wt.path}`);
                    });
                    console.log(`\n   Warp config: ${configFile}`);
                } catch (e) {
                    console.error(`❌ Failed to open Warp: ${e.message}`);
                }
            } else if (terminal === 'tmux') {
                console.log(`\n🚀 Opening ${worktreeConfigs.length} features via tmux sessions:`);
                worktreeConfigs.forEach(wt => {
                    openSingleWorktree(wt, wt.agentCommand, terminal);
                });
            } else {
                console.log(`\n📋 Parallel worktrees for features ${idsLabel}:`);
                console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
                worktreeConfigs.forEach(wt => {
                    console.log(`   Feature ${wt.featureId} (${wt.agent}):`);
                    console.log(`     cd ${wt.path}`);
                    console.log(`     ${wt.agentCommand}\n`);
                });
            }
        } else if (allFlag) {
            // --- ARENA MODE: all agents for one feature side-by-side ---
            const featureId = featureIds[0];
            const paddedId = String(featureId).padStart(2, '0');
            let worktrees = filterByFeatureId(allWorktrees, featureId);

            if (worktrees.length === 0) {
                return console.error(`❌ No worktrees found for feature ${featureId}.\n\n   Create worktrees with: aigon feature-setup ${featureId} cc gg`);
            }

            if (worktrees.length < 2) {
                return console.error(`❌ Only 1 worktree found for feature ${featureId}. Use \`aigon worktree-open ${featureId}\` for single worktrees.\n\n   To add more agents: aigon feature-setup ${featureId} cc gg cx`);
            }

            // Sort by port offset order (cc=+1, gg=+2, cx=+3, cu=+4)
            const agentOrder = ['cc', 'gg', 'cx', 'cu'];
            worktrees.sort((a, b) => {
                const aIdx = agentOrder.indexOf(a.agent);
                const bIdx = agentOrder.indexOf(b.agent);
                return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
            });

            const profile = getActiveProfile();
            const worktreeConfigs = worktrees.map(wt => {
                const agentMeta = AGENT_CONFIGS[wt.agent] || {};
                const port = profile.devServer.enabled ? (profile.devServer.ports[wt.agent] || agentMeta.port) : null;
                const portLabel = port ? `🔌 ${agentMeta.name || wt.agent} — Port ${port}` : null;
                return {
                    ...wt,
                    agentCommand: buildAgentCommand(wt),
                    portLabel
                };
            });

            if (terminal === 'warp') {
                const configName = `arena-feature-${paddedId}`;
                const desc = worktreeConfigs[0].desc;
                const title = `Arena: Feature ${paddedId} - ${desc}`;

                try {
                    const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title, 'cyan');

                    console.log(`\n🚀 Opening ${worktreeConfigs.length} worktrees side-by-side in Warp:`);
                    console.log(`   Feature: ${paddedId} - ${desc}\n`);
                    worktreeConfigs.forEach(wt => {
                        console.log(`   ${wt.agent.padEnd(8)} → ${wt.path}`);
                    });
                    console.log(`\n   Warp config: ${configFile}`);
                } catch (e) {
                    console.error(`❌ Failed to open Warp: ${e.message}`);
                }
            } else if (terminal === 'tmux') {
                console.log(`\n🚀 Opening ${worktreeConfigs.length} Fleet worktrees via tmux sessions:`);
                worktreeConfigs.forEach(wt => {
                    openSingleWorktree(wt, wt.agentCommand, terminal);
                });
            } else {
                const desc = worktreeConfigs[0].desc;
                console.log(`\n📋 Fleet worktrees for feature ${paddedId} - ${desc}:`);
                console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
                worktreeConfigs.forEach(wt => {
                    console.log(`   ${wt.agent}:`);
                    console.log(`     cd ${wt.path}`);
                    console.log(`     ${wt.agentCommand}\n`);
                });
            }
        } else {
            // --- SINGLE MODE: open one worktree ---
            const featureId = featureIds[0];
            let worktrees = filterByFeatureId(allWorktrees, featureId);

            if (worktrees.length === 0) {
                return console.error(`❌ No worktrees found for feature ${featureId}`);
            }

            // Filter by agent if provided
            if (agentCode) {
                const agentMap = buildAgentAliasMap();
                const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                worktrees = worktrees.filter(wt => wt.agent === normalizedAgent);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktree found for feature ${featureId} with agent ${agentCode}`);
                }
            }

            // Select worktree: if multiple, pick most recently modified
            let selectedWt;
            if (worktrees.length === 1) {
                selectedWt = worktrees[0];
            } else {
                worktrees.sort((a, b) => b.mtime - a.mtime);
                selectedWt = worktrees[0];
                console.log(`ℹ️  Multiple worktrees found, opening most recent:`);
                worktrees.forEach((wt, i) => {
                    const marker = i === 0 ? '→' : ' ';
                    console.log(`   ${marker} ${wt.featureId}-${wt.agent}: ${wt.path}`);
                });
            }

            const agentCommand = buildAgentCommand(selectedWt);
            openSingleWorktree(selectedWt, agentCommand, terminal);
        }
    },

    'sessions-close': (args) => {
        const id = args.find(a => !a.startsWith('--'));

        if (!id) {
            console.error('Usage: aigon sessions-close <ID>');
            console.error('\n  aigon sessions-close 05   # Kill all agents, tmux sessions + close Warp tab for #05');
            return;
        }

        const paddedId = String(parseInt(id, 10)).padStart(2, '0');

        // Kill agent processes for this ID across all agent types and command types
        const killPatterns = [
            `aigon:feature-implement ${paddedId}`,
            `aigon:feature-review ${paddedId}`,
            `aigon:research-conduct ${paddedId}`,
        ];

        console.log(`\nClosing all agent sessions for #${paddedId}...\n`);

        let foundAny = false;
        killPatterns.forEach(pattern => {
            try {
                // SIGTERM (default) — graceful exit; agents flush buffers and close connections
                execSync(`pkill -f "${pattern}"`, { stdio: 'ignore' });
                foundAny = true;
                console.log(`   ✓ ${pattern}`);
            } catch (e) {
                // pkill exits 1 when no processes match — that's fine
            }
        });

        // Brief wait for processes to exit cleanly, then SIGKILL any stragglers
        if (foundAny) {
            try { execSync('sleep 1', { stdio: 'ignore' }); } catch (e) { /* ignore */ }
            killPatterns.forEach(pattern => {
                try {
                    execSync(`pkill -9 -f "${pattern}"`, { stdio: 'ignore' });
                } catch (e) {
                    // Already exited — this is the expected path
                }
            });
        }

        if (!foundAny) {
            console.log('   (no running agent processes found for this ID)');
        }

        // Kill tmux sessions for this feature ID
        let closedTmuxSessions = 0;
        try {
            const tmuxList = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
            if (!tmuxList.error && tmuxList.status === 0) {
                const targetIds = new Set([toUnpaddedId(paddedId), toUnpaddedId(id)]);
                const sessions = tmuxList.stdout
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean);
                sessions.forEach(sessionName => {
                    const match = sessionName.match(/^aigon-f(\d+)-/);
                    if (!match) return;
                    if (!targetIds.has(toUnpaddedId(match[1]))) return;

                    const kill = spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
                    if (!kill.error && kill.status === 0) {
                        closedTmuxSessions++;
                        console.log(`   ✓ tmux ${sessionName}`);
                    }
                });
            }
        } catch (e) {
            // No tmux server running or tmux not installed.
        }

        // Try to close the Warp arena tab/window
        const warpTitleHints = [
            `Arena Research: ${paddedId}`,
            `Arena: Feature ${paddedId}`,
        ];

        let warpClosed = false;
        for (const hint of warpTitleHints) {
            if (closeWarpWindow(hint)) {
                warpClosed = true;
            }
        }

        if (warpClosed) {
            console.log('\n✅ Warp Fleet tab closed.');
        } else {
            const tmuxSuffix = closedTmuxSessions > 0 ? ` Closed ${closedTmuxSessions} tmux session(s).` : '';
            console.log(`\n✅ Done. (Close the Warp tab manually if still open.)${tmuxSuffix}`);
        }
    },

    'doctor': (args) => {
        const doRegister = args.includes('--register');
        const registry = loadPortRegistry();
        const scanned = scanPortsFromFilesystem();

        // Merge: registry entries + discovered projects (dedup by path)
        const byPath = new Map();

        // Add registry entries first
        for (const [name, entry] of Object.entries(registry)) {
            byPath.set(entry.path, {
                name,
                basePort: entry.basePort,
                path: entry.path,
                registered: true
            });
        }

        // Add scanned entries (don't overwrite registered ones, but update port if different)
        for (const project of scanned) {
            if (byPath.has(project.path)) {
                const existing = byPath.get(project.path);
                existing.scanned = true;
                existing.source = project.source;
            } else {
                byPath.set(project.path, {
                    name: project.name,
                    basePort: project.basePort,
                    path: project.path,
                    registered: false,
                    scanned: true,
                    source: project.source
                });
            }
        }

        const allProjects = Array.from(byPath.values());

        // Register current project if --register
        if (doRegister) {
            const profile = getActiveProfile();
            if (profile.devServer.enabled) {
                const result = readBasePort();
                const basePort = result ? result.port : 3000;
                const name = path.basename(process.cwd());
                registerPort(name, basePort, process.cwd());
                console.log(`✅ Registered ${name} (port ${basePort}) in global port registry.`);

                // Refresh the data for display
                const updatedEntry = byPath.get(process.cwd());
                if (updatedEntry) {
                    updatedEntry.registered = true;
                } else {
                    allProjects.push({
                        name,
                        basePort,
                        path: process.cwd(),
                        registered: true,
                        scanned: true
                    });
                }
            } else {
                console.log(`ℹ️  Dev server not enabled for this project profile — nothing to register.`);
            }
        }

        if (allProjects.length === 0) {
            console.log('\nPort Health Check\n─────────────────');
            console.log('No projects with port configurations found.');
            return;
        }

        // Sort by port, then name
        allProjects.sort((a, b) => a.basePort - b.basePort || a.name.localeCompare(b.name));

        // Group by basePort to detect conflicts
        const portGroups = new Map();
        for (const project of allProjects) {
            const key = project.basePort;
            if (!portGroups.has(key)) portGroups.set(key, []);
            portGroups.get(key).push(project);
        }

        // Also check for overlapping ranges (each project uses base..base+4)
        const rangeConflicts = new Map(); // port -> [conflicting project names]
        const sortedProjects = [...allProjects];
        for (let i = 0; i < sortedProjects.length; i++) {
            for (let j = i + 1; j < sortedProjects.length; j++) {
                const a = sortedProjects[i];
                const b = sortedProjects[j];
                if (a.basePort === b.basePort) continue; // handled by portGroups
                if (Math.abs(a.basePort - b.basePort) < 5) {
                    const key = Math.min(a.basePort, b.basePort);
                    if (!rangeConflicts.has(key)) rangeConflicts.set(key, new Set());
                    rangeConflicts.get(key).add(a.name);
                    rangeConflicts.get(key).add(b.name);
                }
            }
        }

        // Display table
        const homedir = os.homedir();
        const shortenPath = (p) => p.startsWith(homedir) ? '~' + p.slice(homedir.length) : p;

        console.log('\nPort Health Check\n─────────────────');

        // Calculate column widths
        const maxNameLen = Math.max(4, ...allProjects.map(p => p.name.length));
        const maxPathLen = Math.max(4, ...allProjects.map(p => shortenPath(p.path).length));

        const header = `  ${'PORT'.padEnd(7)}${'REPO'.padEnd(maxNameLen + 2)}${'PATH'.padEnd(maxPathLen + 2)}REGISTERED`;
        console.log(header);

        let conflictCount = 0;
        let unregisteredCount = 0;

        for (const [port, projects] of [...portGroups.entries()].sort((a, b) => a[0] - b[0])) {
            const isConflict = projects.length > 1;
            if (isConflict) conflictCount++;

            for (const project of projects) {
                if (!project.registered) unregisteredCount++;
                const portStr = String(project.basePort).padEnd(7);
                const nameStr = project.name.padEnd(maxNameLen + 2);
                const pathStr = shortenPath(project.path).padEnd(maxPathLen + 2);
                const regStr = project.registered ? 'yes' : 'no';
                console.log(`  ${portStr}${nameStr}${pathStr}${regStr}`);
            }

            if (isConflict) {
                const names = projects.map(p => p.name).join(' and ');
                console.log(`         ⚠️  CONFLICT: ${names} both use port ${port}`);
            }

            // Check range overlaps for this port group's projects
            for (const project of projects) {
                for (const [, conflictNames] of rangeConflicts) {
                    if (conflictNames.has(project.name) && conflictNames.size > 1) {
                        // Only print range conflict once per group
                    }
                }
            }

            console.log('');
        }

        // Print range conflicts (different base ports but overlapping ranges)
        for (const [, names] of rangeConflicts) {
            const nameArr = [...names];
            const involved = allProjects.filter(p => nameArr.includes(p.name));
            const portsStr = involved.map(p => `${p.name}:${p.basePort}`).join(', ');
            console.log(`  ⚠️  RANGE OVERLAP: ${portsStr} — ranges within 5 of each other`);
            conflictCount++;
        }

        // Summary
        if (conflictCount > 0 || unregisteredCount > 0) {
            const parts = [];
            if (conflictCount > 0) parts.push(`${conflictCount} conflict${conflictCount === 1 ? '' : 's'} found`);
            if (unregisteredCount > 0) parts.push(`${unregisteredCount} unregistered project${unregisteredCount === 1 ? '' : 's'}`);
            console.log(parts.join('. ') + '.');
        } else {
            console.log('No conflicts found.');
        }

        if (unregisteredCount > 0 && !doRegister) {
            console.log(`💡 Run \`aigon doctor --register\` to register the current project.`);
        }

        // --- Model Checks ---
        console.log('\nModel Health Check\n──────────────────');
        const agents = getAvailableAgents();
        const noModelFlag = new Set(['cu']);
        let modelWarnings = 0;
        let modelInfos = 0;

        for (const agentId of agents) {
            const agentConfig = loadAgentConfig(agentId);
            if (!agentConfig) {
                console.log(`  ❌ ${agentId}: Agent template not found`);
                modelWarnings++;
                continue;
            }

            const hasModels = agentConfig.cli?.models && Object.keys(agentConfig.cli.models).length > 0;

            // Warn if Cursor has models configured (they won't be used)
            if (noModelFlag.has(agentId)) {
                const cliConfig = getAgentCliConfig(agentId);
                const configuredModels = Object.entries(cliConfig.models).filter(([, v]) => v);
                if (configuredModels.length > 0) {
                    console.log(`  ⚠️  ${agentId} (${agentConfig.name}): Models configured but CLI has no --model flag`);
                    modelWarnings++;
                } else {
                    console.log(`  ✅ ${agentId} (${agentConfig.name}): No model flag (expected)`);
                }
                continue;
            }

            if (!hasModels) {
                console.log(`  ℹ️  ${agentId} (${agentConfig.name}): No default models in template`);
                modelInfos++;
            } else {
                console.log(`  ✅ ${agentId} (${agentConfig.name}): Template models loaded`);
            }
        }

        console.log('');
        if (modelWarnings > 0) {
            console.log(`${modelWarnings} model warning${modelWarnings === 1 ? '' : 's'}.`);
        } else {
            console.log('No model issues found.');
        }
        console.log(`💡 Run \`aigon config models\` for full model configuration table.`);
    },

    'proxy-setup': async () => {
        console.log('\n🔧 Setting up local dev proxy (Caddy + dnsmasq)...\n');

        // Check for Homebrew
        try {
            execSync('brew --version', { stdio: 'pipe' });
        } catch (e) {
            console.error('❌ Homebrew is required. Install from https://brew.sh');
            return;
        }

        // Install/verify Caddy
        try {
            const version = execSync('caddy version', { stdio: 'pipe' }).toString().trim();
            console.log(`   ✅ Caddy installed: ${version}`);
        } catch (e) {
            console.log('   📦 Installing Caddy...');
            try {
                execSync('brew install caddy', { stdio: 'inherit' });
                console.log('   ✅ Caddy installed');
            } catch (e2) {
                console.error(`   ❌ Failed to install Caddy: ${e2.message}`);
                return;
            }
        }

        // Install/verify dnsmasq
        try {
            execSync('brew list dnsmasq', { stdio: 'pipe' });
            console.log('   ✅ dnsmasq installed');
        } catch (e) {
            console.log('   📦 Installing dnsmasq...');
            try {
                execSync('brew install dnsmasq', { stdio: 'inherit' });
                console.log('   ✅ dnsmasq installed');
            } catch (e2) {
                console.error(`   ❌ Failed to install dnsmasq: ${e2.message}`);
                return;
            }
        }

        // Configure dnsmasq for .test wildcard
        const brewPrefix = execSync('brew --prefix', { stdio: 'pipe' }).toString().trim();
        const dnsmasqConf = path.join(brewPrefix, 'etc', 'dnsmasq.conf');
        const testEntry = 'address=/.test/127.0.0.1';

        try {
            const confContent = fs.existsSync(dnsmasqConf) ? fs.readFileSync(dnsmasqConf, 'utf8') : '';
            if (!confContent.includes(testEntry)) {
                fs.appendFileSync(dnsmasqConf, `\n# Aigon dev proxy — resolve *.test to localhost\n${testEntry}\n`);
                console.log('   ✅ Configured dnsmasq for *.test → 127.0.0.1');
            } else {
                console.log('   ✅ dnsmasq already configured for *.test');
            }
        } catch (e) {
            console.error(`   ❌ Could not configure dnsmasq: ${e.message}`);
            return;
        }

        // Start dnsmasq service
        try {
            execSync('sudo brew services start dnsmasq', { stdio: 'inherit' });
            console.log('   ✅ dnsmasq service started');
        } catch (e) {
            console.warn(`   ⚠️  Could not start dnsmasq: ${e.message}`);
        }

        // Create /etc/resolver/test
        const resolverDir = '/etc/resolver';
        const resolverFile = path.join(resolverDir, 'test');
        try {
            if (fs.existsSync(resolverFile)) {
                console.log('   ✅ /etc/resolver/test already exists');
            } else {
                console.log('\n   📝 Creating /etc/resolver/test (requires sudo)...');
                execSync(`sudo mkdir -p ${resolverDir} && sudo bash -c 'echo "nameserver 127.0.0.1" > ${resolverFile}'`, { stdio: 'inherit' });
                console.log('   ✅ /etc/resolver/test created');
            }
        } catch (e) {
            console.error(`   ❌ Could not create resolver: ${e.message}`);
            console.error(`   Manual fix: sudo mkdir -p /etc/resolver && sudo bash -c 'echo "nameserver 127.0.0.1" > /etc/resolver/test'`);
        }

        // Write initial Caddyfile and configure Caddy via Homebrew service
        if (!fs.existsSync(DEV_PROXY_DIR)) {
            fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
        }
        const registry = loadProxyRegistry();
        const caddyfile = generateCaddyfile(registry);
        fs.writeFileSync(DEV_PROXY_CADDYFILE, caddyfile);

        // Symlink our Caddyfile to Homebrew's expected location
        const brewCaddyfile = path.join(brewPrefix, 'etc', 'Caddyfile');
        try {
            // Back up existing Caddyfile if it's not already our symlink
            if (fs.existsSync(brewCaddyfile)) {
                const stat = fs.lstatSync(brewCaddyfile);
                if (stat.isSymbolicLink()) {
                    const target = fs.readlinkSync(brewCaddyfile);
                    if (target === DEV_PROXY_CADDYFILE) {
                        console.log('   ✅ Caddyfile symlink already configured');
                    } else {
                        fs.unlinkSync(brewCaddyfile);
                        fs.symlinkSync(DEV_PROXY_CADDYFILE, brewCaddyfile);
                        console.log('   ✅ Caddyfile symlink updated');
                    }
                } else {
                    const backupPath = brewCaddyfile + '.bak';
                    fs.renameSync(brewCaddyfile, backupPath);
                    fs.symlinkSync(DEV_PROXY_CADDYFILE, brewCaddyfile);
                    console.log(`   ✅ Caddyfile symlinked (original backed up to ${backupPath})`);
                }
            } else {
                fs.symlinkSync(DEV_PROXY_CADDYFILE, brewCaddyfile);
                console.log('   ✅ Caddyfile symlinked');
            }
        } catch (e) {
            console.warn(`   ⚠️  Could not symlink Caddyfile: ${e.message}`);
            console.warn(`   Manual fix: ln -sf "${DEV_PROXY_CADDYFILE}" "${brewCaddyfile}"`);
        }

        // Start/restart Caddy via brew services as root (required for port 80)
        try {
            try { execSync('brew services stop caddy', { stdio: 'pipe' }); } catch (e) { /* not running */ }
            try { execSync('sudo brew services stop caddy', { stdio: 'pipe' }); } catch (e) { /* not running */ }
            execSync('sudo brew services start caddy', { stdio: 'inherit' });
            console.log('   ✅ Caddy service started (root, port 80)');
        } catch (e) {
            console.warn(`   ⚠️  Could not start Caddy service: ${e.message}`);
            console.warn('   Manual fix: sudo brew services start caddy');
        }

        // Verify
        console.log('\n   🔍 Verifying setup...');
        try {
            const result = execSync('dig +short test.test @127.0.0.1', { stdio: 'pipe' }).toString().trim();
            if (result === '127.0.0.1') {
                console.log('   ✅ DNS resolution working: *.test → 127.0.0.1');
            } else {
                console.warn(`   ⚠️  DNS returned "${result}" instead of "127.0.0.1"`);
                console.warn('   dnsmasq may need a restart: sudo brew services restart dnsmasq');
            }
        } catch (e) {
            console.warn('   ⚠️  Could not verify DNS (dig command failed)');
            console.warn('   Try: dig +short anything.test @127.0.0.1');
        }

        console.log('\n✅ Dev proxy setup complete!');
        console.log('   All *.test domains now resolve to localhost.');
        console.log('   Use `aigon dev-server start` in any project to register a dev server.\n');
    },

    'dev-server': async (args) => {
        const subcommand = args[0];

        if (subcommand === 'start') {
            const registerOnly = args.includes('--register-only');
            const autoOpen = args.includes('--open');
            const context = detectDevServerContext();
            const proxyAvailable = isProxyAvailable();
            const projectConfig = loadProjectConfig();
            const profile = getActiveProfile();

            // Determine preferred port
            const devProxy = projectConfig.devProxy || {};
            const basePort = devProxy.basePort || 3000;
            const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
            const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;

            // Check for explicit --port flag
            const portFlagIdx = args.indexOf('--port');
            let preferredPort;
            if (portFlagIdx !== -1 && args[portFlagIdx + 1]) {
                preferredPort = parseInt(args[portFlagIdx + 1], 10);
            } else {
                preferredPort = basePort + offset;
            }

            // Allocate port
            let port;
            try {
                port = await allocatePort(preferredPort);
            } catch (e) {
                console.error(`❌ ${e.message}`);
                return;
            }

            // Write PORT to .env.local
            const envLocalPath = path.join(process.cwd(), '.env.local');
            let envContent = '';
            if (fs.existsSync(envLocalPath)) {
                envContent = fs.readFileSync(envLocalPath, 'utf8');
                // Replace existing PORT line
                if (envContent.match(/^PORT=\d+/m)) {
                    envContent = envContent.replace(/^PORT=\d+/m, `PORT=${port}`);
                } else {
                    envContent = envContent.trimEnd() + `\nPORT=${port}\n`;
                }
            } else {
                envContent = `PORT=${port}\n`;
            }
            fs.writeFileSync(envLocalPath, envContent);

            const startCmd = devProxy.command || 'npm run dev';
            const useProxy = proxyAvailable && profile.devServer && profile.devServer.enabled;
            const url = useProxy ? getDevProxyUrl(context.appId, context.serverId) : `http://localhost:${port}`;
            const logPath = getDevServerLogPath(context.appId, context.serverId);
            const healthCheckPath = devProxy.healthCheck || '/';
            const healthUrl = `http://localhost:${port}${healthCheckPath}`;

            if (useProxy) {
                // Register with proxy (PID 0 for now, updated after spawn)
                registerDevServer(context.appId, context.serverId, port, process.cwd(), 0);
            }

            if (!registerOnly) {
                // Spawn the dev server process
                console.log(`\n⏳ Starting dev server: ${startCmd}`);
                const pid = spawnDevServer(startCmd, port, logPath, process.cwd());

                // Update registry with real PID
                if (useProxy) {
                    registerDevServer(context.appId, context.serverId, port, process.cwd(), pid);
                }

                // Wait for health check
                process.stdout.write(`   Waiting for server on port ${port}...`);
                const healthy = await waitForHealthy(healthUrl);

                if (healthy) {
                    console.log(' ready!');
                    if (autoOpen) {
                        openInBrowser(url);
                    }
                } else {
                    console.log(' (timeout — server may still be starting)');
                    console.log(`   Check logs: aigon dev-server logs`);
                }

                if (useProxy) {
                    console.log(`\n🌐 Dev server running`);
                    console.log(`   URL:  ${url}`);
                    console.log(`   Port: ${port}  PID: ${pid}`);
                    if (context.serverId) {
                        console.log(`   ID:   ${context.serverId} (${context.appId})`);
                    }
                    console.log(`   Logs: aigon dev-server logs`);
                    console.log(`\n   Open: ${url}\n`);
                } else {
                    console.log(`\n📡 Dev server running`);
                    console.log(`   URL:  ${url}`);
                    console.log(`   Port: ${port}  PID: ${pid}`);
                    if (!proxyAvailable) {
                        console.log(`\n   💡 Run \`aigon proxy-setup\` for subdomain routing (e.g., ${getDevProxyUrl(context.appId, context.serverId)})`);
                    }
                    console.log(`   Logs: aigon dev-server logs`);
                    console.log(`\n   Open: ${url}\n`);
                }
            } else {
                // Register-only mode (manual process management)
                if (useProxy) {
                    console.log(`\n🌐 Dev server registered with proxy`);
                    console.log(`   URL:  ${url}`);
                    console.log(`   Port: ${port}`);
                    if (context.serverId) {
                        console.log(`   ID:   ${context.serverId} (${context.appId})`);
                    }
                    console.log(`\n   Start your dev server: PORT=${port} ${startCmd}`);
                    console.log(`   Then open: ${url}\n`);
                } else {
                    console.log(`\n📡 Dev server configured`);
                    console.log(`   Port: ${port}`);
                    console.log(`   URL:  ${url}`);
                    if (!proxyAvailable) {
                        console.log(`\n   💡 Run \`aigon proxy-setup\` for subdomain routing (e.g., ${getDevProxyUrl(context.appId, context.serverId)})`);
                    }
                    console.log(`\n   Start your dev server: PORT=${port} ${startCmd}\n`);
                }
            }

        } else if (subcommand === 'stop') {
            const serverId = args[1];
            const context = detectDevServerContext();
            const targetServerId = serverId || context.serverId;
            const appId = context.appId;

            if (!targetServerId && targetServerId !== '') {
                console.error('❌ Could not detect server ID. Specify it: aigon dev-server stop <serverId>');
                console.error('   Run `aigon dev-server list` to see active servers.');
                return;
            }

            // Kill the process if it's running
            const registry = loadProxyRegistry();
            const serverEntry = registry[appId] && registry[appId][targetServerId];
            if (serverEntry && serverEntry.pid > 0) {
                try {
                    // Kill the process group (negative PID kills the group)
                    process.kill(-serverEntry.pid, 'SIGTERM');
                    console.log(`   Stopped process (PID ${serverEntry.pid})`);
                } catch (e) {
                    if (e.code !== 'ESRCH') {
                        // ESRCH = process doesn't exist, which is fine
                        try { process.kill(serverEntry.pid, 'SIGTERM'); } catch (e2) { /* ignore */ }
                    }
                }
            }

            deregisterDevServer(appId, targetServerId);
            const hostname = targetServerId ? `${targetServerId}.${appId}.test` : `${appId}.test`;
            console.log(`✅ Stopped and deregistered ${hostname}`);

        } else if (subcommand === 'list') {
            const registry = loadProxyRegistry();
            const hasEntries = Object.keys(registry).length > 0 &&
                Object.values(registry).some(servers => Object.keys(servers).length > 0);

            if (!hasEntries) {
                console.log('\nNo active dev servers.\n');
                console.log('   Start one: aigon dev-server start');
                return;
            }

            console.log('\n   APP            SERVER      PORT   URL                              PID');
            console.log('   ' + '─'.repeat(75));
            for (const [appId, servers] of Object.entries(registry)) {
                for (const [serverId, info] of Object.entries(servers)) {
                    const url = getDevProxyUrl(appId, serverId);
                    const pidStr = info.pid ? String(info.pid) : '-';
                    // Check if PID is alive
                    let alive = false;
                    if (info.pid > 0) {
                        try { process.kill(info.pid, 0); alive = true; } catch (e) { /* dead */ }
                    }
                    const status = alive ? '' : ' (dead)';
                    console.log(`   ${appId.padEnd(15)} ${(serverId || '(main)').padEnd(11)} ${String(info.port).padEnd(6)} ${url.padEnd(36)} ${pidStr}${status}`);
                }
            }
            console.log('');

        } else if (subcommand === 'gc') {
            const removed = gcDevServers();
            if (removed > 0) {
                console.log(`✅ Removed ${removed} dead server${removed === 1 ? '' : 's'} from registry`);
            } else {
                console.log('No dead servers found.');
            }

        } else if (subcommand === 'logs') {
            const serverId = args[1];
            const context = detectDevServerContext();
            const targetServerId = serverId || context.serverId;
            const appId = context.appId;
            const logPath = getDevServerLogPath(appId, targetServerId);

            if (!fs.existsSync(logPath)) {
                console.error(`No log file found at ${logPath}`);
                console.error('   The dev server may not have been started with `aigon dev-server start`.');
                return;
            }

            // Check for --follow / -f flag
            const follow = args.includes('--follow') || args.includes('-f');
            // Check for --tail / -n flag
            const tailIdx = args.indexOf('--tail');
            const nIdx = args.indexOf('-n');
            const tailLines = tailIdx !== -1 ? parseInt(args[tailIdx + 1], 10) : (nIdx !== -1 ? parseInt(args[nIdx + 1], 10) : 50);

            if (follow) {
                // Use tail -f to follow logs (blocks until Ctrl+C)
                const { spawn: spawnFollow } = require('child_process');
                const tail = spawnFollow('tail', ['-f', '-n', String(tailLines), logPath], {
                    stdio: 'inherit'
                });
                tail.on('exit', () => process.exit(0));
                // Handle Ctrl+C gracefully
                process.on('SIGINT', () => { tail.kill(); process.exit(0); });
            } else {
                // Print last N lines
                const content = fs.readFileSync(logPath, 'utf8');
                const lines = content.split('\n');
                const start = Math.max(0, lines.length - tailLines);
                console.log(lines.slice(start).join('\n'));
            }

        } else if (subcommand === 'url') {
            const context = detectDevServerContext();
            const proxyAvailable = isProxyAvailable();

            if (proxyAvailable) {
                const url = getDevProxyUrl(context.appId, context.serverId);
                // Output just the URL for scripting
                console.log(url);
            } else {
                // Fallback: try to read port from .env.local
                const envLocalPath = path.join(process.cwd(), '.env.local');
                if (fs.existsSync(envLocalPath)) {
                    const content = fs.readFileSync(envLocalPath, 'utf8');
                    const match = content.match(/^PORT=(\d+)/m);
                    if (match) {
                        console.log(`http://localhost:${match[1]}`);
                        return;
                    }
                }
                // Use basePort + agent offset instead of hardcoded 3000
                const projectConfig = loadProjectConfig();
                const devProxy = projectConfig.devProxy || {};
                const basePort = devProxy.basePort || 3000;
                const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
                const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;
                console.log(`http://localhost:${basePort + offset}`);
            }

        } else if (subcommand === 'open') {
            const context = detectDevServerContext();
            const proxyAvailable = isProxyAvailable();

            let url;
            if (proxyAvailable) {
                url = getDevProxyUrl(context.appId, context.serverId);
            } else {
                const envLocalPath = path.join(process.cwd(), '.env.local');
                if (fs.existsSync(envLocalPath)) {
                    const content = fs.readFileSync(envLocalPath, 'utf8');
                    const match = content.match(/^PORT=(\d+)/m);
                    if (match) {
                        url = `http://localhost:${match[1]}`;
                    }
                }
                if (!url) {
                    const projectConfig = loadProjectConfig();
                    const devProxy = projectConfig.devProxy || {};
                    const basePort = devProxy.basePort || 3000;
                    const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
                    const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;
                    url = `http://localhost:${basePort + offset}`;
                }
            }

            console.log(`🌐 Opening ${url}`);
            openInBrowser(url);

        } else {
            console.error(`Usage: aigon dev-server <start|stop|list|logs|gc|url|open>`);
            console.error(`\n  start [--port N] [--open]  - Start dev server, register with proxy`);
            console.error(`  start --register-only      - Register port mapping only (don't start process)`);
            console.error(`  stop [serverId]            - Stop process and deregister from proxy`);
            console.error(`  open                       - Open dev server URL in default browser`);
            console.error(`  list                       - Show all active dev servers`);
            console.error(`  logs [-f] [-n N]           - Show dev server output (default: last 50 lines)`);
            console.error(`  gc                         - Remove entries for dead processes`);
            console.error(`  url                        - Print URL for current context (for scripting)`);
        }
    },

    'next': () => {
        console.log(`ℹ️  'aigon next' is an agent-only command.\n\nRun it inside your agent session:\n  /aigon:next\n\nOr use the short alias:\n  /an`);
    },

    'help': () => {
        console.log(`
Aigon - Spec-Driven Development for AI Agents

Usage: aigon <command> [arguments]

Setup:
  init                              Initialize ./docs/specs directory structure
  install-agent <agents...>         Install agent configs (cc, gg, cx, cu)
  update                            Update Aigon files to latest version
  hooks [list]                      List defined hooks (from docs/aigon-hooks.md)
  config <init|show|models>         Manage config and view model configuration
  profile [show|set|detect]         Manage project profile (web, api, ios, etc.)
  doctor [--register]               Check port assignments and model configuration
  proxy-setup                       One-time setup: install Caddy + dnsmasq for *.test domains

Dev Server (web/api profiles):
  dev-server start [--port N] [--open]  Start dev server, register with proxy, wait for healthy
  dev-server start --register-only  Register port mapping only (don't start process)
  dev-server stop [serverId]        Stop process and deregister from proxy
  dev-server open                   Open dev server URL in default browser
  dev-server list                   Show all active dev servers across all apps
  dev-server logs [-f] [-n N]       Show dev server output (default: last 50 lines, -f to follow)
  dev-server gc                     Remove entries for dead processes
  dev-server url                    Print URL for current context (for scripting)

Modes:
  🚗 Drive      One agent, you guide each stage
  🚛 Fleet      Multiple agents in parallel, you observe and guide
  ✈️  Autopilot  One agent runs autonomously end-to-end
  🐝 Swarm      Multiple agents run autonomously in parallel

Worktree:
  worktree-open <ID> [agent] [--terminal=<type>]
                                    Open worktree in terminal with agent CLI (warp, code, cursor, terminal, tmux)
  worktree-open <ID> --all          Open all Fleet worktrees side-by-side
  worktree-open <ID> <ID>... [--agent=<code>]
                                    Open multiple features side-by-side
  sessions-close <ID>               Kill all agent sessions for a feature/research ID and close Warp/tmux sessions

Feature Commands (Drive, Fleet, Autopilot, Swarm):
  feature-create <name>             Create feature spec in inbox
  feature-now <name>                Fast-track: inbox match → prioritise + setup + implement; or create new + implement
  feature-prioritise <name>         Move feature from inbox to backlog (assigns ID)
  feature-setup <ID> [agents...]    Setup for Drive (branch) or Fleet (worktrees)
  feature-implement <ID> [--agent=<id>] [--autonomous]  Implement feature; launches agent from shell, shows instructions inside agent session
  feature-validate <ID>             Evaluate acceptance criteria (smart validation)
  feature-eval <ID> [--force]       Create evaluation (code review or comparison)
  feature-done <ID> [agent]         Merge and complete feature
  feature-cleanup <ID>              Clean up Fleet worktrees and branches

Research Commands:
  research-create <name>            Create research topic in inbox
  research-prioritise <name>        Move research from inbox to backlog (assigns ID)
  research-setup <ID> [agents...]   Setup Drive (no agents) or Fleet (with agents) research
  research-open <ID>                Open all Fleet agents side-by-side for parallel research
  research-conduct <ID>             Conduct research (agent writes findings)
  research-done <ID> [--complete]   Complete research (shows summary in Fleet mode)

Feedback:
  feedback-create <title>           Create feedback doc in inbox (assigns next ID)
  feedback-list [filters...]        List feedback items by status/type/severity/tag
  feedback-triage <ID> [options]    Preview and apply triage updates (requires --apply --yes)

Deploy:
  deploy                            Run the configured deploy command (production)
  deploy --preview                  Run the configured preview command (staging)

Visualization:
  board                             Show Kanban board view of features and research
  board --list                      Show detailed list view (features and research)
  board --features                  Show only features
  board --research                  Show only research
  board --active                    Show only in-progress items
  board --all                       Include done items

Context-Aware:
  next                              (agent-only) Detect current context and suggest next workflow action

Examples:
  aigon init                           # Setup specs directory
  aigon install-agent cc gg            # Install Claude and Gemini configs

  # Feature workflow
  aigon feature-create "dark-mode"     # Create new feature spec
  aigon feature-now dark-mode          # Fast-track: inbox match or create new + implement
  aigon feature-prioritise dark-mode   # Assign ID, move to backlog
  aigon feature-setup 55               # Drive mode (creates branch)
  aigon feature-setup 55 cc gg cx cu      # Fleet mode (creates worktrees)
  aigon worktree-open 55 cc            # Open worktree in Warp with Claude CLI
  aigon worktree-open 55 --all         # Open all Fleet agents side-by-side
  aigon worktree-open 100 101 102      # Open features side-by-side (parallel)
  aigon sessions-close 55              # Kill all Fleet agents + tmux sessions + close Warp tab
  aigon feature-implement 55             # Launch default agent (cc) from plain shell
  aigon feature-implement 55 --agent=cx  # Launch Codex from plain shell
  aigon feature-implement 55 --autonomous               # Run Autopilot loop
  aigon feature-implement 55 --autonomous --max-iterations=8 --agent=cx  # Autopilot with options
  aigon feature-validate 55            # Evaluate acceptance criteria (smart validation)
  aigon feature-validate 55 --dry-run  # Show what would be checked without running
  aigon feature-eval 55                # Evaluate implementations
  aigon feature-done 55 cc             # Merge Claude's Fleet implementation
  aigon feature-cleanup 55 --push      # Clean up losing Fleet branches

  # Port health check
  aigon doctor                        # Show port assignments, flag conflicts
  aigon doctor --register             # Register current project in global registry

  # Dev proxy (web/api projects)
  aigon proxy-setup                   # One-time: install Caddy + dnsmasq
  aigon dev-server start              # Register dev server → http://cc-119.myapp.test
  aigon dev-server start --open       # Start and open browser automatically
  aigon dev-server open               # Open dev server URL in browser
  aigon dev-server list               # Show all running dev servers
  aigon dev-server stop               # Deregister current dev server
  BASE_URL=$(aigon dev-server url) npx playwright test  # E2E tests

  # Research workflow
  aigon research-create "api-design"   # Create new research topic
  aigon research-prioritise api-design # Assign ID, move to backlog
  aigon research-setup 05              # Drive mode (one agent)
  aigon research-setup 05 cc gg        # Fleet mode (multiple agents)
  aigon research-open 05               # Open all Fleet agents side-by-side
  aigon research-conduct 05            # Agent conducts research
  aigon research-done 05               # Shows findings summary (Fleet)
  aigon research-done 05 --complete    # Complete research

  # Deploy
  aigon deploy                         # Deploy to production (uses commands.deploy or scripts.deploy)
  aigon deploy --preview               # Deploy to staging/preview

  # Feedback workflow
  aigon feedback-create "Save fails"   # Create feedback in inbox
  aigon feedback-list --inbox          # List inbox feedback
  aigon feedback-list --all --tag auth # Filter by tag
  aigon feedback-triage 14             # Preview triage suggestions
  aigon feedback-triage 14 --type bug --severity high --tags auth,regression --apply --yes

Agents:
  cc (claude)   - Claude Code
  cu (cursor)   - Cursor
  gg (gemini)   - Gemini CLI
  cx (codex)    - OpenAI Codex
`);
    },
};

// --- Main Execution ---
const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^aigon-/, '') : null;

if (!cleanCommand || cleanCommand === 'help' || cleanCommand === '--help' || cleanCommand === '-h') {
    commands['help']();
} else if (commands[cleanCommand]) {
    const result = commands[cleanCommand](commandArgs);
    // Handle async commands (proxy-setup, dev-server)
    if (result && typeof result.catch === 'function') {
        result.catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
    }
} else {
    console.error(`Unknown command: ${commandName}\n`);
    commands['help']();
}
