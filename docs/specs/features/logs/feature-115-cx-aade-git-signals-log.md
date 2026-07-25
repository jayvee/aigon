# Implementation Log: Feature 115 - aade-git-signals
Agent: cx

## Plan
- Add a reusable git metrics helper in `lib/git.js` that computes:
  - commit count
  - lines added/removed/changed
  - unique files touched
  - fix commit count + ratio
  - rework flags (thrashing, fix cascade, scope creep)
- Integrate metrics calculation into `feature-close` so values are written to the winning implementation log frontmatter.
- Keep writes non-fatal: if metrics fail, close should still complete.
- Add unit coverage in `aigon-cli.test.js` for the git metrics helper.

## Progress
- Added `getFeatureGitSignals()` in `lib/git.js`.
  - Uses `git merge-base` + range analysis for branch metrics.
  - Uses `git log` to detect fix commits and consecutive fix cascades.
  - Uses `git diff --numstat` for line/file counts.
  - Uses `git log --name-only` frequency counting for thrashing detection.
- Added `feature-close` integration in `lib/commands/feature.js`.
  - Estimates expected scope size from the feature spec.
  - Computes git signals for the merged branch against the default branch.
  - Writes metrics as flat scalar fields into log frontmatter (create or update).
- Added helper tests in `aigon-cli.test.js` for:
  - metrics + rework detection
  - scope creep threshold logic
  - zeroed output when no commits are in range
- Ran syntax checks:
  - `node --check lib/git.js`
  - `node --check lib/commands/feature.js`
  - `node --check aigon-cli.test.js`
- Ran unit tests:
  - `node aigon-cli.test.js`
  - New git-signal tests passed.
  - Existing unrelated failures remain in this worktree.

## Decisions
- Implemented git metrics in `lib/git.js` (shared module) rather than inlining in `feature-close`, so logic can be reused and independently tested.
- Used a spec-derived scope baseline heuristic (inline file paths + acceptance criteria count) to satisfy `scope_creep` while keeping behavior deterministic.
- Kept git signal write failures non-blocking during `feature-close` to avoid risking workflow completion on analytics-only data.

## Code Review

**Reviewed by**: cc (Claude Opus 4.6)
**Date**: 2026-03-20

### Findings
1. **Critical: post-merge range produces all-zero metrics** — Git signals were computed after `git merge --no-ff`, at which point `defaultBranch` HEAD includes the merge commit. `git merge-base(defaultBranch, featureBranch)` returns the branch tip itself, producing an empty range. All metrics would be zero for every feature close.
2. **Minor: `_shellQuote` duplicates `shellQuote` in `lib/worktree.js`** — Acceptable since it's private and avoids a circular dependency.
3. **Minor: `range` variable not shell-quoted in `git log`/`git diff` commands** — Low risk since the range components come from git SHA output and validated refs, but inconsistent with the quoting applied elsewhere.

### Fixes Applied
- `216e2c8` — Capture pre-merge SHA of `defaultBranch` before the merge and pass it as `baseRef` to `getFeatureGitSignals()`, ensuring the commit range is computed correctly.

### Notes
- The `getFeatureGitSignals` core logic in `lib/git.js` is well-structured and thoroughly tested (3 unit tests covering metrics, scope creep, and empty range).
- The `estimateExpectedScopeFiles` heuristic is reasonable with its dual approach (inline code paths + AC count) and sensible cap at 8.
- Non-fatal error handling around git signals is correct — feature-close won't break if metrics fail.
