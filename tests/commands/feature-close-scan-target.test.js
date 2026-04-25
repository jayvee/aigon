#!/usr/bin/env node
// REGRESSION feature 245: feature-close security scan must run against the
// target worktree (the branch being merged), not the caller's cwd. Bug:
// running `feature-close <id> <agent>` from a main repo on a stale sibling
// feature branch reported Semgrep findings from that sibling, blocking the
// close even though the target worktree branch was clean.
// REGRESSION feature 240: bare `feature-close <id>` must prefer an existing
// worktree branch over a stale `feature-<num>-<desc>` drive branch.
// REGRESSION feature 255: remote-merged close must sync local main to
// origin/main and push the close commit.
const a = require('assert');
const close = require('../../lib/feature-close');
const {
    mergeFeatureBranch, resolveScanCwd, syncRemoteMergedBranch,
    cleanupWorktreeAndBranch, pushRemoteMergedCloseCommit, resolveCloseTarget,
} = close;

for (const [desc, target, exists, expect] of [
    ['AC1 worktree-backed close scans the worktree path', { branchName: 'feature-245-cc-x', worktreePath: '/tmp/wt' }, () => true, { cwd: '/tmp/wt' }],
    ['AC2 plain Drive branch (no worktree) scans current checkout', {}, () => true, { cwd: '/repo' }],
    ['null worktreePath falls through to cwd', { worktreePath: null }, () => true, { cwd: '/repo' }],
]) a.deepStrictEqual(resolveScanCwd(target, '/repo', exists), expect, desc);
a.match(
    resolveScanCwd({ branchName: 'feature-245-cc-x', worktreePath: '/tmp/wt' }, '/repo', () => false).error || '',
    /Target worktree not found/,
    'missing fleet worktree fails closed instead of scanning caller cwd'
);

// mergeFeatureBranch wiring: runSecurityScan is invoked with cwd = worktreePath.
let scanCall = null;
const result = mergeFeatureBranch(
    { branchName: 'feature-245-cc-x', agentId: 'cc', num: 245, worktreePath: process.cwd() },
    { getDefaultBranch: () => 'main', runGit: () => {}, runSecurityScan: (stage, opts) => { scanCall = { stage, opts }; return { passed: false }; } }
);
a.strictEqual(scanCall.stage, 'featureClose');
a.strictEqual(scanCall.opts.cwd, process.cwd(), 'AC3 scan cwd == target worktreePath');
a.ok(!result.ok && /security scan failure/.test(result.error), 'scan failure aborts close');

const missingWt = mergeFeatureBranch(
    { branchName: 'feature-245-cc-x', agentId: 'cc', num: 245, worktreePath: '/tmp/does-not-exist' },
    { getDefaultBranch: () => 'main', runGit: () => {}, runSecurityScan: () => { throw new Error('must not scan missing worktree'); } }
);
a.ok(!missingWt.ok && /Target worktree not found/.test(missingWt.error));

// feature 240: worktree branch wins over stale drive branch.
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
a.ok(r240.ok && r240.branchName === 'feature-240-cx-demo' && r240.mode === 'multi-agent', 'feature 240: worktree branch wins');

// feature 255: remote-merged close must fetch + reset + delete branches + push main.
const syncCalls = [];
a.ok(syncRemoteMergedBranch(
    { branchName: 'feature-255-cc-x' },
    { getDefaultBranch: () => 'main', runGit: (cmd) => syncCalls.push(cmd), getCurrentBranch: () => 'main', getGitStatusPorcelain: () => '' }
).ok);
a.deepStrictEqual(syncCalls.slice(0, 3), ['git checkout main', 'git fetch origin main', 'git reset --hard origin/main']);

const cleanupCalls = [];
cleanupWorktreeAndBranch(
    { branchName: 'feature-255-cc-x', keepBranch: false, worktreePath: null },
    { runGit: (cmd) => cleanupCalls.push(cmd), safeRemoveWorktree: () => true, getWorktreeStatus: () => '', forceDeleteBranch: true, deleteRemoteBranch: true }
);
a.deepStrictEqual(cleanupCalls, ['git branch -D feature-255-cc-x', 'git push origin --delete feature-255-cc-x']);

const pushCalls = [];
pushRemoteMergedCloseCommit('main', { runGit: (cmd) => pushCalls.push(cmd) });
a.deepStrictEqual(pushCalls, ['git push origin main']);

console.log('ok feature-close-scan-target');
