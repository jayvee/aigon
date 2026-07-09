---
commit_count: 0
lines_added: 0
lines_removed: 0
lines_changed: 0
files_touched: 0
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
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

## Code Review

**Reviewed by**: op
**Date**: 2026-07-09

### Fixes Applied
- dce7f5cdb — fix(review): inject `scheduleSelfRestart` dep into `createRestartBackstop` (defaults to `scheduleDashboardSelfRestart`). The backstop test previously stubbed `process.exit` across a `setTimeout` that fires ~150ms later — restoring `process.exit` in `finally` before the timer fires meant the real `process.exit(0)` could kill the test runner mid-suite. Test now passes a no-op `scheduleSelfRestart`. Also refreshed the stale JSDoc on `restartServerIfLibChanged` (no longer "silent on diff failure").

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Implementation is solid: marker I/O is properly path-normalized (`realpathSync.native` + resolve fallback), the stderr-422 path now consumes markers across candidate repo paths, the TTL helper treats missing/unparseable `at` as stale, and the backstop correctly defers while `/api/action` is in flight.
- Backstop wiring in `dashboard-server.js` is correct: `inflightActions`, `readConductorReposFromGlobalConfig`, `broadcastServerRestarting`, `log`/`log.warn`, and `CLI_ENTRY_PATH` are all in scope at the construction site (lines 502, 600–611). The `tick()` call is guarded with try/catch so a backstop failure can't break the poll loop.
- `consumeRestartMarkerFromCandidates` is reused by both the action route and (via the backstop's `collectRepoPaths` + `consumeRestartMarker`) the poll loop — consistent path normalisation across both consumers.
- One minor observation (not a fix): the action-route `restartMarker` consumption happens before the stderr-422 branch, so markers are consumed even on `result.ok === false` early-returns at line 204. That's pre-existing behaviour and arguably correct (close failed, but lib files may still have changed pre-failure); left as-is.
