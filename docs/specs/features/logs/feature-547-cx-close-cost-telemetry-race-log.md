# Implementation Log: Feature 547 - close-cost-telemetry-race
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-06-12

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- None.

### Notes
- Implementation matches the spec's preferred Aggregation-fix path (option 2): a
  single `getEffectiveNormalizedTelemetryRecords()` helper centralises the
  fallback-vs-real dedup keyed by `(agent, workflowRunId)`, with an agent-scope
  fallback when the fallback record's `workflowRunId` is null. Helper is reused
  from `feature-close.snapshotFinalStats`, `feature-status.collectCost`, and
  `telemetry.aggregateNormalizedTelemetryRecords` — three previous duplicates of
  the scan/sum loop collapse into one source of truth.
- Behaviour preservation verified: aggregate still excludes research records
  (helper defaults `entityType` to 'feature'), still treats empty/solo agent as
  match-any, and still honours the `afterMs` time-window filter.
- New regression test `snapshotFinalStats prefers real telemetry over earlier
  close fallback` exercises the race directly: fallback written first, real
  transcript record written after; asserts `sessions=1`, real `costUsd`, real
  model, `hasRealData=true`. Full `lifecycle.test.js` suite (14 tests) passes.
- The implementation-log body sections (Status / Key Decisions / Test Coverage)
  were left empty by the implementer — worth filling in during revise if the
  autonomous controller needs them, but not a code defect.
