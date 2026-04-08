---
commit_count: 8
lines_added: 272
lines_removed: 76
lines_changed: 348
files_touched: 49
fix_commit_count: 4
fix_commit_ratio: 0.5
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 73
output_tokens: 12952
cache_creation_input_tokens: 120243
cache_read_input_tokens: 3244999
thinking_tokens: 0
total_tokens: 3378267
billable_tokens: 13025
cost_usd: 8.0945
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 245 - feature-close-scan-target-branch
Agent: cc

## Summary
Fixed the merge-gate security scan in `feature-close` so it evaluates the
branch/worktree actually being merged, not whichever branch the caller's
main repo happens to be checked out on.

## Root cause
`mergeFeatureBranch` in `lib/feature-close.js` called
`runSecurityScan('featureClose')` with no `cwd`, so `createScanSnapshot`
diffed `default...HEAD` in `process.cwd()`. When the main repo was sitting
on a stale drive-style sibling branch while the close target was a live
worktree branch, the scan reported Semgrep findings from the sibling and
blocked the close even though the target worktree was clean.

`runSecurityScan` already accepted a `cwd` option; the bug was purely that
the close flow never passed one.

## Fix
1. Added `resolveScanCwd(target, cwd, fileExists)` — pure helper that
   returns `target.worktreePath` when it exists on disk, otherwise falls
   back to `cwd`. Exported so the selection logic is directly testable.
2. `mergeFeatureBranch` now calls `runScan('featureClose', { cwd: scanCwd })`
   with the resolved value, and logs `🔍 Scanning target: <path> (<branch>)`
   whenever the scan is redirected away from the caller's cwd (addresses
   the "diagnostic output" open question in the spec).
3. Made `runSecurityScan` injectable via the `deps` arg of
   `mergeFeatureBranch` so the wiring is unit-testable without spawning
   semgrep or building a real worktree.

## Why not also force `runSecurityScan` to always take an explicit target
Spec Open Question asked whether the snapshot should take
`{ baseRef, targetRef, stagedFromPath }`. Rejected for this feature — it
would touch every scanner call site and broaden scope. The current
`{ cwd }` contract already runs `git diff default...HEAD` plus staged
files in that dir, which is exactly the "committed + staged in target
worktree" semantics the AC requires. If `feature-submit` or
`research-close` prove to have the same bug, the fix is identical:
pass a `cwd`. Left for a follow-up feature if it surfaces.

## Plain Drive-branch mode
For `feature-close <id>` with no worktree, `target.worktreePath` is null,
`resolveScanCwd` returns `cwd`, and behaviour is unchanged — the user is
expected to be on the feature branch already (AC2).

## Tests
`tests/integration/feature-close-scan-target.test.js` — new, 42 LOC:
- `resolveScanCwd` returns worktreePath when it exists (AC1)
- falls back to cwd when worktreePath missing
- plain Drive branch (no worktree) returns cwd (AC2)
- null worktreePath falls through
- `mergeFeatureBranch` calls injected scan with `cwd: worktreePath` (AC3)
- scan failure still aborts the close

Each assertion tags the acceptance criterion it covers. File includes the
regression-comment header required by Rule T2.

Test suite: 1963 / 2000 LOC (+42 for the new test, well under ceiling).

## Validation
- `node -c lib/security.js` ✅
- `node -c lib/feature-close.js` ✅
- `node tests/integration/feature-close-restart.test.js` ✅
- `node tests/integration/feature-close-scan-target.test.js` ✅ (new)
- `npm test` — only pre-existing `pro-gate.test.js` failures
  (`AIGON_FORCE_PRO` handling, unrelated to this change; confirmed by
  running the suite with my changes stashed — same 3 passed / 4 failed).
- `bash scripts/check-test-budget.sh` ✅

## Files changed
- `lib/feature-close.js` — add `resolveScanCwd`, wire into
  `mergeFeatureBranch`, accept injectable `runSecurityScan`.
- `tests/integration/feature-close-scan-target.test.js` — new regression
  test for the fix.

## Manual Testing Checklist
1. From a clean main repo checkout on `main`, create a worktree-backed
   feature and run `aigon feature-close <id> <agent>` — scan should log
   `🔍 Scanning target: <worktree path>` and the close should proceed if
   the worktree is clean.
2. Reproduce the original bug: check out a stale sibling `feature-*`
   branch that has a Semgrep finding, then run
   `aigon feature-close <otherId> <agent>` for a different, clean
   worktree. The close should no longer be blocked by the sibling's
   findings.
3. Plain Drive branch: on a feature branch in the main repo, run
   `aigon feature-close <id>` with no worktree — behaviour unchanged, no
   "Scanning target" log line, scan diffs `default...HEAD` in cwd.
4. Scan-failure still blocks: introduce a real finding in the target
   worktree, run `feature-close <id> <agent>`, confirm the close aborts
   with `🔒 feature-close aborted due to security scan failure.`

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-08

### Findings
- `resolveScanCwd()` still fell back to the caller's `cwd` when a fleet branch resolved but its worktree path was missing, which could reintroduce the original false-positive scan against an unrelated checkout.

### Fixes Applied
- `452d7539` `fix(review): fail closed when target worktree is missing` — abort `feature-close` with a targeted error instead of scanning the wrong checkout, and extend the regression test to cover the missing-worktree case.

### Notes
- I only ran syntax checks (`node -c`) for the touched files, consistent with the review workflow's "do not run tests" constraint.
