'use strict';

// Leaf config file I/O — imports nothing from agent-registry, templates, proxy,
// instance-identity, or profile-placeholders.

const fs = require('fs');
const path = require('path');
const os = require('os');

const TERMINAL_CONFIG_MIGRATION_VERSION = '2.53.2';

function getAigonHome() {
    return process.env.AIGON_HOME || os.homedir();
}

function getGlobalConfigPath() {
    return path.resolve(process.env.GLOBAL_CONFIG_PATH || path.join(getAigonHome(), '.aigon', 'config.json'));
}

function getGlobalConfigDir() {
    return path.dirname(getGlobalConfigPath());
}

function getGlobalConfigBackupDir() {
    return path.join(getGlobalConfigDir(), 'backups');
}

function canonicalizeTerminalApp(value) {
    const raw = String(value || '').trim().toLowerCase();
    const aliases = {
        'apple-terminal': 'apple-terminal',
        terminal: 'apple-terminal',
        tmux: 'apple-terminal',
        warp: 'warp',
        kitty: 'kitty',
        ghostty: 'ghostty',
        alacritty: 'alacritty',
        wezterm: 'wezterm',
        iterm: 'iterm',
        'iterm2': 'iterm',
        hyper: 'hyper',
    };
    return aliases[raw] || (raw || null);
}

function migrateLegacyTerminalSettings(config) {
    if (!config || typeof config !== 'object') return config;
    const hasTerminalApp = Object.prototype.hasOwnProperty.call(config, 'terminalApp');
    const hasTmuxApp = Object.prototype.hasOwnProperty.call(config, 'tmuxApp');
    const hasTerminal = Object.prototype.hasOwnProperty.call(config, 'terminal');
    const terminalIsLegacyString = hasTerminal && typeof config.terminal === 'string';

    if (hasTerminalApp) {
        const canonical = canonicalizeTerminalApp(config.terminalApp);
        if (canonical) config.terminalApp = canonical;
        delete config.tmuxApp;
        if (terminalIsLegacyString) delete config.terminal;
        return config;
    }
    if (terminalIsLegacyString && hasTmuxApp) {
        const canonical = canonicalizeTerminalApp(config.tmuxApp);
        if (canonical) config.terminalApp = canonical;
        delete config.tmuxApp;
        delete config.terminal;
        return config;
    }
    if (terminalIsLegacyString) {
        const mapped = canonicalizeTerminalApp(config.terminal);
        if (mapped) config.terminalApp = mapped;
        delete config.terminal;
        delete config.tmuxApp;
        return config;
    }
    if (hasTmuxApp) {
        const canonical = canonicalizeTerminalApp(config.tmuxApp);
        if (canonical) config.terminalApp = canonical;
        delete config.tmuxApp;
    }
    return config;
}

const GLOBAL_CONFIG_PATH = getGlobalConfigPath();
const GLOBAL_CONFIG_DIR = getGlobalConfigDir();
const GLOBAL_CONFIG_BACKUP_DIR = getGlobalConfigBackupDir();
const GLOBAL_CONFIG_BACKUP_LATEST_PATH = path.join(GLOBAL_CONFIG_BACKUP_DIR, 'config.latest.json');
const PROJECT_CONFIG_REL = path.join('.aigon', 'config.json');
const GLOBAL_CONFIG_BACKUP_LIMIT = 10;
const DASHBOARD_DEFAULT_PORT = 4100;
const DASHBOARD_DYNAMIC_PORT_START = 4101;
const DASHBOARD_DYNAMIC_PORT_END = 4199;
const DASHBOARD_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'dashboard.log');
const ACTION_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'action-logs.jsonl');

