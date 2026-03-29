---
commit_count: 5
lines_added: 1125
lines_removed: 15
lines_changed: 1140
files_touched: 6
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 194
output_tokens: 25407
cache_creation_input_tokens: 700241
cache_read_input_tokens: 12986306
thinking_tokens: 0
total_tokens: 13712148
billable_tokens: 25601
cost_usd: 34.5174
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: 22.46
---
# Implementation Log: Feature 163 - workflow-engine-migrate-feature-eval
Agent: cc

## Plan

Migrate feature-eval to use the workflow-core engine following the established bridge pattern from workflow-close.js and workflow-start.js:
1. Create `lib/workflow-eval.js` bridge module
2. Integrate into the feature-eval command handler in `lib/commands/feature.js`
3. Write comprehensive tests
4. Update documentation (CLAUDE.md module map, state architecture section)

## Progress

- Created `lib/workflow-eval.js` (~300 lines) — full bridge module with:
  - `isEvalEngineEnabled()` — feature flag check (config + env var)
  - `synthesizeAgentReadySignals()` — bridges legacy manifest agent status to engine events
  - `runWorkflowEval()` — XState-guarded eval transition with durable effects
  - `buildEvalEffects()` — move_spec + write_eval_stub effects
  - `resumeEval()` — interrupted eval recovery
  - `defaultEvalExecutor()` — idempotent effect executor
  - `getWorkflowEvalState()` / `hasEngineState()` — state inspection helpers

- Modified `lib/commands/feature.js`:
  - Made feature-eval handler async
  - Added engine path: checks for engine state, synthesizes agent-ready signals, calls engine
  - Legacy fallback preserved when no engine state exists
  - Spec move remains idempotent (engine may have already moved it via effects)

- Created `lib/workflow-eval.test.js` — 28 tests, all passing:
  - Feature flag detection (5 tests)
  - Effect building (3 tests)
  - Engine state detection (4 tests)
  - Agent-ready signal synthesis (3 tests)
  - Guard enforcement — rejects when agents not ready (2 tests)
  - Successful eval with spec move (3 tests)
  - Resume interrupted eval (3 tests)
  - Default executor idempotency (4 tests)

- Updated `package.json` test script to include workflow-eval tests
- Updated `CLAUDE.md` module map and state architecture section

## Decisions

- **Bridge-prefixed effect IDs**: Used `bridge.eval.*` prefix (consistent with `bridge.start.*` and `bridge.close.*`) to avoid conflicts with engine's internal `materializePendingEffects`.

- **Agent-ready synthesis**: The bridge synthesizes `signal.agent_ready` events from legacy manifest status files before attempting the eval transition. This handles the transition period where features are engine-started but agents submit via the old `aigon agent-status` path.

- **Eval stub in workflow directory**: The `write_eval_stub` effect creates a marker file in `.aigon/workflows/features/{id}/eval-started.md` rather than the actual evaluation template. The evaluation template (with comparison tables, bias detection, etc.) is still created by the command handler itself because it depends on runtime context (worktree paths, agent names) that the engine doesn't have.

- **Idempotent spec move**: Even when the engine handles the spec move via effects, the legacy `moveFile()` call is kept in the command handler as a no-op safety net. This ensures the spec ends up in the right place regardless of which path ran.

- **No bootstrap-from-legacy needed**: Unlike workflow-close (which needed to synthesize all prior events), workflow-eval only needs engine state if the feature was started via the engine. Features without engine state simply use the legacy path.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-30

### Findings
- `runWorkflowEval()` could leave engine-started features stuck in `evaluating` with no pending effects if the process exited after `feature.eval_requested` was persisted but before the bridge's `effect.requested` events were written. A rerun then treated the feature as complete and skipped the spec move/eval-stub work entirely.

### Fixes Applied
- Added recovery logic in `lib/workflow-eval.js` to backfill missing eval effects when a rerun finds an `evaluating` feature with no pending effects.
- Added a regression test covering the interrupted transition window.

### Notes
- Focused validation passed: `node --check lib/commands/feature.js` and `node lib/workflow-eval.test.js`.
- `npm test` still reports broader suite failures in this worktree; they did not isolate cleanly to this review fix.
