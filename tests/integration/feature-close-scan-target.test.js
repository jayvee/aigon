#!/usr/bin/env node
'use strict';

// REGRESSION F245: feature-close security scan must run against the target worktree,
// not the caller's cwd. Running from a main repo on a stale sibling feature branch
// reported findings from that sibling, blocking the close.
// REGRESSION F240: bare `feature-close <id>` must prefer an existing worktree branch
// over a stale `feature-<num>-<desc>` drive branch.
// REGRESSION F255: remote-merged close must sync local main to origin/main and push.

const assert = require('assert');
const { test, report } = require('../_helpers');
const { mergeFeatureBranch, resolveScanCwd, syncRemoteMergedBranch, cleanupWorktreeAndBranch, pushRemoteMergedCloseCommit, resolveCloseTarget } = require('../../lib/feature-close');

test('resolveScanCwd: worktree-backed close scans the worktree path (F245 AC1)', () => {
    assert.deepStrictEqual(
        resolveScanCwd({ branchName: 'feature-245-cc-x', worktreePath: '/tmp/wt' }, '/repo', () => true),
        { cwd: '/tmp/wt' },
    );
});

test('resolveScanCwd: plain Drive branch scans current checkout (F245 AC2)', () => {
    assert.deepStrictEqual(resolveScanCwd({}, '/repo', () => true), { cwd: '/repo' });
});

test('resolveScanCwd: null worktreePath falls through to cwd', () => {
    assert.deepStrictEqual(resolveScanCwd({ worktreePath: null }, '/repo', () => true), { cwd: '/repo' });
});

test('resolveScanCwd: missing fleet worktree fails closed (does not scan caller cwd)', () => {
    const result = resolveScanCwd({ branchName: 'feature-245-cc-x', worktreePath: '/tmp/wt' }, '/repo', () => false);
    assert.match(result.error || '', /Target worktree not found/);
});

test('mergeFeatureBranch: scan is invoked with cwd = worktreePath (F245 AC3)', () => {
    let scanCall = null;
    const result = mergeFeatureBranch(
        { branchName: 'feature-245-cc-x', agentId: 'cc', num: 245, worktreePath: process.cwd() },
        { getDefaultBranch: () => 'main', runGit: () => {}, runSecurityScan: (stage, opts) => { scanCall = { stage, opts }; return { passed: false }; } },
    );
    assert.strictEqual(scanCall.stage, 'featureClose');
    assert.strictEqual(scanCall.opts.cwd, process.cwd(), 'scan cwd == target worktreePath');
    assert.ok(!result.ok && /security scan failure/.test(result.error), 'scan failure aborts close');
});

test('mergeFeatureBranch: missing worktree fails closed without scanning (F245)', () => {
    const missingWt = mergeFeatureBranch(
        { branchName: 'feature-245-cc-x', agentId: 'cc', num: 245, worktreePath: '/tmp/does-not-exist' },
        { getDefaultBranch: () => 'main', runGit: () => {}, runSecurityScan: () => { throw new Error('must not scan missing worktree'); } },
    );
    assert.ok(!missingWt.ok && /Target worktree not found/.test(missingWt.error));
});

test('resolveCloseTarget: worktree branch wins over stale drive branch (F240)', () => {
    const sp = '/tmp/f240/docs/specs/features/03-in-progress/feature-240-demo.md';
    const ex = new Set(['feature-240-demo', 'feature-240-cx-demo']);
    const r240 = resolveCloseTarget(['240'], {
        PATHS: { features: { root: '/tmp/f240/docs/specs/features' } },
        findFile: () => ({ file: 'feature-240-demo.md', fullPath: sp, folder: '03-in-progress' }),
        getWorktreeBase: () => '/tmp/wtbase',
        findWorktrees: () => [{ path: '/tmp/wtbase/feature-240-cx-demo', agent: 'cx' }],
        filterByFeatureId: (l) => l,
        branchExists: (n) => ex.has(n),
        resolveFeatureSpecInfo: () => ({ path: sp, stage: '03-in-progress' }),
        gitLib: { getCurrentBranch: () => 'main', getDefaultBranch: () => 'main', getCommonDir: () => '.git', getMainRepoPath: (p) => p, isWorktree: () => false },
    });
    assert.ok(r240.ok && r240.branchName === 'feature-240-cx-demo' && r240.mode === 'multi-agent');
});

test('syncRemoteMergedBranch: fetch + reset + delete sequence (F255)', () => {
    const syncCalls = [];
    assert.ok(syncRemoteMergedBranch(
        { branchName: 'feature-255-cc-x' },
        { getDefaultBranch: () => 'main', runGit: (cmd) => syncCalls.push(cmd), getCurrentBranch: () => 'main', getGitStatusPorcelain: () => '' },
    ).ok);
    assert.deepStrictEqual(syncCalls.slice(0, 3), ['git checkout main', 'git fetch origin main', 'git reset --hard origin/main']);
});

test('cleanupWorktreeAndBranch: deletes local and remote branch (F255)', () => {
    const cleanupCalls = [];
    cleanupWorktreeAndBranch(
        { branchName: 'feature-255-cc-x', keepBranch: false, worktreePath: null },
        { runGit: (cmd) => cleanupCalls.push(cmd), safeRemoveWorktree: () => true, getWorktreeStatus: () => '', forceDeleteBranch: true, deleteRemoteBranch: true },
    );
    assert.deepStrictEqual(cleanupCalls, ['git branch -D feature-255-cc-x', 'git push origin --delete feature-255-cc-x']);
});

test('pushRemoteMergedCloseCommit: pushes main (F255)', () => {
    const pushCalls = [];
    pushRemoteMergedCloseCommit('main', { runGit: (cmd) => pushCalls.push(cmd) });
    assert.deepStrictEqual(pushCalls, ['git push origin main']);
});

report();