const DEFAULT_SECURITY_CONFIG = {
    enabled: true,
    mode: 'enforce',
    stages: ['pre-commit'],
    scanners: ['env-local-blocker'],
    mergeGateStages: {
        featureClose: ['gitleaks', 'semgrep'],
        featureSubmit: ['gitleaks'],
        researchClose: ['gitleaks'],
    },
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
    if (base.mergeGateStages || overrides.mergeGateStages) {
        merged.mergeGateStages = {
            ...DEFAULT_SECURITY_CONFIG.mergeGateStages,
            ...(base.mergeGateStages || {}),
            ...(overrides.mergeGateStages || {}),
        };
    }
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

function buildDefaultGlobalConfigBase() {
    return {
        schemaVersion: TERMINAL_CONFIG_MIGRATION_VERSION,
        terminalApp: process.platform === 'darwin' ? 'apple-terminal' : null,
        linuxTerminal: null,
        terminal: { focusOnLaunch: 'background' },
        backgroundAgents: false,
        defaultAgent: 'cc',
        aiAttributionDomain: 'aigon.build',
        agents: {},
        security: { ...DEFAULT_SECURITY_CONFIG },
        recovery: { autoRestart: true, maxRetries: 2 },
        agentFailover: {
            policy: 'notify',
            chain: [],
            tokenLimits: { perSessionBillableTokens: null },
        },
        tokenWindow: {
            timezone: null,
            targetAgents: [],
            message: 'Checking in to align token window',
        },
        quota: {
            pollIntervalSeconds: 1800,
            maxBackoffSeconds: 3600,
            authFailureBackoffSeconds: 21600,
        },
        quotaPolicy: { mode: 'pause-and-wait' },
        autoNudge: {
            enabled: true,
            idleVisibleSec: 60,
            idleAutoNudgeSec: 180,
            idleEscalateSec: 300,
            perAgent: {},
        },
        transcripts: {
            tmux: false,
            tmuxMaxBytes: 104857600,
            tmuxMaxFiles: 3,
        },
    };
}

function getProjectConfigPath(repoPath = process.cwd()) {
    return path.join(path.resolve(repoPath), PROJECT_CONFIG_REL);
}

function normalizeMachineId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw
        .replace(/\.local$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function getDefaultMachineId() {
    return normalizeMachineId(os.hostname()) || 'unknown-machine';
}

let warnedLegacyTerminalKeys = false;
let warnedLegacyTerminalEnv = false;

function resolveCompatTerminalApp(config = {}) {
    const compat = { ...config };
    migrateLegacyTerminalSettings(compat);
    return canonicalizeTerminalApp(compat.terminalApp)
        || (process.platform === 'darwin' ? 'apple-terminal' : null);
}

function loadGlobalConfig(options = {}) {
    const defaultGlobalConfig = {
        ...buildDefaultGlobalConfigBase(),
        ...(typeof options.mergeDefaults === 'object' ? options.mergeDefaults : {}),
    };
    let userConfig = {};
    const configExists = fs.existsSync(GLOBAL_CONFIG_PATH);

    if (configExists) {
        try {
            const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8').trim();
            if (!raw || raw === '{}' || raw === 'null' || raw === 'undefined') {
                if (fs.existsSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH)) {
                    try {
                        const backup = fs.readFileSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH, 'utf8');
                        const parsed = JSON.parse(backup);
                        if (parsed && typeof parsed === 'object' && (parsed.repos || parsed.agents || parsed.terminalApp || parsed.tmuxApp || parsed.terminal)) {
                            fs.writeFileSync(GLOBAL_CONFIG_PATH, backup);
                            userConfig = parsed;
                            console.warn('⚠️  Global config was corrupt — restored from backup');
                        }
                    } catch (_) { /* ignore */ }
                }
            } else {
                userConfig = JSON.parse(raw);
            }
        } catch (e) {
            console.warn(`⚠️  Could not parse ~/.aigon/config.json: ${e.message}`);
            if (fs.existsSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH)) {
                try {
                    const backup = fs.readFileSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH, 'utf8');
                    const parsed = JSON.parse(backup);
                    if (parsed && typeof parsed === 'object') {
                        fs.writeFileSync(GLOBAL_CONFIG_PATH, backup);
                        userConfig = parsed;
                        console.warn('   Restored from backup: config.latest.json');
                    }
                } catch (_) { /* ignore */ }
            }
        }
    }

    if (!configExists) {
        const result = {};
        const envTerminalApp = process.env.AIGON_TERMINAL_APP || process.env.AIGON_TERMINAL;
        if (envTerminalApp) {
            result.terminalApp = canonicalizeTerminalApp(envTerminalApp) || envTerminalApp;
        }
        return result;
    }

    const compatTerminalApp = resolveCompatTerminalApp(userConfig);
    if (!Object.prototype.hasOwnProperty.call(userConfig, 'terminalApp')
        && (Object.prototype.hasOwnProperty.call(userConfig, 'tmuxApp') || Object.prototype.hasOwnProperty.call(userConfig, 'terminal'))
        && !warnedLegacyTerminalKeys) {
        warnedLegacyTerminalKeys = true;
        console.warn('⚠️  ~/.aigon/config.json still uses legacy terminal keys. Run `aigon check-version` to migrate to "terminalApp".');
    }

    const merged = { ...defaultGlobalConfig };
    if (compatTerminalApp) merged.terminalApp = compatTerminalApp;
    if (userConfig.agents) {
        merged.agents = { ...defaultGlobalConfig.agents };
        Object.entries(userConfig.agents).forEach(([key, value]) => {
            merged.agents[key] = { ...merged.agents[key], ...value };
        });
    }
    if (userConfig.security && typeof userConfig.security === 'object' && !Array.isArray(userConfig.security)) {
        merged.security = mergeSecurityConfig({}, userConfig.security);
    }
    Object.keys(userConfig).forEach(key => {
        if (key === 'tmuxApp' || key === 'terminalApp' || key === 'agents' || key === 'security') return;
        if (key === 'terminal') {
            if (userConfig.terminal && typeof userConfig.terminal === 'object' && !Array.isArray(userConfig.terminal)) {
                merged.terminal = { ...(merged.terminal || {}), ...userConfig.terminal };
            }
            return;
        }
        merged[key] = userConfig[key];
    });

    if (process.env.AIGON_TERMINAL) {
        if (!warnedLegacyTerminalEnv) {
            warnedLegacyTerminalEnv = true;
            console.warn('⚠️  AIGON_TERMINAL is deprecated. Use AIGON_TERMINAL_APP instead.');
        }
        merged.terminalApp = canonicalizeTerminalApp(process.env.AIGON_TERMINAL) || process.env.AIGON_TERMINAL;
    }
    if (process.env.AIGON_TERMINAL_APP) {
        merged.terminalApp = canonicalizeTerminalApp(process.env.AIGON_TERMINAL_APP) || process.env.AIGON_TERMINAL_APP;
    }

    return merged;
}

