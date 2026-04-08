#!/usr/bin/env node
// REGRESSION feature 245: feature-close security scan must run against the
// target worktree (the branch actually being merged), not the caller's cwd.
// Bug: running `feature-close <id> <agent>` from a main repo checked out on a
// stale sibling feature branch reported Semgrep findings from that sibling,
// blocking the close even though the target worktree branch was clean.
const a = require('assert');
const { mergeFeatureBranch, resolveScanCwd } = require('../../lib/feature-close');

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
const target = {
    branchName: 'feature-245-cc-x',
    agentId: 'cc',
    num: 245,
    worktreePath: process.cwd(), // exists
};
const result = mergeFeatureBranch(target, {
    getDefaultBranch: () => 'main',
    runGit: () => {},
    runSecurityScan: fakeScan,
});
a.ok(scanCall, 'mergeFeatureBranch called runSecurityScan');
a.strictEqual(scanCall.stage, 'featureClose', 'scan stage is featureClose');
a.strictEqual(scanCall.opts.cwd, process.cwd(), 'AC3: scan cwd == target worktreePath');
a.ok(!result.ok, 'scan failure still aborts the close');
a.ok(/security scan failure/.test(result.error || ''), 'error mentions scan failure');

const missingWtResult = mergeFeatureBranch({
    branchName: 'feature-245-cc-x',
    agentId: 'cc',
    num: 245,
    worktreePath: '/tmp/does-not-exist',
}, {
    getDefaultBranch: () => 'main',
    runGit: () => {},
    runSecurityScan: () => {
        throw new Error('runSecurityScan should not be called when the target worktree is missing');
    },
});
a.ok(!missingWtResult.ok, 'missing target worktree aborts the close');
a.match(missingWtResult.error || '', /Target worktree not found/, 'error explains missing worktree');

console.log('ok feature-close-scan-target');
