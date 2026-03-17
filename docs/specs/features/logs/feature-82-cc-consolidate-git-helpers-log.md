---
status: submitted
updated: 2026-03-17T14:34:45.779Z
startedAt: 2026-03-17T14:15:35.490Z
events:
  - { ts: "2026-03-17T14:15:35.490Z", status: implementing }
  - { ts: "2026-03-17T14:19:50.568Z", status: implementing }
  - { ts: "2026-03-17T14:34:45.779Z", status: submitted }
---

# Implementation Log: Feature 82 - consolidate-git-helpers
Agent: cc

## Plan

Created `lib/git.js` as single source of truth for all git operations, then migrated each consumer file one at a time, replacing implementations with imports and inline `execSync('git ...)` calls with named functions.

## Progress

- Created `lib/git.js` with 15 exported functions: `run`, `getStatus`, `getStatusRaw`, `getCurrentBranch`, `getCurrentHead`, `getDefaultBranch`, `branchExists`, `listBranches`, `getCommonDir`, `listWorktreesPaths`, `listWorktrees`, `filterWorktreesByFeature`, `getChangedFiles`, `getCommitSummaries`, `getRecentDiff`, `ensureCommit`
- Updated `lib/utils.js`: removed implementations of `runGit`, `getWorktreeStatus`, `findWorktrees`, `filterByFeatureId`. Fixed 4 inline calls (lines 644, 1301, 1446, 1488). Added new git exports for `createAllCommands` scope.
- Updated `lib/validation.js`: removed `getCurrentHead`, `getGitStatusPorcelain`, `getChangedFilesInRange`, `getCommitSummariesInRange`. Simplified `ensureRalphCommit` to call `git.ensureCommit`. Fixed 3 inline calls (worktree list, branch detection, git diff).
- Updated `lib/board.js`: removed `getCurrentBranch` impl, moved `getWorktreeInfo()` to use `git.listWorktreePaths()`.
- Updated `lib/commands/shared.js`: spread `git` module into `createAllCommands` scope, added new functions to destructuring, replaced 9 inline git calls.
- All 156 tests pass. Validation grep confirms 0 inline `execSync('git ...)` calls remain in target files.

## Decisions

- **`ensureRalphCommit` stays in validation.js** as a thin wrapper around `git.ensureCommit()`. It handles ralph-specific message formatting while git.js handles the generic commit logic. This answers the open question in the spec.
- **New `listWorktreePaths()` added** for `board.getWorktreeInfo()` which needs all worktree types (feature + research) without the feature-specific filtering of `listWorktrees()`.
- **`getRecentDiff()` added** for the subjective validation context builder in validation.js, which needed the shell fallback pattern (`git diff HEAD~1 HEAD || git diff --cached || echo ""`).
- **`git` module spread into `createAllCommands` scope** (`...git`) so all new functions are automatically injectable for tests via the `overrides` parameter.
- **Backward compatibility maintained**: all old export names (`runGit`, `getWorktreeStatus`, `findWorktrees`, `filterByFeatureId`, `getCurrentBranch`, `getGitStatusPorcelain`, etc.) continue to work via thin wrappers or re-exports.
