---
commit_count: 6
lines_added: 274
lines_removed: 141
lines_changed: 415
files_touched: 20
fix_commit_count: 2
fix_commit_ratio: 0.333
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 172
output_tokens: 48701
cache_creation_input_tokens: 378009
cache_read_input_tokens: 15476802
thinking_tokens: 0
total_tokens: 15903684
billable_tokens: 48873
cost_usd: 33.958
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 240 - trace-and-eliminate-stale-drive-branches-for-solo-worktree-features
Agent: cc

## Root cause

Re-running `feature-start <id>` with no agents on an already-started
solo_worktree/fleet feature fell through the mode dispatcher in
`lib/commands/feature.js`. `resolveFeatureMode([])` returns
`SOLO_BRANCH`, which entered the drive-branch creation block and
created `feature-<num>-<desc>` alongside the real
`feature-<num>-<agent>-<desc>` worktree branch.

Then at close time, `resolveCloseTarget` in `lib/feature-close.js`,
when called as a bare `feature-close <id>` (no agentId), unconditionally
constructed `feature-<num>-<desc>` as the merge target — picking the
stale drive branch over the worktree branch that had the real work.

Observed evidence: branches for features 235/236/239 had both drive-
and worktree-style branches side by side.

## Fix

Two-layer guard + detection:

1. **Prevent creation** (`lib/commands/feature.js` feature-start):
   - Early return when the engine snapshot already exists and mode is
     `SOLO_WORKTREE` or `FLEET` with no agent args — prints a hint
     pointing to `feature-open <id>`.
   - Second guard after engine state is written but before the
     drive-branch block: consult the authoritative engine snapshot;
     if `engineIsWorktreeBased`, skip drive branch creation.

2. **Prevent selection of wrong branch** (`lib/feature-close.js`
   resolveCloseTarget):
   - When no agentId is passed and exactly one worktree exists for the
     feature, prefer the worktree branch. If the stale drive branch
     also exists, print a warning with the exact `git branch -D`
     command to clean it up.
   - When multiple worktrees exist, abort with "specify the agent".

3. **Detection** (`lib/commands/setup.js` doctor):
   - New `stale-drive-branch` check: scans local branches, groups by
     feature id, flags any drive-style `feature-<N>-<slug>` that shares
     a slug with a worktree-style `feature-<N>-<agent>-<slug>`, and
     prints recovery commands.

## Tests

- `tests/integration/feature-close-scan-target.test.js`: added a
  functional regression test for `resolveCloseTarget` with mocked git
  deps — asserts the worktree branch wins over a stale drive branch.
- `tests/integration/worktree-config-isolation.test.js`: added
  source-level regex regression checks for the feature-start guard,
  feature-close warning, and doctor detection.
- Wired `feature-close-scan-target.test.js` into `npm test` (was
  already a file but not in the script).
- Deleted orphaned `tests/integration/feature-close-spec-commit-scope.test.js`
  (83 lines, never in npm test script, never catching regressions).
- Updated a stale regex in the feature-create positional-description
  assertion to match the current parser shape.
- Final test budget: 1988 / 2000 LOC.

## Decisions

- **Two-layer fix vs. single-layer**: prevent creation at feature-start
  AND prevent selection at feature-close. Either layer alone would
  leave existing repos with stale branches in a broken state. The
  close-time preference heals them by merging the right branch and
  printing the exact cleanup command.
- **Doctor detection over auto-cleanup**: doctor reports but never
  deletes. Matches the "dashboard is read-only, users confirm
  destructive actions" project rule.
- **Engine snapshot as source of truth**: the feature-start guard
  consults `wf.showFeatureOrNull()` rather than inspecting branches
  directly, so fleet-mode features and solo_worktree features both
  guard correctly without mode-specific branching in the CLI.

## Pre-existing issues encountered

- `tests/integration/pro-gate.test.js` has 4 failing tests
  (`AIGON_FORCE_PRO=true/1/unset/garbage`). Verified unrelated to this
  feature via `git stash`.
- Test budget was already at 2062 LOC (over 2000 ceiling) before this
  feature started. Got back under by deleting an orphaned test file
  that was not in the npm test script and compacting local assertions.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-08

### Findings
- `lib/commands/setup.js`: the new stale-drive doctor check assumed any `feature-<id>-xx-...` branch was worktree-style, so a legitimate drive branch whose slug starts with a two-letter segment such as `ui-refresh` could be misclassified and stale branches could be missed.

### Fixes Applied
- `fix(review): avoid false negatives in stale drive branch detection`

### Notes
- Kept the implementation approach intact and only corrected the branch-shape matching logic used by `doctor`.
