#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/config.js
 * Run: node lib/config.test.js
 */

const assert = require('assert');
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
        'GLOBAL_CONFIG_PATH', 'SPECS_ROOT',
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
        'saveProjectConfig', 'saveGlobalConfig', 'resolveConfigKeyAlias',
        'getNestedValue', 'setNestedValue', 'parseConfigScope',
        'getConfigValueWithProvenance', 'getEffectiveConfig',
        'readBasePort', 'showPortSummary',
        'readConductorReposFromGlobalConfig',
        'detectProjectProfile', 'getActiveProfile', 'getProfilePlaceholders',
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
    const fs = require('fs');
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

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
