#!/usr/bin/env node
// REGRESSION feature 245: feature-close security scan must run against the
// target worktree (the branch actually being merged), not the caller's cwd.
// Bug: running `feature-close <id> <agent>` from a main repo checked out on a
// stale sibling feature branch reported Semgrep findings from that sibling,
// blocking the close even though the target worktree branch was clean.
const a = require('assert');
const {
    mergeFeatureBranch,
    resolveScanCwd,
    syncRemoteMergedBranch,
    cleanupWorktreeAndBranch,
    pushRemoteMergedCloseCommit,
} = require('../../lib/feature-close');

// resolveScanCwd: worktree wins when it exists, plain Drive falls back to cwd,
// and missing fleet worktrees fail closed instead of scanning the wrong branch.
a.deepStrictEqual(
    resolveScanCwd({ branchName: 'feature-245-cc-x', worktreePath: '/tmp/wt' }, '/repo', () => true),
    { cwd: '/tmp/wt' },
    'AC1: worktree-backed close scans the worktree path'
);
a.match(
    resolveScanCwd({ branchName: 'feature-245-cc-x', worktreePath: '/tmp/wt' }, '/repo', () => false).error || '',
    /Target worktree not found/,
    'missing fleet worktree fails closed instead of scanning caller cwd'
);
a.deepStrictEqual(
    resolveScanCwd({}, '/repo', () => true),
    { cwd: '/repo' },
    'AC2: plain Drive branch (no worktree) scans current checkout'
);
a.deepStrictEqual(
    resolveScanCwd({ worktreePath: null }, '/repo', () => true),
    { cwd: '/repo' },
    'null worktreePath falls through to cwd'
);

// mergeFeatureBranch wiring: runSecurityScan is invoked with { cwd: worktreePath }
// so the scan sees the target branch, not sibling branches in the main checkout.
let scanCall = null;
const fakeScan = (stage, opts) => { scanCall = { stage, opts }; return { passed: false }; };
const target = { branchName: 'feature-245-cc-x', agentId: 'cc', num: 245, worktreePath: process.cwd() };
const result = mergeFeatureBranch(target, { getDefaultBranch: () => 'main', runGit: () => {}, runSecurityScan: fakeScan });
a.ok(scanCall, 'mergeFeatureBranch called runSecurityScan');
a.strictEqual(scanCall.stage, 'featureClose', 'scan stage is featureClose');
a.strictEqual(scanCall.opts.cwd, process.cwd(), 'AC3: scan cwd == target worktreePath');
a.ok(!result.ok, 'scan failure still aborts the close');
a.ok(/security scan failure/.test(result.error || ''), 'error mentions scan failure');

const missingWtResult = mergeFeatureBranch(
    { branchName: 'feature-245-cc-x', agentId: 'cc', num: 245, worktreePath: '/tmp/does-not-exist' },
    { getDefaultBranch: () => 'main', runGit: () => {}, runSecurityScan: () => { throw new Error('must not scan missing worktree'); } }
);
a.ok(!missingWtResult.ok, 'missing target worktree aborts the close');
a.match(missingWtResult.error || '', /Target worktree not found/, 'error explains missing worktree');

// REGRESSION feature 240: bare `feature-close <id>` must prefer an existing
// worktree branch over a stale `feature-<num>-<desc>` drive branch left behind
// by re-running `feature-start <id>` on an already-started worktree feature.
const { resolveCloseTarget } = require('../../lib/feature-close');
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
a.ok(r240.ok && r240.branchName === 'feature-240-cx-demo' && r240.mode === 'multi-agent', 'feature 240: worktree branch must win over stale drive branch');

// REGRESSION feature 255 follow-up: remote-merged close must actually sync
// local main to origin/main rather than just switching branches and finishing.
const calls = [];
const okSync = syncRemoteMergedBranch(
    { branchName: 'feature-255-cc-x' },
    { getDefaultBranch: () => 'main', runGit: (cmd) => calls.push(cmd), getCurrentBranch: () => 'main', getGitStatusPorcelain: () => '' }
);
a.ok(okSync.ok, 'remote-merged close should succeed');
a.deepStrictEqual(calls.slice(0, 3), ['git checkout main', 'git fetch origin main', 'git reset --hard origin/main'], 'remote-merged close fetches and resets to origin/main');

const cleanupCalls = [];
cleanupWorktreeAndBranch(
    { branchName: 'feature-255-cc-x', keepBranch: false, worktreePath: null },
    {
        runGit: (cmd) => cleanupCalls.push(cmd),
        safeRemoveWorktree: () => true,
        getWorktreeStatus: () => '',
        forceDeleteBranch: true,
        deleteRemoteBranch: true,
    }
);
a.deepStrictEqual(
    cleanupCalls,
    ['git branch -D feature-255-cc-x', 'git push origin --delete feature-255-cc-x'],
    'remote-merged cleanup force-deletes local and remote feature branches'
);

const pushCalls = [];
pushRemoteMergedCloseCommit('main', { runGit: (cmd) => pushCalls.push(cmd) });
a.deepStrictEqual(pushCalls, ['git push origin main'], 'remote-merged close pushes the final close-state commit to origin/main');

console.log('ok feature-close-scan-target');
