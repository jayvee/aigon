#!/usr/bin/env node
// REGRESSION feature 245: feature-close security scan must run against the
// target worktree (the branch actually being merged), not the caller's cwd.
// Bug: running `feature-close <id> <agent>` from a main repo checked out on a
// stale sibling feature branch reported Semgrep findings from that sibling,
// blocking the close even though the target worktree branch was clean.
const a = require('assert');
const { mergeFeatureBranch, resolveScanCwd } = require('../../lib/feature-close');

// resolveScanCwd: worktree wins when it exists, falls back to cwd otherwise.
a.strictEqual(
    resolveScanCwd({ worktreePath: '/tmp/wt' }, '/repo', () => true),
    '/tmp/wt',
    'AC1: worktree-backed close scans the worktree path'
);
a.strictEqual(
    resolveScanCwd({ worktreePath: '/tmp/wt' }, '/repo', () => false),
    '/repo',
    'falls back to cwd when worktreePath is missing on disk'
);
a.strictEqual(
    resolveScanCwd({}, '/repo', () => true),
    '/repo',
    'AC2: plain Drive branch (no worktree) scans current checkout'
);
a.strictEqual(
    resolveScanCwd({ worktreePath: null }, '/repo', () => true),
    '/repo',
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

console.log('ok feature-close-scan-target');
