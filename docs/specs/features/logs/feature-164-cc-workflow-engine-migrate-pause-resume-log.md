# Implementation Log: Feature 164 - workflow-engine-migrate-pause-resume
Agent: cc

## Plan

Migrate feature-pause and feature-resume to route through the workflow-core engine when engine state exists for a feature. Follow the same bridge module pattern established by workflow-close.js and workflow-start.js.

## Progress

- Added `resumeFeature()` to `lib/workflow-core/engine.js` (mirrors existing `pauseFeature()`)
- Created `lib/workflow-pause.js` bridge module with:
  - `isPauseEngineEnabled()` — feature flag check (config + env var)
  - `runWorkflowPause()` — emits `feature.paused` event, runs spec-move effect
  - `runWorkflowResume()` — emits `feature.resumed` event, runs spec-move effect
  - `getWorkflowPauseState()` — checks for engine state (null = legacy fallback)
  - `defaultPauseExecutor()` — idempotent spec file mover
- Modified `feature-pause` and `feature-resume` in `lib/commands/feature.js`:
  - Made handlers async
  - Added engine flag check + state detection
  - Routes through bridge when engine state exists
  - Falls back to legacy `requestTransition` path otherwise
- Confirmed snapshot adapter already maps paused state correctly
- Created `lib/workflow-pause.test.js` with 22 tests covering:
  - Feature flag logic
  - Effect building (pause + resume)
  - State detection
  - Full pause/resume lifecycle with spec moves
  - Idempotency of effect executor
  - Round-trip: pause then resume
- Updated CLAUDE.md module map and state architecture docs

## Decisions

- **No bootstrap from legacy**: Unlike workflow-close which synthesizes events from manifests, pause/resume simply falls back to legacy when no engine state exists. This is simpler and correct — if the feature wasn't started via the engine, there's no engine state to update.
- **Single bridge module**: Combined pause and resume into one `workflow-pause.js` file since they share the effect executor and state helper, and are conceptually paired.
- **Resume moves to in-progress (not backlog)**: The engine transition `paused → implementing` maps to the `03-in-progress` folder. The legacy path moves to `02-backlog` for historical reasons, but the engine path uses the semantically correct destination.
- **Single feature flag**: Both pause and resume share the `workflow.pauseEngine` flag since they're always used together.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-30

### Findings
- `feature-pause` and `feature-resume` treated engine-backed features as already complete once the lifecycle state flipped to `paused` or `implementing`, even if the spec-move effect was still pending. That broke the durability goal in the spec: rerunning the command after an interrupted effect would not resume execution.

### Fixes Applied
- Added pending-effect retry handling to `runWorkflowPause()` and `runWorkflowResume()`, so interrupted pause/resume operations resume their move effect instead of returning early.
- Updated the CLI handlers to retry from either side of the spec move and to honor `--reclaim` for pause/resume, matching the operator guidance in busy responses.
- Added regression tests covering interrupted pause and interrupted resume recovery.

### Notes
- `node --check lib/commands/feature.js` passed.
- `node lib/workflow-pause.test.js` passed.
- `npm test` still has pre-existing failures on this branch outside the reviewed change set.