const _forceProWarnedPaths = new Set();

function loadProjectConfig(repoPath = process.cwd()) {
    const projectConfigPath = getProjectConfigPath(repoPath);
    if (!fs.existsSync(projectConfigPath)) return {};
    try {
        const parsed = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        if (Object.prototype.hasOwnProperty.call(parsed, 'forcePro') && !_forceProWarnedPaths.has(projectConfigPath)) {
            _forceProWarnedPaths.add(projectConfigPath);
            console.warn(`⚠️  ${projectConfigPath} contains "forcePro" — this key is no longer read. Use the AIGON_FORCE_PRO environment variable instead (e.g. AIGON_FORCE_PRO=false aigon server start).`);
        }
        return parsed;
    } catch (e) {
        console.warn(`⚠️  Could not parse .aigon/config.json: ${e.message}`);
        return {};
    }
}

function saveProjectConfig(config, repoPath = process.cwd()) {
    const filePath = getProjectConfigPath(repoPath);
    const content = JSON.stringify(config, null, 2) + '\n';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function safeBackupGlobalConfig() {
    if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return null;
    const existingContent = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8');
    fs.mkdirSync(GLOBAL_CONFIG_BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const datedBackupPath = path.join(GLOBAL_CONFIG_BACKUP_DIR, `config.${stamp}.json`);
    fs.writeFileSync(GLOBAL_CONFIG_BACKUP_LATEST_PATH, existingContent);
    fs.writeFileSync(datedBackupPath, existingContent);
    const backupFiles = fs.readdirSync(GLOBAL_CONFIG_BACKUP_DIR)
        .filter(name => /^config\.\d{4}-\d{2}-\d{2}T.*\.json$/.test(name))
        .sort()
        .reverse();
    backupFiles.slice(GLOBAL_CONFIG_BACKUP_LIMIT).forEach(name => {
        try {
            fs.rmSync(path.join(GLOBAL_CONFIG_BACKUP_DIR, name), { force: true });
        } catch (_) { /* ignore */ }
    });
    return datedBackupPath;
}

function saveGlobalConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('Refusing to save global config — value is not an object');
    }
    if (!config.repos && !config.agents && !config.terminalApp && !config.terminal) {
        throw new Error('Refusing to save global config — missing all expected keys (repos, agents, terminalApp). This looks like a bug. Backup at: ~/.aigon/backups/config.latest.json');
    }
    const content = JSON.stringify(config, null, 2) + '\n';
    fs.mkdirSync(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
    safeBackupGlobalConfig();
    fs.writeFileSync(GLOBAL_CONFIG_PATH, content);
}

function readConductorReposFromGlobalConfig() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
        const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return Array.isArray(cfg.repos) ? cfg.repos : [];
    } catch (_) {
        return [];
    }
}

