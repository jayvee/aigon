#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/templates.js
 * Run: node lib/templates.test.js
 */

const assert = require('assert');
const templates = require('../../lib/templates');

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
console.log('# templates.js — exports');

test('exports PATHS with correct structure', () => {
    assert.ok(templates.PATHS !== null && typeof templates.PATHS === 'object');
    assert.ok('research' in templates.PATHS);
    assert.ok('features' in templates.PATHS);
    assert.ok('feedback' in templates.PATHS);
    assert.ok(typeof templates.PATHS.features.root === 'string');
    assert.ok(Array.isArray(templates.PATHS.features.folders));
});

test('exports MARKER_START and MARKER_END', () => {
    assert.ok(typeof templates.MARKER_START === 'string');
    assert.ok(typeof templates.MARKER_END === 'string');
    assert.ok(templates.MARKER_START.includes('AIGON_START'));
    assert.ok(templates.MARKER_END.includes('AIGON_END'));
});

test('exports COMMAND_REGISTRY object', () => {
    assert.ok(templates.COMMAND_REGISTRY !== null && typeof templates.COMMAND_REGISTRY === 'object');
    assert.ok(Object.keys(templates.COMMAND_REGISTRY).length > 0);
});

test('exports COMMAND_ALIASES', () => {
    assert.ok(templates.COMMAND_ALIASES !== null && typeof templates.COMMAND_ALIASES === 'object');
});

test('exports AGENT_CONFIGS', () => {
    assert.ok(templates.AGENT_CONFIGS !== null && typeof templates.AGENT_CONFIGS === 'object');
});

test('exports COMMANDS_DISABLE_MODEL_INVOCATION as Set', () => {
    assert.ok(templates.COMMANDS_DISABLE_MODEL_INVOCATION instanceof Set);
});

test('exports required functions', () => {
    const required = [
        'readTemplate', 'loadAgentConfig', 'getAvailableAgents', 'buildAgentAliasMap',
        'processTemplate', 'readGenericTemplate', 'extractDescription', 'formatCommandOutput',
        'getScaffoldContent', 'getProjectInstructions', 'getRootFileContent', 'syncAgentsMdFile',
        'upsertMarkedContent', 'upsertRootFile',
        'removeDeprecatedCommands', 'migrateOldFlatCommands',
        'getWorktreeStatus', 'safeRemoveWorktree',
    ];
    for (const fn of required) {
        assert.ok(typeof templates[fn] === 'function', `missing function: ${fn}`);
    }
});

// --- Smoke tests ---
console.log('# templates.js — smoke tests');

test('processTemplate replaces {{KEY}} placeholders', () => {
    const result = templates.processTemplate('Hello {{NAME}}!', { NAME: 'World' });
    assert.strictEqual(result, 'Hello World!');
});

test('processTemplate replaces multiple placeholders', () => {
    const result = templates.processTemplate('{{A}} and {{B}}', { A: 'foo', B: 'bar' });
    assert.strictEqual(result, 'foo and bar');
});

test('extractDescription returns a string', () => {
    const content = '# Feature\n\nThis is a description paragraph.';
    const desc = templates.extractDescription(content);
    assert.ok(typeof desc === 'string');
});

test('getAvailableAgents returns array of agent IDs', () => {
    const agents = templates.getAvailableAgents();
    assert.ok(Array.isArray(agents));
    assert.ok(agents.length > 0);
});

test('loadAgentConfig returns object for known agent', () => {
    const agents = templates.getAvailableAgents();
    if (agents.length > 0) {
        const cfg = templates.loadAgentConfig(agents[0]);
        assert.ok(cfg !== null && typeof cfg === 'object');
    }
});

test('buildAgentAliasMap returns object', () => {
    const map = templates.buildAgentAliasMap();
    assert.ok(map !== null && typeof map === 'object');
});

test('getWorktreeStatus returns string (git status output)', () => {
    const status = templates.getWorktreeStatus();
    assert.ok(typeof status === 'string');
});

test('COMMAND_REGISTRY entries have required fields', () => {
    for (const [name, entry] of Object.entries(templates.COMMAND_REGISTRY)) {
        assert.ok(typeof name === 'string', `key should be string`);
        assert.ok(typeof entry === 'object', `entry for ${name} should be object`);
    }
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
