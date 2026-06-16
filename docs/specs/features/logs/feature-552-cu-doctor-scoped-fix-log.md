# Implementation Log: Feature 552 - doctor-scoped-fix
Agent: cu

## Status
Implemented scoped flags (`--auth`, `--ports`, `--verbose`/`--full`) and interactive `--fix` via `lib/doctor/scopes.js` + `fix-dispatch.js`; batch `--fix --yes` unchanged.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

---

## Code Review

**Reviewed by**: cc
**Date**: 2026-06-16

### Fixes Applied
- `2d9a0ab2` fix(review): await async apply() in batch mode and add batchFix to scoped early-returns

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `queueFix()` was calling `item.apply()` inline when `batchFix=true`, but callers never awaited the return value. Async apply functions (migrations, install-manifest init) would fire-and-forget, potentially racing with process exit. Fixed by routing all batch dispatch through `runFixDispatch({ yes: true })` which properly awaits each apply in sequence.
- Both scoped early-return blocks (`doAuthOnly`, `doctorScope === 'ports'`) were missing a `batchFix` branch — `--auth --fix --yes` and `--ports --fix --yes` would have silently no-oped on fixes (no dispatch, no summary). Fixed with parallel `else if (batchFix)` branches.
- Overall architecture is clean: `scopes.js` and `fix-dispatch.js` are well-isolated, tests cover the critical paths, and the backwards-compat requirement (`--fix --yes` = batch, no prompts) is preserved.
