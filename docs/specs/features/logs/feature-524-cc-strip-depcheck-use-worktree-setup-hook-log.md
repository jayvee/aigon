---
commit_count: 7
lines_added: 629
lines_removed: 1244
lines_changed: 1873
files_touched: 29
fix_commit_count: 1
fix_commit_ratio: 0.143
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 237
output_tokens: 85998
cache_creation_input_tokens: 589550
cache_read_input_tokens: 15067280
thinking_tokens: 0
total_tokens: 15743065
billable_tokens: 86235
cost_usd: 40.1084
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
Stripped `depCheck` profile injection from `feature-do` prompt; per-worktree setup now operator-declared via `.aigon/config.json` `worktreeSetup`. Brewboard/aigon-pro configs retrofitted (uncommitted in those repos — user to commit). Symlink form using `git rev-parse --git-common-dir` is doc default.

## Code Review

**Reviewed by**: cu
**Date**: 2026-05-12

### Fixes Applied

- `36ff65ad` — fix(review): clarify worktreeSetup comments near fleet hook

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- None.

### Notes

- Core acceptance checks hold: no `WORKTREE_DEP_CHECK` / `depCheck` / `dep-check.md` under implementation paths; `templates/generic/commands/feature-do.md` and rendered installs omit the dependency-install block; `static-guards.test.js` regression locks the wiring.
- Cross-repo retrofit (brewboard / aigon-pro) and brewboard fleet timing acceptance remain operator-owned outside this repo per implementation log.
