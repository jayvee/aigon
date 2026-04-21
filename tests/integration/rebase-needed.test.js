#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { execSync } = require('child_process');
const { test, report, withTempDir, GIT_SAFE_ENV } = require('../_helpers');
const { computeRebaseNeeded } = require('../../lib/dashboard-status-collector');

function git(cwd, args) {
    execSync(`git ${args}`, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

test('computeRebaseNeeded: returns false when worktreePath is null', () => {
    assert.strictEqual(computeRebaseNeeded(null, 'main'), false);
});

test('computeRebaseNeeded: returns false when defaultBranch is null', () => {
    assert.strictEqual(computeRebaseNeeded('/tmp/fake', null), false);
});

test('computeRebaseNeeded: returns false when git command fails (graceful degradation)', () => {
    assert.strictEqual(computeRebaseNeeded('/tmp/does-not-exist-aigon-test', 'main'), false);
});

test('computeRebaseNeeded: returns false when branch is up to date', () => {
    withTempDir('aigon-rebase-test-', dir => {
        git(dir, 'init -b main');
        git(dir, 'commit --allow-empty -m "init"');
        git(dir, 'checkout -b feature-1-test');
        assert.strictEqual(computeRebaseNeeded(dir, 'main'), false);
    });
});

test('computeRebaseNeeded: returns true when main has commits the branch does not', () => {
    withTempDir('aigon-rebase-test-', dir => {
        git(dir, 'init -b main');
        git(dir, 'commit --allow-empty -m "init"');
        git(dir, 'checkout -b feature-1-test');
        git(dir, 'checkout main');
        git(dir, 'commit --allow-empty -m "new main commit"');
        git(dir, 'checkout feature-1-test');
        assert.strictEqual(computeRebaseNeeded(dir, 'main'), true);
    });
});

report();
