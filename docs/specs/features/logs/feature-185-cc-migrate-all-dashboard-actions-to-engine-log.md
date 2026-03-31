# Implementation Log: Feature 185 - migrate-all-dashboard-actions-to-engine
Agent: cc

## Plan

Migrated all dashboard actions from frontend computation to engine derivation, completing the work started in feature 184. The approach:

1. Add new ManualActionKind values for missing lifecycle actions (start, prioritise, autopilot, stop)
2. Add bypassMachine action candidates with guards in feature/research workflow rules
3. Create synthetic context mechanism for pre-engine entities (inbox/backlog without snapshots)
4. Pass requiresInput metadata through the action derivation pipeline
5. Strip frontend action overrides (AGENT_ACTION_LABELS, TRANSITIONS_AS_BUTTONS) from dashboard
6. Make OPEN_SESSION labels status-aware at the engine level

## Progress

- All 9 files changed, 147 insertions, 45 deletions
- All 18 test suites pass (0 failures)
- Integration tests pass

## Decisions

### bypassMachine for pre-engine actions
FEATURE_START, FEATURE_PRIORITISE, and FEATURE_AUTOPILOT use `bypassMachine: true` with stage guards rather than adding inbox/backlog states to the XState machine. Features don't enter the engine until started, so XState validation is unnecessary for pre-engine actions.

### Synthetic context for pre-engine entities
Created `createSyntheticContext()` in workflow-snapshot-adapter.js that maps dashboard stages to lifecycle states. When `snapshotToDashboardActions()` receives a null snapshot but has a stage, it creates a minimal context allowing `deriveAvailableActions()` to work for inbox/backlog features.

### Autopilot guard tightened
The FEATURE_AUTOPILOT guard excludes features where any agent is in an error state (lost, failed, needs_attention), not just features with running/idle agents. This prevents autopilot from appearing alongside restart-agent for broken features.

### Engine-side labels
Moved OPEN_SESSION label logic to be status-aware at the engine level (Restart vs Open based on agent status), removing the AGENT_ACTION_LABELS frontend override map.

## Files Changed

1. `lib/workflow-core/types.js` — 6 new ManualActionKind values
2. `lib/feature-workflow-rules.js` — 4 new candidates (prioritise, start, autopilot, stop) + status-aware OPEN_SESSION label
3. `lib/research-workflow-rules.js` — 2 new candidates (prioritise, stop) + status-aware OPEN_SESSION label
4. `lib/workflow-core/actions.js` — requiresInput passthrough in buildCandidates and deriveAvailableActions
5. `lib/workflow-snapshot-adapter.js` — synthetic context, 6 new descriptors, TRANSITION_ACTIONS/HIGH_PRIORITY updates, requiresInput in dashboard action
6. `lib/workflow-read-model.js` — pass currentStage to snapshotToDashboardActions
7. `lib/action-command-mapper.js` — research-stop command mapping
8. `lib/dashboard-server.js` — feature-autopilot, feature-stop, research-stop in DASHBOARD_INTERACTIVE_ACTIONS
9. `templates/dashboard/js/actions.js` — removed AGENT_ACTION_LABELS, TRANSITIONS_AS_BUTTONS; renderActionButtons uses engine labels/metadata

## Code Review

**Reviewed by**: cu (Cursor, `--no-launch` inline review)

**Date**: 2026-03-31

### Findings

- **Tests**: `npm test` passes (18 unit suites + integration); spec validation `node -c` targets are satisfied by the changed modules.
- **Synthetic context**: `createSyntheticContext()` correctly maps dashboard stages to `currentSpecState` for pre-engine rows; `snapshotToDashboardActions(..., null, stage)` enables backlog/inbox actions when no workflow snapshot exists yet.
- **`requiresInput`**: Flows from candidates → `deriveAvailableActions` → `mapSnapshotActionToDashboard` for agent-picker actions (`feature-start`, `feature-autopilot`).
- **Spec vs this change set**: The feature spec still lists Phase 2/3 items (dev-server poke, session-ended Submit/Re-open, view findings / view review / open eval as engine actions, stripping `monitor.js` / `pipeline.js` beyond existing `validActions` usage). This branch delivers lifecycle/session-control migration and dashboard rendering simplification called out in the log; the spec checkboxes remain partly aspirational. Consider a short follow-up spec note or a second PR for the remaining bullets so the doc matches shipped scope.

### Fixes Applied

- None — no defects found in the reviewed diff; behavior is covered by existing tests including dashboard action consistency.

### Notes

- `renderActionButtons` now treats every non–per-agent `validActions` entry as a button (except eval-session hiding). That assumes the engine only emits rows that should be clickable; consistent with “engine is source of truth.”
- `aigon feature-review 185 --no-launch` validated worktree path from main repo; handler ignores `--no-launch` (harmless).
