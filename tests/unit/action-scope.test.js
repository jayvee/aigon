#!/usr/bin/env node
'use strict';

/**
 * Unit tests for lib/action-scope.js
 * Run: node lib/action-scope.test.js
 */

const assert = require('assert');
const { ACTION_SCOPES, buildActionContext, assertActionAllowed, getActionScope } = require('../../lib/action-scope');

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

console.log('\naction-scope.js tests\n');

// ---------------------------------------------------------------------------
// ACTION_SCOPES
// ---------------------------------------------------------------------------

test('ACTION_SCOPES has expected scope types', () => {
    const validScopes = new Set(['main-only', 'feature-local', 'any']);
    for (const [action, def] of Object.entries(ACTION_SCOPES)) {
        assert.ok(validScopes.has(def.scope), `${action} has invalid scope: ${def.scope}`);
    }
});

test('feature-close is main-only', () => {
    assert.strictEqual(ACTION_SCOPES['feature-close'].scope, 'main-only');
});

test('feature-do is feature-local', () => {
    assert.strictEqual(ACTION_SCOPES['feature-do'].scope, 'feature-local');
});

test('dashboard is any', () => {
    assert.strictEqual(ACTION_SCOPES['dashboard'].scope, 'any');
});

test('board is any', () => {
    assert.strictEqual(ACTION_SCOPES['board'].scope, 'any');
});

test('feedback-create is any', () => {
    assert.strictEqual(ACTION_SCOPES['feedback-create'].scope, 'any');
});

// ---------------------------------------------------------------------------
// getActionScope
// ---------------------------------------------------------------------------

test('getActionScope returns known scope', () => {
    assert.strictEqual(getActionScope('feature-close').scope, 'main-only');
});

test('getActionScope returns main-only for unknown action', () => {
    assert.strictEqual(getActionScope('unknown-action').scope, 'main-only');
});

// ---------------------------------------------------------------------------
// buildActionContext
// ---------------------------------------------------------------------------

test('buildActionContext detects main branch', () => {
    const mockGit = {
        getCurrentBranch: () => 'main',
        getDefaultBranch: () => 'main',
        getCommonDir: () => '.git',
    };
    const ctx = buildActionContext(mockGit);
    assert.strictEqual(ctx.isDefaultBranch, true);
    assert.strictEqual(ctx.isWorktree, false);
    assert.strictEqual(ctx.featureId, null);
});

test('buildActionContext detects feature branch', () => {
    const mockGit = {
        getCurrentBranch: () => 'feature-42-cc-dark-mode',
        getDefaultBranch: () => 'main',
        getCommonDir: () => '.git',
    };
    const ctx = buildActionContext(mockGit);
    assert.strictEqual(ctx.isDefaultBranch, false);
    assert.strictEqual(ctx.featureId, '42');
});

test('buildActionContext detects worktree', () => {
    const mockGit = {
        getCurrentBranch: () => 'feature-42-cc-dark-mode',
        getDefaultBranch: () => 'main',
        getCommonDir: () => '/home/user/project/.git',
    };
    const ctx = buildActionContext(mockGit);
    assert.strictEqual(ctx.isWorktree, true);
    assert.strictEqual(ctx.mainRepoPath, '/home/user/project');
    assert.strictEqual(ctx.featureId, '42');
});

test('buildActionContext handles master default branch', () => {
    const mockGit = {
        getCurrentBranch: () => 'master',
        getDefaultBranch: () => 'master',
        getCommonDir: () => '.git',
    };
    const ctx = buildActionContext(mockGit);
    assert.strictEqual(ctx.isDefaultBranch, true);
});

// ---------------------------------------------------------------------------
// assertActionAllowed — scope: 'any'
// ---------------------------------------------------------------------------

test('any-scope actions always pass', () => {
    const ctx = { isDefaultBranch: false, isWorktree: false, branch: 'some-branch', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('dashboard', ctx), undefined);
    assert.strictEqual(assertActionAllowed('board', ctx), undefined);
});

// ---------------------------------------------------------------------------
// assertActionAllowed — scope: 'main-only'
// ---------------------------------------------------------------------------

test('main-only passes on default branch', () => {
    const ctx = { isDefaultBranch: true, branch: 'main', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('feature-close', ctx), undefined);
});

test('main-only from worktree returns delegate', () => {
    const ctx = { isDefaultBranch: false, isWorktree: true, mainRepoPath: '/home/user/project', branch: 'feature-42-cc-x', defaultBranch: 'main' };
    const result = assertActionAllowed('feature-close', ctx);
    assert.ok(result);
    assert.strictEqual(result.delegate, '/home/user/project');
});

test('main-only from non-default branch (not worktree) throws', () => {
    const ctx = { isDefaultBranch: false, isWorktree: false, branch: 'some-branch', defaultBranch: 'main' };
    assert.throws(() => assertActionAllowed('feature-close', ctx), /Must be on 'main'/);
});

test('feature-close passes on matching drive-mode feature branch in main repo', () => {
    const ctx = { isDefaultBranch: false, isWorktree: false, featureId: '07', branch: 'feature-07-cc-add-footer', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('feature-close', ctx, { featureId: '07' }), undefined);
});

test('feature-close still throws on mismatched feature branch in main repo', () => {
    const ctx = { isDefaultBranch: false, isWorktree: false, featureId: '08', branch: 'feature-08-cc-other', defaultBranch: 'main' };
    assert.throws(() => assertActionAllowed('feature-close', ctx, { featureId: '07' }), /Must be on 'main'/);
});

test('unknown action defaults to main-only', () => {
    const ctx = { isDefaultBranch: false, isWorktree: false, branch: 'feat', defaultBranch: 'main' };
    assert.throws(() => assertActionAllowed('totally-unknown', ctx), /Must be on 'main'/);
});

// ---------------------------------------------------------------------------
// assertActionAllowed — scope: 'feature-local'
// ---------------------------------------------------------------------------

test('feature-local passes without target feature ID', () => {
    const ctx = { isDefaultBranch: false, featureId: '42', branch: 'feature-42-cc-x', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('feature-do', ctx), undefined);
});

test('feature-local passes with matching feature ID', () => {
    const ctx = { isDefaultBranch: false, featureId: '42', branch: 'feature-42-cc-x', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('feature-do', ctx, { featureId: '42' }), undefined);
});

test('feature-local passes with padded vs unpadded feature ID', () => {
    const ctx = { isDefaultBranch: false, featureId: '042', branch: 'feature-042-cc-x', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('feature-do', ctx, { featureId: '42' }), undefined);
});

test('feature-local throws on mismatched feature ID', () => {
    const ctx = { isDefaultBranch: false, featureId: '42', branch: 'feature-42-cc-x', defaultBranch: 'main' };
    assert.throws(() => assertActionAllowed('feature-do', ctx, { featureId: '99' }), /targets feature 99/);
});

test('feature-local passes on main branch without target', () => {
    const ctx = { isDefaultBranch: true, featureId: null, branch: 'main', defaultBranch: 'main' };
    assert.strictEqual(assertActionAllowed('feature-do', ctx), undefined);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
