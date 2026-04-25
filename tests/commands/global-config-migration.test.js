#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDirAsync, report } = require('../_helpers');
const {
    migrateLegacyTerminalSettings,
    runPendingGlobalConfigMigrations,
    TERMINAL_CONFIG_MIGRATION_VERSION,
} = require('../../lib/global-config-migration');

function loadFreshConfigModule() {
    delete require.cache[require.resolve('../../lib/config')];
    return require('../../lib/config');
}

for (const [desc, input, expected] of [
    ['both legacy keys prefer tmuxApp', { terminal: 'warp', tmuxApp: 'iterm2' }, 'iterm2'],
    ['terminal-only warp maps to warp', { terminal: 'warp' }, 'warp'],
    ['terminal-only terminal maps to apple-terminal', { terminal: 'terminal' }, 'apple-terminal'],
    ['terminal-only tmux maps to apple-terminal', { terminal: 'tmux' }, 'apple-terminal'],
    ['tmuxApp-only terminal maps to apple-terminal', { tmuxApp: 'terminal' }, 'apple-terminal'],
]) test(`legacy terminal migration: ${desc}`, () => {
    // REGRESSION: feature 309 must collapse every legacy terminal permutation into terminalApp.
    const migrated = migrateLegacyTerminalSettings({ ...input, agents: {} });
    assert.strictEqual(migrated.terminalApp, expected);
    assert.ok(!('terminal' in migrated));
    assert.ok(!('tmuxApp' in migrated));
});

testAsync('global config migration writes canonical config once and is idempotent', () => withTempDirAsync('aigon-global-config-', async (tmp) => {
    // REGRESSION: feature 309 must back up and rewrite ~/.aigon/config.json exactly once per pending migration set.
    const configPath = path.join(tmp, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ terminal: 'warp', tmuxApp: 'iterm2', agents: {} }, null, 2));

    const prev = process.env.GLOBAL_CONFIG_PATH;
    process.env.GLOBAL_CONFIG_PATH = configPath;
    try {
        const logs = [];
        const first = await runPendingGlobalConfigMigrations('0.0.0', { log: (line) => logs.push(line) });
        const migrated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.deepStrictEqual(first.applied, [TERMINAL_CONFIG_MIGRATION_VERSION]);
        assert.strictEqual(migrated.terminalApp, 'iterm2');
        assert.strictEqual(migrated.schemaVersion, TERMINAL_CONFIG_MIGRATION_VERSION);
        assert.ok(fs.existsSync(first.backupPath), 'timestamped backup should exist');
        assert.ok(logs.some(line => line.includes('terminalApp=iterm2')), 'migration should emit one-line summary');

        const second = await runPendingGlobalConfigMigrations('0.0.0', { log: () => {} });
        assert.deepStrictEqual(second.applied, []);
        assert.ok(second.skipped, 'second run should be a no-op');
    } finally {
        if (prev === undefined) delete process.env.GLOBAL_CONFIG_PATH;
        else process.env.GLOBAL_CONFIG_PATH = prev;
    }
}));

test('loadGlobalConfig keeps legacy terminal preference readable before migration runs', () => {
    // REGRESSION: feature 309 must not silently drop terminal prefs when schemaVersion is missing or migration has not run.
    const prevConfigPath = process.env.GLOBAL_CONFIG_PATH;
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aigon-config-compat-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ tmuxApp: 'terminal', agents: {} }, null, 2));
    process.env.GLOBAL_CONFIG_PATH = configPath;
    try {
        const { loadGlobalConfig } = loadFreshConfigModule();
        const config = loadGlobalConfig();
        assert.strictEqual(config.terminalApp, 'apple-terminal');
    } finally {
        if (prevConfigPath === undefined) delete process.env.GLOBAL_CONFIG_PATH;
        else process.env.GLOBAL_CONFIG_PATH = prevConfigPath;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

report();
