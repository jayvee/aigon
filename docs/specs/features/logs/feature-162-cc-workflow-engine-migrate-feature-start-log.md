# Implementation Log: Feature 162 - workflow-engine-migrate-feature-start
Agent: cc

## Plan

Follow the established bridge pattern from `lib/workflow-close.js`:
1. Create `lib/workflow-start.js` bridge module with feature flag, engine call, custom effect executor, and resume support
2. Integrate into `lib/commands/feature.js` feature-start handler behind `workflow.startEngine` config flag
3. Write legacy manifest for backward compatibility with agent status files
4. Write comprehensive tests following the `workflow-close.test.js` pattern
5. Update CLAUDE.md documentation (module map + state architecture section)

## Progress

- Created `lib/workflow-start.js` (~290 lines) — bridge module with:
  - `isStartEngineEnabled()` — config flag + env var check
  - `resolveMode()` — determines FeatureMode from agent count
  - `runWorkflowStart()` — main entry point, handles fresh start and resume detection
  - `buildStartEffects()` — constructs move_spec + init_log effects with bridge-prefixed IDs
  - `resumeStart()` — resumes interrupted start with pending effects
  - `defaultStartExecutor()` — idempotent effect executor for move_spec and init_log
  - `getWorkflowStartState()` — checks for existing engine state
  - `writeLegacyManifest()` — writes manifest for agent status file compatibility
- Modified `lib/commands/feature.js`:
  - Made feature-start handler async (dispatcher already supports async handlers)
  - Added engine path gated behind `useStartEngine` flag
  - Engine handles state creation, spec move, and log creation as durable effects
  - Legacy path preserved unchanged when flag is off
  - Worktree creation, tmux sessions, terminal opening remain in the handler (operational concerns)
  - `completePendingOp` calls skipped when engine is active (engine tracks effects)
- Created `lib/workflow-start.test.js` — 30 tests covering:
  - Feature flag (config + env var override)
  - Mode resolution (solo_branch, solo_worktree, fleet)
  - Effect building (move_spec, init_log per agent, drive mode)
  - Start state detection (empty, implementing, pending effects)
  - Full start flows (solo worktree, fleet, drive, already-in-progress)
  - Resume flows (pending effects, no pending, wrong state)
  - Effect executor (move_spec, init_log, idempotence)
  - Legacy manifest writing
- Updated `package.json` to include workflow-start tests in npm test script
- Updated `CLAUDE.md` module map and state architecture docs

## Decisions

- **No bootstrap-from-legacy needed**: Unlike workflow-close which must synthesize events for features started under the old system, feature-start creates engine state from scratch. This is the key architectural advantage of migrating start first.
- **Bridge-prefixed effect IDs**: Used `bridge.start.*` prefix to avoid conflicts with engine's internal `buildEffects()` which creates `feature.start.ensure_layout` effects. This follows the pattern established by workflow-close.
- **Handler made async**: The feature-start handler was synchronous but the engine API is async. The CLI dispatcher at `aigon-cli.js:33-39` already handles async handlers by catching Promise rejections. This is safe — feature-close already uses async.
- **Worktree creation stays in handler**: The engine handles state and lightweight effects (spec move, log creation). Worktree creation, tmux sessions, and terminal opening are operational concerns that remain in the handler — they're too complex and environment-dependent to wrap as engine effects at this stage.
- **Legacy manifest with empty pending**: When the engine is active, the legacy manifest is written with `pending: []` since the engine owns effect tracking. This ensures agent status files continue to work without confusing the legacy outbox replay mechanism.
