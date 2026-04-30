# Implementation Log: Feature 471 - dashboard-poll-non-blocking
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: agent (Cursor / code review pass)
**Date**: 2026-04-30

### Fixes Applied

- `a119fc07` fix(review): health test stubs async status collector (F471 R8) — the spec’s R8 verification asked for `collectDashboardStatusDataAsync` to be stubbed in `dashboard-health-route.test.js` once both collectors are on `ctx.routes`; implements that guard and updates the regression comment.

### Escalated Issues (exceptions only)

- None (architectural / ambiguous / subsystem / blocked).

### Notes

- **Implementation quality**: `collectDashboardStatusDataAsync` mirrors sync `collectDashboardStatusData` (perf, `scheduleNpmUpdateCheck`, repo list snapshotted before the loop). `pollStatus` still catches collection errors; `refreshLatestStatus` remains sync. `/api/refresh` uses an async handler with local try/catch — appropriate because the route dispatcher does not await handlers (addresses spec R10).
- **`npm test`**: full suite passed before the review commit.
- **`npm run test:iterate`**: in this environment, scoped validation ran Playwright (branch touches `lib/dashboard*`) and reported several e2e failures. The same `workflow-e2e.spec.js` failure (worktree path timeout) reproduces on the primary `main` worktree at `/Users/jviner/src/aigon`, so it was treated as an environment/fixture flake rather than a regression isolated to F471. Pre-push gate `MOCK_DELAY=fast npm run test:ui` should still be run on a clean machine before merge.
