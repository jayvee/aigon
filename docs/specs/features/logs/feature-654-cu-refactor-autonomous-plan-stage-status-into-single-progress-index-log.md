---
commit_count: 5
lines_added: 313
lines_removed: 31
lines_changed: 344
files_touched: 3
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
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

1. met — `computeAutonomousProgressIndex` returns `{ progressIndex, currentStatus }` with index in `[0, stages.length]` and status `running` / `failed` / `waiting` / `complete`.
2. met — `buildAutonomousStagePlan` maps stages with `index < progressIndex → complete`, `=== → currentStatus`, `> → waiting`.
3. met — Approved-review skip advances past revision; skipped stage renders `complete` (F524 regression + table-driven "approved review" fixture).
4. met — `pastAutonomousStage` / `isAutonomousStageRunning` collapse per-boundary predicates; ad-hoc per-stage branches removed.
5. met — `node tests/integration/workflow-read-model.test.js` — 30 passed, including F524 approved-review revision=complete.
6. met — Table-driven fixtures cover running implement/review, approved review, requested revision, running revision, running eval, eval complete, close running, close complete.
7. met — `lib/card-headline.js` unchanged; `node tests/unit/card-headline.test.js` — 26 passed.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
