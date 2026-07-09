# Implementation Log: Feature 652 - server-restart-after-lib-change-reliability
Agent: cu

## Status
Complete. Server poll-loop backstop consumes `.aigon/server/restart-needed.json`, shared detached restart helper, path-normalized marker I/O, and actionable `restartServerIfLibChanged` warnings.

## Criteria Attestation
1. met — log §Status documents root causes (a) F234 marker-by-design on dashboard close; (b) stderr ❌ 422 path skipped marker consumption before fix
2. met — tests/integration/feature-close-restart.test.js REGRESSION F652 cases (path, logging, TTL, backstop) added with fix
3. met — lib/dashboard-restart-backstop.js tick from afterPollSideEffects; SSE server-restarting + scheduleDashboardSelfRestart
4. met — RESTART_MARKER_TTL_MS 10min; isRestartMarkerStale + backstop warn/force; corrupt markers cleared
5. met — restartServerIfLibChanged warns on diff failure and missing registry; restart errors already warned
6. met — AIGON_INVOKED_BY_DASHBOARD branch unchanged; terminal close still calls restartServer directly

## New API Surface
- `lib/dashboard-self-restart.js`: `scheduleDashboardSelfRestart`
- `lib/dashboard-restart-backstop.js`: `createRestartBackstop`
- `lib/feature-close.js` exports: `normalizeMarkerRepoPath`, `restartMarkerPath`, `peekRestartMarker`, `consumeRestartMarkerFromCandidates`, `isRestartMarkerStale`, `RESTART_MARKER_TTL_MS`

## Key Decisions
- Backstop defers while `inflightActions.size > 0` so `/api/action` remains primary when a close is in flight.
- Single shared restart spawn path for action handler and backstop (DRY + identical SSE behaviour).

## Test Coverage
- `tests/integration/feature-close-restart.test.js` — F652 regressions for marker paths, logging, TTL, backstop.
