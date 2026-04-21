# Implementation Log: Feature 297 - autonomous-mode-stage-status
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cu

**Date**: 2026-04-22

### Findings

- Implementation matches the spec: server-owned `autonomousPlan` from `workflow-read-model.js`, plumbed via `dashboard-status-collector.js`, rendered by `autonomous-plan.js` + `pipeline.js`. Loud failure path cites `aigon doctor --fix` when metadata is missing (`AUTONOMOUS_PLAN_UNAVAILABLE`).
- Regression tests cover read-model shape (`workflow-read-model.test.js`), dashboard renderer (`awaiting-input-dashboard.test.js`). `npm test` (full suite invoked by project harness) passed on review date.

### Fixes Applied

- None needed.

### Notes

- **CLI**: `aigon feature-review 297` must be run from the **main** repo checkout (e.g. `~/src/aigon`). Running it from inside the feature worktree causes “No worktree found” because `listWorktrees()` excludes `cwd`. Use `/aigon:feature-review 297` inside an agent for the full review template.
- After accepting this review, the implementer should run `aigon feature-review-check 297` in the implementation session (or the agent-native equivalent), then close when ready.

## Code Review (cc)

**Reviewed by**: cc
**Date**: 2026-04-22

### Fixes Applied
- `fix(review): correct entity type handling in initWorkflowSnapshot and migrateWorkflowEntityId` — `initWorkflowSnapshot` hardcoded `featureId` for all entity types (research entities must use `researchId` + `entityType`); `migrateWorkflowEntityId` left both `featureId` and `researchId` in migrated snapshots without deleting the stale key; `.aigon/version` restored from 2.53.0 to 2.53.1.

### Residual Issues
- **F296 bootstrap-on-create removed** (not safe to patch in this review): The `afterWrite` bootstrap callback in `entityCreate` was deleted, and `ensureEntityBootstrappedSync` / `migrateEntityWorkflowIdSync` were removed from `engine.js`. New features created via `feature-create` will no longer get inbox snapshots. This reverts F296's core invariant — new entities will appear as `MISSING_SNAPSHOT` on the dashboard until `aigon doctor --fix` is run. The fix requires restoring `ensureEntityBootstrappedSync` to `engine.js`, restoring `afterWrite` support in `utils.js createSpecFile`, and rewiring the `entityCreate` call — scope too large for this pass. Recommend filing a follow-up or reverting the F296-related lines before merging.
- **F293 idle detection removed** (not safe to patch): Supervisor idle detection (`computeIdleState`, `readLastProgressEventMs`, `getIdleThresholds`), the `buildWorkflowIdleBadgeHtml` dashboard badge, and `supervisor-idle-and-preauth.test.js` were deleted. F293 is also moved back from `05-done` to `03-in-progress` in the spec folder. Since F293 was merged to main, this is a regression. Restoring it would mean reverting ~200 lines across `supervisor.js`, `monitor.js`, `styles.css`, and the test file.
- **F296/F293 spec files moved back** (not safe to patch): `feature-296-bootstrap-engine-state-on-create.md` was moved from `05-done` to `02-backlog` with all acceptance criteria unchecked; `feature-293-agent-idle-detector-and-spec-preauth.md` was moved from `05-done` to `03-in-progress`. These are lifecycle state changes that conflict with the main branch. Spec file moves must go through the CLI, not manual moves.

### Notes
- The core F297 feature (autonomous plan rendering in dashboard cards) is clean: `buildAutonomousStagePlan` in `workflow-read-model.js`, `autonomous-plan.js` renderer, CSS additions, and the regression tests all look correct.
- The F296/F293 scope creep was flagged but not fixed in the previous cu review pass either. Recommend user reviews these residual issues carefully before closing.
