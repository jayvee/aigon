# Implementation Log: Feature 178 - unified-workflow-engine
Agent: cx

## Plan
- Remove the dedicated sync research engine path and move research lifecycle writes into `lib/workflow-core/engine.js`.
- Add async research workflow APIs plus entity-level wrappers for unified surface area.
- Switch research command handlers to async workflow-core APIs.
- Add explicit migration helpers for pre-cutover feature/research lifecycle backfill.
- Extend heartbeat sweeping so research snapshots are included.
- Remove duplicate heartbeat observation logic from `supervisor.js`.
- Update docs/tests and validate with syntax checks plus full `npm test`.

## Progress
- Added research orchestration to `lib/workflow-core/engine.js`:
  - `startResearch`, `showResearch`, `showResearchOrNull`, `requestResearchEval`, `closeResearch`
  - `startEntity`, `showEntity`, `showEntityOrNull`, `requestEntityEval`, `closeEntity`
  - `emitResearchSignal` and entity-aware `emitSignal(..., { entityType })`
- Added `lib/workflow-core/migration.js` with explicit/idempotent migration helpers:
  - `migrateEntityLifecycleIfNeeded`
  - `migrateActiveEntities`
- Updated `lib/workflow-core/index.js` exports and deleted `lib/workflow-core/research-engine.js`.
- Updated `lib/commands/research.js` to async engine calls (no `*Sync()` usage).
- Replaced feature-close bootstrap branch with explicit migration call in `lib/commands/feature.js`.
- Updated heartbeat sweep in `lib/workflow-heartbeat.js`:
  - Backward-compatible per-feature sweep still works.
  - New all-entity sweep path includes research workflow snapshots.
- Removed duplicate heartbeat-state file scan in `lib/supervisor.js`.
- Updated docs:
  - `AGENTS.md` module map includes workflow migration module.
  - `docs/architecture.md` reflects unified feature+research engine and explicit migration boundary.
- Updated tests to match async unified API behavior:
  - `tests/unit/workflow-core.test.js`
  - `tests/unit/aigon-cli.test.js`
- Validation run:
  - `node -c aigon-cli.js`
  - `node -c lib/workflow-core/engine.js`
  - `node -c lib/workflow-heartbeat.js`
  - `test ! -f lib/workflow-core/research-engine.js`
  - `npm test` (pass)

## Decisions
- Kept the feature close claim/reclaim durable effect loop unchanged; research close uses the same effect event model (`effect.requested` + `move_spec`) but executes through the new async research path in unified engine code.
- Added explicit migration utilities instead of hidden command-layer bootstrap synthesis so compatibility behavior is isolated and removable.
- Preserved backward compatibility for existing heartbeat callers while extending the sweep interface to include research entities.

## Code Review

**Reviewed by**: cc (Claude Opus 4.6)
**Date**: 2026-03-31

### Findings
1. **Async test not awaited (bug)**: `research-eval --force` test in `aigon-cli.test.js` was converted from `assert.throws` (sync) to `assert.doesNotThrow`, but `research-eval` is now async. The returned Promise was never awaited, so the test passed trivially without verifying migration behavior. The test file also lacked `testAsync` and async runner support.

### Fixes Applied
- `fix(review): make research-eval test async to actually verify migration` — added `testAsync` helper, converted test to properly `await` the async command, added `setTimeout` runner pattern (matching `workflow-core.test.js` convention) so async test results are captured before `process.exit`.

### Notes
- The implementation is solid overall. The engine unification, migration module, heartbeat generalization, and supervisor cleanup all align with the spec.
- `runFeatureEffect` is used for research close effects — this works because research only emits `move_spec` effects, which are entity-agnostic. If research gains entity-specific effects later, a research effect executor would be needed.
- `applyResearchTransition` contains ~150 lines of signal-handling logic that mirrors the feature projector. This is functional duplication (not a bug), and the spec explicitly says not to change the XState machine definitions, so this is the correct approach for now.
- `sweepAgentRecovery` remains feature-only — the spec didn't require research agent recovery, and extending it is a natural follow-up.
