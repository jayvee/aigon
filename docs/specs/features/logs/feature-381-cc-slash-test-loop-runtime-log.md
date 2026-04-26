# Implementation Log: Feature 381 - slash-test-loop-runtime
Agent: cc

## Status
Implemented: scoped iterate runner (`lib/test-loop/scoped.js`, ~2s vs prior ~5–10min) + parallel test runner (`scripts/run-tests-parallel.js`, full `npm test` 17.6s) + smoke fallback (5 tests) + spec/agent-doc updates. Playwright pre-existing failure on main (server boot timeout) — pre-authorised skip per spec.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Cursor agent)
**Date**: 2026-04-26

### Fixes Applied
- `fix(review): restore F380 spec and broaden iterate diagram gate` — removed unrelated `feature-380` backlog stub + in-progress deletion from the F381 branch; restored `docs/specs/features/03-in-progress/feature-380-aigon-profile-sync.md` from `main`. Updated `lib/test-loop/scoped.js` so workflow diagram `--check` runs when any `templates/` path changes (per acceptance criteria), not only template paths containing the substring `workflow`.

### Residual Issues
- **Smoke vs. “server boot”**: the curated smoke set does not include a dashboard/server boot integration test; the spec’s smoke list called out “server boot smoke” as desirable. Acceptable gap unless product wants that file added to the ≤5 set (would add iterate-loop time).
- **`summariseResult` on zero-step pass**: when `getChangedPaths` returns empty, `ranSteps` is empty and the summary line has no step segments (cosmetic only).

### Notes
- Implementation otherwise matches the two-tier gate split (`test:iterate` vs pre-push), parallel runners without new deps, and `validation.js` wiring for `test:iterate`.
- `templates/specs/feature-template.md` is the correct template source (`readTemplate('specs/feature-template.md')` in `feature-create`), despite the spec prose mentioning `feature-create.md`.
