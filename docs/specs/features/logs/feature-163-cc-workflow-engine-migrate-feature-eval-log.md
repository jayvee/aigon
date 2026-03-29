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
