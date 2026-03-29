# Implementation Log: Feature 139 - dashboard-read-from-workflow-snapshots
Agent: cc

## Plan

Make dashboard-server.js and board.js read from workflow-core snapshots when available, falling back to the legacy manifest/state-machine path. Create a thin read adapter module that maps snapshot data to existing dashboard/board formats.

## Progress

- Created `lib/workflow-snapshot-adapter.js` (~260 lines) — read adapter with:
  - `readFeatureSnapshotSync()` / `readFeatureSnapshot()` — side-effect free snapshot reads
  - `snapshotToStage()` — lifecycle → dashboard stage mapping
  - `snapshotAgentStatuses()` — workflow agent status → dashboard status mapping
  - `snapshotToDashboardActions()` — available actions → dashboard command format
  - `snapshotToBoardCommand()` — available actions → board CLI command
- Integrated into `lib/dashboard-server.js`:
  - `collectDashboardStatusData()` reads workflow snapshot per feature (when present)
  - Overlays agent statuses from snapshot onto dashboard agent objects
  - Prefers snapshot-derived `nextAction`, `nextActions`, `validActions`
  - Adds `workflowEngine` field (`'workflow-core'` or `'legacy'`) to each feature
  - Overrides `winnerAgent` from snapshot when available
- Integrated into `lib/board.js`:
  - `getBoardAction()` checks for workflow snapshot before falling back to legacy state machine
- Created `lib/workflow-snapshot-adapter.test.js` (39 tests) covering:
  - Lifecycle → stage mapping (all states + edge cases)
  - Agent status mapping (all statuses)
  - Dashboard action formatting and padding
  - Board command generation (including skip of non-board actions)
  - Sync/async snapshot reads (including missing/corrupted files)
  - Consistency between dashboard and board consumers
  - Side-effect freedom (no file mutations during reads)
- Updated CLAUDE.md Module Map with new module

## Decisions

- **Selective imports from workflow-core**: Import only from `workflow-core/paths` and `workflow-core/types` to avoid pulling in `xstate` dependency. The adapter only needs path computation and type constants, not the engine or actions module.
- **Sync reads in dashboard**: Used `readFeatureSnapshotSync()` because `collectDashboardStatusData()` is synchronous. The snapshot files are small JSON, so sync reads are fine.
- **Status overlay, not replacement**: When a snapshot exists, its agent statuses override the dashboard status field, but all runtime info (tmux sessions, worktree paths, dev server URLs) still comes from existing probes. The snapshot knows about lifecycle state; the dashboard still needs to know about runtime state.
- **workflowEngine field**: Added to each feature object so the dashboard frontend can indicate the data source if desired (answers the open question about visibility).
- **Graceful degradation**: Corrupted/missing snapshots silently fall back to legacy. No crashes, no partial states.
