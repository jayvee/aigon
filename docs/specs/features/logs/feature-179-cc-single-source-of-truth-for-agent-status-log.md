# Implementation Log: Feature 179 - single-source-of-truth-for-agent-status
Agent: cc

## Plan
Subtraction sprint: remove the legacy state-queries action derivation path so
the workflow-core engine is the single source of truth for all agent status,
actions, and commands. Five phases: wire engine actions to dashboard, unify
command formatting, stop bypassing engine from commands, remove dashboard
mutations that bypass engine, clean up and validate.

## Progress
- Phase 1: `workflow-read-model.js` stripped to snapshot-only path (~90 lines removed).
  Removed `buildWorkflowStateContext`, `getWorkflowReadModel`, `getDashboardNextActions`,
  `getDashboardNextCommand`, `formatBoardCommand`, `buildActionReason`.
- Phase 2: Unified `formatDashboardActionCommand` and `formatBoardActionCommand` into
  single `formatActionCommand` in `action-command-mapper.js`. Board and dashboard now
  use identical command format (dashboard style with slash shortcuts).
- Phase 3: `feature.js` resume guard and fresh-start check now use engine snapshots
  (`showFeatureOrNull`) instead of raw event reads. `research.js` agent status checks
  use `readWorkflowSnapshotSync` instead of legacy `readAgentStatus`.
- Phase 4: `dashboard-server.js` mark-submitted and reopen-agent actions now emit engine
  signals (`emitSignal`, `restartAgent`) instead of writing agent status files directly.
  Removed `/api/spec` PUT endpoint.
- Phase 5: Removed `inferDashboardNextCommand`/`inferDashboardNextActions` from
  `dashboard-server.js`, `dashboard.js`, and `board.js`. Deleted `inferBoardAgents()`.
  Updated all test files to remove references to deleted functions. All 17 test suites pass.

## Decisions
- **Kept `state-queries.js` intact**: Despite spec suggesting removal of feature/research
  actions, `ENTITY_DEFINITIONS` is still needed by `SM_INVOCABLE_ACTIONS` (dashboard action
  allowlist), `shouldNotify()`, `getSessionAction()`, and `worktree.js` orphan detection.
  The spec's intent was achieved by removing the legacy path in `workflow-read-model.js`.
- **Chose dashboard format as unified format**: Dashboard commands use richer format with
  slash shortcuts (`/afe`, `/are`) and `--research` flags. Board previously used simpler
  format. Unified to dashboard format since it's more useful.
- **Used sync snapshot reads in research.js**: Research command handlers are sync arrow
  functions, so used `readWorkflowSnapshotSync` instead of async `showResearchOrNull`.
- **Net result**: -339 lines (446 removed, 107 added) across 10 files.
