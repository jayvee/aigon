# Implementation Log: Feature 462 - benchmark-matrix-per-op-restructure
Agent: cc

Restructured `aigon-pro/dashboard/benchmark-matrix.js` for per-op column blocks (Time/Tokens In/Tokens Out/$/Quality/Last Run/Value × Implementation+Review), namespaced sort ids `op:<kindId>:<field>`, derived Value = Q/(cost_norm × time_norm) with [0.05,1] clamp; CSS additions in `templates/dashboard/styles.css`; verified live in dashboard via Playwright (header spans, sort cycles, per-op Last Run independence).

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-30

### Fixes Applied
- 0a1615b4 fix(review): restore unrelated spec files

### Escalated Issues (exceptions only)
- ESCALATE:blocked — The Pro renderer depends on `tokenUsage` and `quality` being exposed by `aigon-pro/lib/benchmark-artifacts.js`, but `/Users/jviner/src/aigon-pro` is on `main` and the required artifact-reader/test changes are currently dirty there, not committed in a feature worktree. The active OSS feature worktree cannot safely commit that Pro-side API wiring.
- ESCALATE:blocked — `aigon-pro/dashboard/benchmark-matrix.js` sorts null values first when a numeric column is sorted descending (`sortRows` returns `dir` for `av == null`), so columns like `Review > Quality` or `Review > Value` can put rows with `--` above real scores. This is in the Pro repo on `main`, not the active feature worktree, so it was not patched here.

### Notes
- The OSS branch now only contains the benchmark CSS/log changes plus the review restoration commit; unrelated deletions and research rollback from the original diff were removed from scope.
