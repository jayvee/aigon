# Implementation Log: Feature 174 - workflow-read-path-simplification
Agent: cx

## Plan
- Execute `feature-do` workflow in this worktree and switch status to `implementing`.
- Remove dashboard-only feature action interpretation (`lib/feature-dashboard-model.js`).
- Consolidate active feature read behavior into `lib/workflow-read-model.js` so dashboard collector and detail payload consume one shared feature read path.
- Keep workflow snapshot (`.aigon/workflows/features/{id}/snapshot.json`) as the source for active lifecycle stage/actions.
- Run targeted validation suite from the feature spec plus syntax checks.

## Progress
- Verified workspace branch: `feature-174-cx-workflow-read-path-simplification`.
- Ran `node aigon-cli.js feature-do 174` to load active spec/log instructions.
- Ran `node aigon-cli.js agent-status implementing`.
- Refactored feature read path:
  - `lib/dashboard-status-collector.js` now calls `workflowReadModel.getFeatureDashboardState(...)` for both workflow-backed and fallback feature records.
  - `lib/dashboard-server.js` detail payload path now also calls `workflowReadModel.getFeatureDashboardState(...)`.
  - Deleted `lib/feature-dashboard-model.js` entirely.
  - Expanded `lib/workflow-read-model.js` to include feature review/eval runtime summaries (review state, eval status/session/path, winner projection) while keeping snapshot-derived actions authoritative.
- Validation executed:
  - `node -c lib/workflow-read-model.js`
  - `node -c lib/dashboard-status-collector.js`
  - `node -c lib/dashboard-server.js`
  - `node -c aigon-cli.js`
  - `node lib/workflow-snapshot-adapter.test.js`
  - `node lib/feature-spec-resolver.test.js`
  - `node lib/workflow-core/workflow-core.test.js`
  - `node lib/dashboard-server.test.js`
  - `node aigon-cli.js feature-list --active --json`
  - `node aigon-cli.js workflow-rules --json`
- Diff summary (`git diff --stat`):
  - 4 files changed
  - 186 insertions
  - 453 deletions
  - Net: **267 fewer lines**

## Decisions
- Chose consolidation over layering: removed `feature-dashboard-model.js` instead of adding another adapter.
- Kept one active-feature action interpreter: `workflowSnapshotAdapter.snapshotToDashboardActions(...)` via `workflowReadModel.getFeatureDashboardState(...)`.
- Preserved fallback behavior for non-workflow feature records (inbox/backlog/done visibility) through existing `state-queries` path, while keeping active lifecycle interpretation snapshot-first.
- Kept explicit review/eval runtime enrichment in the shared read model so both dashboard status collection and detail payload read from one domain-level feature state function.

## Code Review

**Reviewed by**: cc
**Date**: 2026-03-31

### Findings
- No issues found

### Fixes Applied
- None needed

### Notes
- All 115 tests pass (workflow-core 52, snapshot-adapter 39, dashboard-server 22, spec-resolver 2)
- Net deletion: ~234 lines (223 added, 457 deleted). Spec requirement for net subtraction met.
- The ~200 lines of duplicate action derivation (buildStageActions, mergeActions, SNAPSHOT_ACTION_MAP, guard resolution) were correctly deleted — snapshotToDashboardActions from workflow-snapshot-adapter already covers this.
- readFeatureReviewState and readFeatureEvalState were moved verbatim; no logic changes.
- All consumer fields match the new return shape; no dangling references to deleted module.
- Zero remaining imports of feature-dashboard-model anywhere in the codebase.
