---
commit_count: 4
lines_added: 381
lines_removed: 3
lines_changed: 384
files_touched: 7
fix_commit_count: 2
fix_commit_ratio: 0.5
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---

# Implementation Log: Feature 261 - entity-repair-command

## Plan

Implement `aigon repair <feature|research> <id>` as a first-class command, keep the behavior conservative, and surface a dry-run diagnosis before any mutation.

## Progress

Added the command handler in `lib/commands/misc.js`, registered it in `lib/templates.js`, and added a regression test that checks registration and command metadata.

The implementation inspects visible spec state, workflow snapshots, runtime state files, heartbeats, sessions, worktrees, and branches. It prints a diagnosis and planned repair actions before doing anything.

I validated the command path with `node tests/integration/repair-command.test.js` and the full `npm test` suite.

I also smoke-tested the command in a throwaway worktree by creating a stale `.aigon/state` file for feature 261, then running `aigon repair feature 261` and approving the destructive cleanup prompt. That uncovered two wiring issues in the real branch: the misc wrapper did not export `repair`, and the repair handler needed a shared `getStateDir()` helper plus status filtering so repair-owned state did not count as dirty work.

## Decisions

- v1 scope is limited to `feature` and `research`.
- The command refuses to act when it sees dirty work or unmerged branches, rather than trying to guess.
- Destructive cleanup of stale worktrees or branches requires an explicit confirmation prompt.
- The command now avoids false "not found" errors when the entity exists but is already clean.
- The command must be exported through the misc compatibility wrapper and advertised in CLI help, not just the command factory.

## Code Review

**Reviewed by**: cc (Claude Code Opus)
**Date**: 2026-04-16

### Findings

1. **State/heartbeat cleanup ran unconditionally** — `stateFiles` and `heartbeatFiles` were removed regardless of whether the entity was actually done. Running `aigon repair feature 42` on an active in-progress feature would delete legitimate runtime state. The spec's repair policy and §3 ("remove stale `.aigon/state` files only when the authoritative lifecycle already proves they are stale") require gating on `doneSpecExists`.

2. **Branch deletion trapped inside worktree block** — The `branches.forEach(branch => git branch -D)` loop was nested inside `if (worktrees.length > 0)`, so stale branches for features with no remaining worktrees were never cleaned. This is a real scenario (worktree manually removed, branch left behind).

3. **Test not wired into `npm test`** — `repair-command.test.js` existed but was not in the test script in `package.json`. It passed when run directly but was invisible to CI and pre-push.

4. **Missing REGRESSION comment on test** — Per T2 rules, every test needs a one-line comment naming the specific regression it prevents.

5. **Test budget already exceeded** — The test suite is at 2626 LOC vs the 2000 ceiling. This predates the repair feature. Not blocking this review, but needs attention.

### Fixes Applied

- `3b775853` fix(review): gate state/heartbeat cleanup on done spec, fix branch deletion scope, wire test

### Notes

- The `visibleStage` derivation (lines 521-536) is a long chain of string-includes checks that duplicates folder-to-stage mapping already defined in `FEATURE_STAGE_FOLDERS` in setup.js. Not a bug, but a future simplification candidate.
- The `dirtyBranches` array is populated but only used in error output — it doesn't independently gate the refusal (that's handled by `unsafeBranchState`). The naming is slightly misleading but functionally correct.
