# Implementation Log: Feature 652 - server-restart-after-lib-change-reliability
Agent: cu

## Status
Complete. Server poll-loop backstop consumes `.aigon/server/restart-needed.json`, shared detached restart helper, path-normalized marker I/O, and actionable `restartServerIfLibChanged` warnings.

## Criteria Attestation
- Root cause (a) F628: dashboard `feature-close` sets `AIGON_INVOKED_BY_DASHBOARD=1` → `restartServerIfLibChanged` **by design** writes a marker instead of calling `restartServer()` (F234 EPIPE guard). Not a regression in close itself.
- Root cause (b) F622 marker orphan: `/api/action` consumed the marker **after** a stderr `❌` early-return (exit 0 but warning text tripped the 422 path), so restart never scheduled. Hypothesis confirmed in code review; fix moves consumption before that check and still schedules restart on 422 when a marker exists. `consumeRestartMarkerFromCandidates` also normalizes paths via `realpathSync.native`.
- Reproducer tests added in `tests/integration/feature-close-restart.test.js` (path round-trip, logging, TTL, backstop tick) before/alongside fixes.
- Self-heal backstop: `lib/dashboard-restart-backstop.js` ticked from `afterPollSideEffects` in `lib/dashboard-server.js`; broadcasts `server-restarting` SSE then uses `lib/dashboard-self-restart.js`.
- Stale markers: `RESTART_MARKER_TTL_MS` (10 min); backstop warns and forces restart when TTL exceeded; corrupt markers cleared with warning.
- `restartServerIfLibChanged` now warns on diff failure and missing registry entry (restart errors were already warned).
- F234 preserved: dashboard subprocess still writes marker only; direct `restartServer()` only from terminal context.

## New API Surface
- `lib/dashboard-self-restart.js`: `scheduleDashboardSelfRestart`
- `lib/dashboard-restart-backstop.js`: `createRestartBackstop`
- `lib/feature-close.js` exports: `normalizeMarkerRepoPath`, `restartMarkerPath`, `peekRestartMarker`, `consumeRestartMarkerFromCandidates`, `isRestartMarkerStale`, `RESTART_MARKER_TTL_MS`

## Key Decisions
- Backstop defers while `inflightActions.size > 0` so `/api/action` remains primary when a close is in flight.
- Single shared restart spawn path for action handler and backstop (DRY + identical SSE behaviour).

## Test Coverage
- `tests/integration/feature-close-restart.test.js` — F652 regressions for marker paths, logging, TTL, backstop.
