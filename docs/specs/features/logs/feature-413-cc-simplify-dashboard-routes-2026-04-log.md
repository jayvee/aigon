# Implementation Log: Feature 413 - simplify-dashboard-routes-2026-04
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: Cursor (code review pass)

**Date**: 2026-04-28

### Fixes Applied

- `fix(review): wire lib/dashboard-routes.js to split route modules` (`deb4f6aa`) — Tracked `lib/dashboard-routes/*.js` modules existed but `lib/dashboard-routes.js` still contained the full monolith, so the split was unused at runtime. Replaced the entry file with the thin aggregator that spreads domain route arrays. Updated `tests/integration/token-window.test.js` to assert budget/token kickoff strings live in `lib/dashboard-routes/analytics.js` (moved from the monolith).
- `docs(review): add review notes to implementation log` (`2add9d37`)

### Residual Issues

- **None** for the route split. Playwright e2e (`MOCK_DELAY=fast npm run test:ui`) failed in this environment on several lifecycle/failure-mode specs (backlog card text not found, mock agent timeouts). `tests/dashboard-e2e/state-consistency.spec.js` passed; failures look like fixture/timing or environment drift rather than route wiring — re-run the full pre-push gate locally before push.

### Notes

- `npm test` on this worktree also reported failures in `static-guards` (unrelated `git add -A` in `lib/commands/setup.js` per template policy), `submit-signal-loss`, and `worktree-state-reconcile` — not introduced by the dashboard-routes change; confirm on `main` or fix separately if pre-push is red.