function resolveConfigKeyAlias(keyPath) {
    const aliases = { fleet: 'arena', iterate: 'ralph', autonomous: 'ralph' };
    const parts = keyPath.split('.');
    if (aliases[parts[0]]) parts[0] = aliases[parts[0]];
    return parts.join('.');
}

function getNestedValue(obj, keyPath) {
    keyPath = resolveConfigKeyAlias(keyPath);
    const keys = keyPath.split('.');
    let current = obj;
    for (const key of keys) {
        if (current === null || current === undefined || typeof current !== 'object') return undefined;
        current = current[key];
    }
    return current;
}

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

function parseConfigScope(args) {
    const scopeIndex = args.indexOf('--global');
    if (scopeIndex !== -1) {
        return { scope: 'global', remainingArgs: args.filter((_, i) => i !== scopeIndex) };
    }
    const projectIndex = args.indexOf('--project');
    if (projectIndex !== -1) {
        return { scope: 'project', remainingArgs: args.filter((_, i) => i !== projectIndex) };
    }
    return { scope: 'project', remainingArgs: args };
}

function getConfigModelValue(config, agentId, taskType) {
    if (!config || !config.agents || !config.agents[agentId]) return undefined;
    const agentConfig = config.agents[agentId];
    if (agentConfig[taskType] && agentConfig[taskType].model) {
        return agentConfig[taskType].model;
    }
    if (agentConfig.models && agentConfig.models[taskType]) {
        return agentConfig.models[taskType];
    }
    return undefined;
}

function getAttributionDomain(repoPath = process.cwd()) {
    const projectConfig = loadProjectConfig(repoPath);
    const projectCandidate = String(projectConfig.aiAttributionDomain || '').trim().toLowerCase();
    if (projectCandidate) return projectCandidate;

    const globalConfig = loadGlobalConfig();
    const globalCandidate = String(globalConfig.aiAttributionDomain || '').trim().toLowerCase();
    return globalCandidate || buildDefaultGlobalConfigBase().aiAttributionDomain;
}

module.exports = {
    TERMINAL_CONFIG_MIGRATION_VERSION,
    PROJECT_CONFIG_REL,
    GLOBAL_CONFIG_DIR,
    GLOBAL_CONFIG_PATH,
    GLOBAL_CONFIG_BACKUP_DIR,
    GLOBAL_CONFIG_BACKUP_LATEST_PATH,
    GLOBAL_CONFIG_BACKUP_LIMIT,
    DASHBOARD_DEFAULT_PORT,
    DASHBOARD_DYNAMIC_PORT_START,
    DASHBOARD_DYNAMIC_PORT_END,
    DASHBOARD_LOG_FILE,
    ACTION_LOG_FILE,
    DEFAULT_SECURITY_CONFIG,
    mergeSecurityConfig,
    buildDefaultGlobalConfigBase,
    getProjectConfigPath,
    normalizeMachineId,
    getDefaultMachineId,
    loadGlobalConfig,
    loadProjectConfig,
    saveProjectConfig,
    saveGlobalConfig,
    safeBackupGlobalConfig,
    readConductorReposFromGlobalConfig,
    resolveConfigKeyAlias,
    getNestedValue,
    setNestedValue,
    parseConfigScope,
    getConfigModelValue,
    getAttributionDomain,
};
