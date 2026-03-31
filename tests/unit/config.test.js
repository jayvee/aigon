#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/config.js
 * Run: node lib/config.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-config-test-home-'));
process.env.HOME = TEST_HOME;

const config = require('../../lib/config');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

// --- Exports ---
console.log('# config.js — exports');

test('exports path constants', () => {
    const required = [
        'ROOT_DIR', 'CLI_ENTRY_PATH', 'TEMPLATES_ROOT', 'CLAUDE_SETTINGS_PATH',
        'HOOKS_FILE_PATH', 'PROJECT_CONFIG_PATH', 'GLOBAL_CONFIG_DIR',
        'GLOBAL_CONFIG_PATH', 'GLOBAL_CONFIG_BACKUP_DIR',
        'GLOBAL_CONFIG_BACKUP_LATEST_PATH', 'SPECS_ROOT',
    ];
    for (const k of required) {
        assert.ok(typeof config[k] === 'string', `missing string constant: ${k}`);
    }
});

test('exports port constants', () => {
    assert.ok(typeof config.DASHBOARD_DEFAULT_PORT === 'number');
    assert.ok(typeof config.DASHBOARD_DYNAMIC_PORT_START === 'number');
    assert.ok(typeof config.DASHBOARD_DYNAMIC_PORT_END === 'number');
});

test('exports DEFAULT_GLOBAL_CONFIG object', () => {
    assert.ok(config.DEFAULT_GLOBAL_CONFIG !== null && typeof config.DEFAULT_GLOBAL_CONFIG === 'object');
});

test('exports PROVIDER_FAMILIES', () => {
    assert.ok(config.PROVIDER_FAMILIES !== null && typeof config.PROVIDER_FAMILIES === 'object');
});

test('exports required functions', () => {
    const required = [
        'detectEditor', 'openInEditor', 'getShellProfile',
        'detectActiveAgentSession', 'printAgentContextWarning',
        'normalizeMode', 'isSameProviderFamily',
        'loadGlobalConfig', 'loadProfilePresetStrings', 'loadProjectConfig',
        'saveProjectConfig', 'saveGlobalConfig', 'safeBackupGlobalConfig', 'resolveConfigKeyAlias',
        'getNestedValue', 'setNestedValue', 'parseConfigScope',
        'getConfigValueWithProvenance', 'getEffectiveConfig',
        'readBasePort', 'showPortSummary',
        'readConductorReposFromGlobalConfig',
        'detectProjectProfile', 'getActiveProfile', 'getProfilePlaceholders',
        'resolveTestingPlaceholders', 'computeInstructionsConfigHash',
        'getAgentCliConfig', 'parseCliFlagTokens', 'getAgentLaunchFlagTokens',
        'getModelProvenance',
    ];
    for (const fn of required) {
        assert.ok(typeof config[fn] === 'function', `missing function: ${fn}`);
    }
});

// --- Smoke tests ---
console.log('# config.js — smoke tests');

test('ROOT_DIR points to a real directory', () => {
    assert.ok(fs.existsSync(config.ROOT_DIR));
});

test('DASHBOARD_DEFAULT_PORT is 4100', () => {
    assert.strictEqual(config.DASHBOARD_DEFAULT_PORT, 4100);
});

test('loadGlobalConfig returns object', () => {
    const cfg = config.loadGlobalConfig();
    assert.ok(cfg !== null && typeof cfg === 'object');
});

test('loadProjectConfig returns object or empty object', () => {
    const cfg = config.loadProjectConfig();
    assert.ok(cfg !== null && typeof cfg === 'object');
});

test('isSameProviderFamily recognizes same family', () => {
    // Claude family members should be same
    const res = config.isSameProviderFamily('cc', 'cc');
    assert.ok(typeof res === 'boolean');
});

test('getActiveProfile returns object with name string', () => {
    const profile = config.getActiveProfile();
    assert.ok(profile !== null && typeof profile === 'object');
    assert.ok(typeof profile.name === 'string');
    assert.ok(profile.name.length > 0);
});

test('normalizeMode returns string', () => {
    const mode = config.normalizeMode('drive');
    assert.ok(typeof mode === 'string');
});

test('getNestedValue retrieves nested property', () => {
    const obj = { a: { b: { c: 42 } } };
    assert.strictEqual(config.getNestedValue(obj, 'a.b.c'), 42);
});

test('setNestedValue sets nested property', () => {
    const obj = {};
    config.setNestedValue(obj, 'x.y', 99);
    assert.strictEqual(obj.x.y, 99);
});

test('readBasePort returns object with port number', () => {
    const result = config.readBasePort();
    assert.ok(result !== null && typeof result === 'object');
    assert.ok(typeof result.port === 'number');
    assert.ok(result.port > 0);
});

