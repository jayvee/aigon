# Implementation Log: Feature 654 - refactor-autonomous-plan-stage-status-into-single-progress-index
Agent: cu

## Status

Refactored `buildAutonomousStagePlan` to a linear progress-index model (`computeAutonomousProgressIndex`); added table-driven stage fixtures in workflow-read-model tests.

## Code Review

**Reviewed by**: op
**Date**: 2026-07-09

### Fixes Applied
- `50402c3b8` fix(review): use signals.implementFailed for implement stage failure in progress index — the refactor regressed implement-stage failure detection: `computeAutonomousProgressIndex` only called `findAutonomousStageFailure` (which returns false unless `autoState.status === 'failed'`), dropping the dashboard/snapshot agent 'error'/'failed' status check that the original code performed via `implementFailed`. An errored implementing agent would render the implement stage as 'waiting' instead of 'failed' until the conductor caught up. Restored by using `signals.implementFailed` for the implement stage boundary.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- The expanded `pastAutonomousStage` predicates for `review` and `revision` (which add `feedbackAddressed`, `reviewApprovedNoRevision`, `evalRunning`, `evalComplete` beyond the old per-stage complete sets) are equivalent in practice: those downstream signals can only be true when the immediate completion signal is also true in the stage shapes where they appear (revision only exists in solo close runs, eval only in fleet runs). This matches the spec's Technical Approach which explicitly lists these as boundary predicates.
- The progress-index model intentionally changes a contradictory edge case: if `implementFailed` is true (agent errored) but a downstream signal is also true (run advanced), the old code showed implement='failed' AND review='running' independently; the new model shows implement='failed' and all subsequent stages='waiting'. This is the intended behaviour per the spec's acceptance criteria ("Per-stage status is derived from position alone") and the contradictory state does not arise in practice (a failed implement agent blocks conductor advancement).

## Criteria Attestation

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
