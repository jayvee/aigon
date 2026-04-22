'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TERMINAL_CONFIG_MIGRATION_VERSION = '2.53.2';
const migrations = new Map();

function compareVersions(a, b) {
    const pa = String(a || '0.0.0').split('.').map(Number);
    const pb = String(b || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
}

function getGlobalConfigPath() {
    return path.resolve(process.env.GLOBAL_CONFIG_PATH || path.join(os.homedir(), '.aigon', 'config.json'));
}

function getGlobalConfigDir() {
    return path.dirname(getGlobalConfigPath());
}

function getGlobalConfigBackupDir() {
    return path.join(getGlobalConfigDir(), 'backups');
}

function getTimestampedBackupPath(fromVersion, timestamp = new Date()) {
    const stamp = timestamp.toISOString().replace(/[:.]/g, '-');
    return path.join(getGlobalConfigBackupDir(), `config-${fromVersion || '0.0.0'}-${stamp}.json`);
}

function canonicalizeTerminalApp(value) {
    if (value === 'terminal') return 'apple-terminal';
    if (value === 'warp' || value === 'iterm2' || value === 'apple-terminal') return value;
    return null;
}

function migrateLegacyTerminalSettings(config) {
    if (!config || typeof config !== 'object') return config;

    const hasTerminalApp = Object.prototype.hasOwnProperty.call(config, 'terminalApp');
    const hasTmuxApp = Object.prototype.hasOwnProperty.call(config, 'tmuxApp');
    const hasTerminal = Object.prototype.hasOwnProperty.call(config, 'terminal');

    if (hasTerminalApp) {
        const canonical = canonicalizeTerminalApp(config.terminalApp);
        if (canonical) config.terminalApp = canonical;
        delete config.tmuxApp;
        delete config.terminal;
        return config;
    }

    if (hasTerminal && hasTmuxApp) {
        const canonical = canonicalizeTerminalApp(config.tmuxApp);
        if (canonical) config.terminalApp = canonical;
        delete config.tmuxApp;
        delete config.terminal;
        return config;
    }

    if (hasTerminal) {
        const mapped = {
            warp: 'warp',
            terminal: 'apple-terminal',
            tmux: 'apple-terminal',
        }[config.terminal];
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

function registerGlobalConfigMigration(version, migrateFn) {
    if (migrations.has(version)) {
        throw new Error(`Global config migration already registered for version ${version}`);
    }
    migrations.set(version, { version, migrate: migrateFn });
}

function getRegisteredGlobalConfigMigrations() {
    return [...migrations.values()].sort((a, b) => compareVersions(a.version, b.version));
}

function readGlobalConfigFile() {
    const configPath = getGlobalConfigPath();
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
}

function writeGlobalConfigBackup(content, fromVersion) {
    const backupDir = getGlobalConfigBackupDir();
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = getTimestampedBackupPath(fromVersion);
    fs.writeFileSync(path.join(backupDir, 'config.latest.json'), content);
    fs.writeFileSync(backupPath, content);
    return backupPath;
}

async function runPendingGlobalConfigMigrations(fromVersion, options = {}) {
    const log = options.log || console.log;
    const configPath = getGlobalConfigPath();
    if (!fs.existsSync(configPath)) {
        return { applied: [], skipped: true, configPath, backupPath: null };
    }

    const rawContent = fs.readFileSync(configPath, 'utf8');
    const parsed = rawContent.trim() ? JSON.parse(rawContent) : {};
    const config = parsed && typeof parsed === 'object' ? parsed : {};
    const schemaVersion = typeof config.schemaVersion === 'string' ? config.schemaVersion : '0.0.0';
    const baseline = compareVersions(schemaVersion, fromVersion || '0.0.0') > 0 ? schemaVersion : (fromVersion || '0.0.0');
    const pending = getRegisteredGlobalConfigMigrations().filter(({ version }) => compareVersions(version, baseline) > 0);

    if (pending.length === 0) {
        return { applied: [], skipped: true, configPath, backupPath: null, config };
    }

    const backupPath = writeGlobalConfigBackup(rawContent, baseline);

    try {
        for (const migration of pending) {
            const maybeNext = await migration.migrate({ config, log, backupPath });
            if (maybeNext && typeof maybeNext === 'object' && maybeNext !== config) {
                Object.keys(config).forEach(key => delete config[key]);
                Object.assign(config, maybeNext);
            }
        }
    } catch (error) {
        throw new Error(`Global config migration failed. Backup preserved at ${backupPath}. Run \`aigon doctor\`. ${error.message}`);
    }

    const latestVersion = pending[pending.length - 1].version;
    config.schemaVersion = latestVersion;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return { applied: pending.map(m => m.version), skipped: false, configPath, backupPath, config };
}

registerGlobalConfigMigration(TERMINAL_CONFIG_MIGRATION_VERSION, ({ config, log, backupPath }) => {
    const before = JSON.stringify(config);
    migrateLegacyTerminalSettings(config);
    const terminalApp = config.terminalApp || (process.platform === 'darwin' ? 'apple-terminal' : null);
    if (terminalApp && JSON.stringify(config) !== before) {
        log(`🔄 Config migrated: unified terminal settings -> terminalApp=${terminalApp}. Backup: ${backupPath}`);
    }
    return config;
});

module.exports = {
    TERMINAL_CONFIG_MIGRATION_VERSION,
    registerGlobalConfigMigration,
    getRegisteredGlobalConfigMigrations,
    runPendingGlobalConfigMigrations,
    migrateLegacyTerminalSettings,
    canonicalizeTerminalApp,
    getGlobalConfigPath,
    getGlobalConfigDir,
    getGlobalConfigBackupDir,
    getTimestampedBackupPath,
};
