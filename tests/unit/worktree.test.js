#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/worktree.js
 * Run: node lib/worktree.test.js
 */

const assert = require('assert');
const worktree = require('../../lib/worktree');

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
console.log('# worktree.js — exports');

test('exports required functions', () => {
    const required = [
        'getWorktreeBase', 'findWorktrees', 'filterByFeatureId',
        'buildAgentCommand', 'buildResearchAgentCommand', 'toUnpaddedId',
        'buildTmuxSessionName', 'buildResearchTmuxSessionName',
        'matchTmuxSessionByEntityId', 'assertTmuxAvailable',
        'tmuxSessionExists', 'createDetachedTmuxSession', 'isTmuxSessionAttached',
        'shellQuote', 'detectLinuxTerminal', 'openTerminalAppWithCommand',
        'ensureTmuxSessionForWorktree', 'openInWarpSplitPanes', 'closeWarpWindow',
        'openSingleWorktree',
        'addWorktreePermissions', 'removeWorktreePermissions',
        'presetWorktreeTrust', 'removeWorktreeTrust', 'presetCodexTrust',
        'setupWorktreeEnvironment', 'ensureAgentSessions',
        'getEnrichedSessions', 'tileITerm2Windows', 'runTmux',
    ];
    for (const fn of required) {
        assert.ok(typeof worktree[fn] === 'function', `missing: ${fn}`);
    }
});

// --- Smoke tests ---
console.log('# worktree.js — smoke tests');

test('getWorktreeBase returns string path', () => {
    const base = worktree.getWorktreeBase();
    assert.ok(typeof base === 'string');
    assert.ok(base.includes('worktrees'));
});

test('toUnpaddedId strips leading zeros', () => {
    assert.strictEqual(worktree.toUnpaddedId('007'), '7');
    assert.strictEqual(worktree.toUnpaddedId('42'), '42');
    assert.strictEqual(worktree.toUnpaddedId('1'), '1');
});

test('buildTmuxSessionName returns deterministic string', () => {
    const name1 = worktree.buildTmuxSessionName('42', 'cc');
    const name2 = worktree.buildTmuxSessionName('42', 'cc');
    assert.strictEqual(name1, name2);
    assert.ok(typeof name1 === 'string');
    assert.ok(name1.length > 0);
});

test('buildResearchTmuxSessionName returns string', () => {
    const name = worktree.buildResearchTmuxSessionName('10', 'cc');
    assert.ok(typeof name === 'string');
    assert.ok(name.length > 0);
});

test('matchTmuxSessionByEntityId returns match object or null', () => {
    const name = worktree.buildTmuxSessionName('42', 'cc');
    const result = worktree.matchTmuxSessionByEntityId(name, '42');
    // Returns a parsed object when matched, null when not matched
    assert.ok(result === null || (typeof result === 'object' && 'id' in result));
});

test('shellQuote escapes single quotes', () => {
    const quoted = worktree.shellQuote("it's a test");
    assert.ok(typeof quoted === 'string');
    assert.ok(quoted.includes("'"));
});

test('findWorktrees returns array', () => {
    const wts = worktree.findWorktrees();
    assert.ok(Array.isArray(wts));
});

test('filterByFeatureId returns array', () => {
    const wts = worktree.findWorktrees();
    const filtered = worktree.filterByFeatureId(wts, '99999');
    assert.ok(Array.isArray(filtered));
});

test('tmuxSessionExists returns boolean', () => {
    const exists = worktree.tmuxSessionExists('nonexistent-session-xyz-12345');
    assert.ok(typeof exists === 'boolean');
    assert.strictEqual(exists, false);
});

test('getEnrichedSessions returns object with sessions array', () => {
    const result = worktree.getEnrichedSessions();
    assert.ok(result !== null && typeof result === 'object');
    assert.ok(Array.isArray(result.sessions));
});

// --- Linux support ---
console.log('# worktree.js — Linux support');

test('detectLinuxTerminal returns string or null', () => {
    const result = worktree.detectLinuxTerminal();
    assert.ok(result === null || typeof result === 'string');
});

test('detectLinuxTerminal respects preferred terminal', () => {
    // Passing a non-existent preferred terminal should fall through to others
    const result = worktree.detectLinuxTerminal('nonexistent-terminal-xyz');
    // Result depends on what's installed — just verify type
    assert.ok(result === null || typeof result === 'string');
    // The preferred terminal shouldn't be returned if it doesn't exist
    if (result) assert.notStrictEqual(result, 'nonexistent-terminal-xyz');
});

test('closeWarpWindow returns false on Linux', () => {
    if (process.platform === 'linux') {
        assert.strictEqual(worktree.closeWarpWindow('test'), false);
    }
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
