# Implementation Log: Feature 643 - module-graph-baseline-burndown
Agent: cu

## Status
Baseline 86→16 cycles (−70); config-cluster paths 39→0; F633 utils→dashboard-hub regressions eliminated; violations 23 (all justified in baseline); ratchet hardened (`--allow-growth` + `growthLog`).

## New API Surface
- `lib/safe-write.js`, `lib/binary-check.js` leaf modules
- `config-agent-layer.getAgent()`
- `check-module-graph.js --write-baseline --allow-growth <reason>`

## Key Decisions
- Removed `dashboard-server` re-export from `utils.js`; `infra.js` imports `runDashboardServer` directly
- Broke config cluster via `config-core` reads in agent-availability/quota-probe and `binary-check` leaf (not lazy-require hiding)
- `templates.js` imports `safe-write` instead of `utils` for `safeWrite`

## Gotchas / Known Issues
- Preview/server consumers of dashboard exports must import `dashboard-server` (or `config` for registry helpers), not `utils`

## Explicitly Deferred
- Remaining 16 cycles (spec-store/read-model/agent-availability hubs) — out of this feature's config/utils mandate

## For the Next Feature in This Set
- Burn down spec-store ↔ workflow-core cycle family (10-cycle hub)

## Test Coverage
- `module-graph-guard.test.js`: growth refusal + shrink allow paths
- `npm run test:iterate` green; preview `/api/health` + `/api/status` verified on :4179

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- 09e615394 fix(review): preserve config facade compatibility

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Restored the existing `config.isAgentDisabled()` facade export so this decoupling-only feature does not remove a reachable API.
- Updated `docs/architecture.md` for `safe-write`, `binary-check`, `config-core`, and the narrower `utils` facade responsibilities.
