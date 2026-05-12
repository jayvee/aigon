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