test('saveGlobalConfig creates a recoverable backup of the previous file', () => {
    fs.mkdirSync(config.GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(config.GLOBAL_CONFIG_PATH, JSON.stringify({ terminal: 'warp', repos: ['/tmp/old'] }, null, 2) + '\n');

    config.saveGlobalConfig({ terminal: 'tmux', tmuxApp: 'iterm2', repos: ['/tmp/new'] });

    assert.ok(fs.existsSync(config.GLOBAL_CONFIG_BACKUP_LATEST_PATH), 'latest backup should exist');
    const latest = JSON.parse(fs.readFileSync(config.GLOBAL_CONFIG_BACKUP_LATEST_PATH, 'utf8'));
    assert.strictEqual(latest.terminal, 'warp');
    assert.deepStrictEqual(latest.repos, ['/tmp/old']);

    const backups = fs.readdirSync(config.GLOBAL_CONFIG_BACKUP_DIR)
        .filter(name => name.startsWith('config.') && name.endsWith('.json'));
    assert.ok(backups.length >= 2, 'should create latest and dated backups');

    const current = JSON.parse(fs.readFileSync(config.GLOBAL_CONFIG_PATH, 'utf8'));
    assert.strictEqual(current.terminal, 'tmux');
    assert.strictEqual(current.tmuxApp, 'iterm2');
    assert.deepStrictEqual(current.repos, ['/tmp/new']);
});

// --- resolveTestingPlaceholders ---
console.log('# config.js — resolveTestingPlaceholders');

test('exports resolveTestingPlaceholders function', () => {
    assert.ok(typeof config.resolveTestingPlaceholders === 'function');
});

test('resolveTestingPlaceholders "full" returns all sections', () => {
    const result = config.resolveTestingPlaceholders('full', false, '');
    assert.ok(result.TESTING_WRITE_SECTION.includes('MUST write tests'));
    assert.ok(result.TESTING_RUN_SECTION.includes('npm test'));
    assert.strictEqual(result.TESTING_PLAYWRIGHT_SECTION, '');
});

test('resolveTestingPlaceholders "full" with playwright returns playwright section', () => {
    const playwrightContent = '## Playwright verification\nRun playwright tests.';
    const result = config.resolveTestingPlaceholders('full', true, playwrightContent);
    assert.ok(result.TESTING_WRITE_SECTION.includes('MUST write tests'));
    assert.ok(result.TESTING_RUN_SECTION.includes('npm test'));
    assert.strictEqual(result.TESTING_PLAYWRIGHT_SECTION, playwrightContent);
});

test('resolveTestingPlaceholders "minimal" returns run-only instruction', () => {
    const result = config.resolveTestingPlaceholders('minimal', true, 'playwright stuff');
    assert.ok(result.TESTING_WRITE_SECTION.includes('Do not write new tests'));
    assert.strictEqual(result.TESTING_PLAYWRIGHT_SECTION, '');
    assert.strictEqual(result.TESTING_RUN_SECTION, '');
});

test('resolveTestingPlaceholders "skip" returns all empty', () => {
    const result = config.resolveTestingPlaceholders('skip', true, 'playwright stuff');
    assert.strictEqual(result.TESTING_WRITE_SECTION, '');
    assert.strictEqual(result.TESTING_PLAYWRIGHT_SECTION, '');
    assert.strictEqual(result.TESTING_RUN_SECTION, '');
});

// --- computeInstructionsConfigHash ---
console.log('# config.js — computeInstructionsConfigHash');

test('exports computeInstructionsConfigHash function', () => {
    assert.ok(typeof config.computeInstructionsConfigHash === 'function');
});

test('computeInstructionsConfigHash returns 64-char hex string', () => {
    const hash = config.computeInstructionsConfigHash({});
    assert.ok(typeof hash === 'string');
    assert.strictEqual(hash.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(hash));
});

test('computeInstructionsConfigHash is stable for same input', () => {
    const cfg = { instructions: { testing: 'skip' }, profile: 'web' };
    const hash1 = config.computeInstructionsConfigHash(cfg);
    const hash2 = config.computeInstructionsConfigHash(cfg);
    assert.strictEqual(hash1, hash2);
});

test('computeInstructionsConfigHash differs for different instructions', () => {
    const hash1 = config.computeInstructionsConfigHash({ instructions: { testing: 'full' } });
    const hash2 = config.computeInstructionsConfigHash({ instructions: { testing: 'skip' } });
    assert.notStrictEqual(hash1, hash2);
});

test('computeInstructionsConfigHash ignores unrelated fields', () => {
    const hash1 = config.computeInstructionsConfigHash({ instructions: { testing: 'full' }, unrelated: 'foo' });
    const hash2 = config.computeInstructionsConfigHash({ instructions: { testing: 'full' }, unrelated: 'bar' });
    assert.strictEqual(hash1, hash2);
});

test('computeInstructionsConfigHash includes profile in hash', () => {
    const hash1 = config.computeInstructionsConfigHash({ profile: 'web' });
    const hash2 = config.computeInstructionsConfigHash({ profile: 'api' });
    assert.notStrictEqual(hash1, hash2);
});

test('computeInstructionsConfigHash includes verification in hash', () => {
    const hash1 = config.computeInstructionsConfigHash({ verification: { playwright: { enabled: true } } });
    const hash2 = config.computeInstructionsConfigHash({ verification: { playwright: { enabled: false } } });
    assert.notStrictEqual(hash1, hash2);
});

test('computeInstructionsConfigHash empty config matches no-instructions config', () => {
    const hash1 = config.computeInstructionsConfigHash({});
    const hash2 = config.computeInstructionsConfigHash({ instructions: {} });
    assert.strictEqual(hash1, hash2);
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
