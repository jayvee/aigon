# Implementation Log: Feature 567 - autonomous-controller-card-status
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-06-25

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Read-path is wired end to end: `buildAutonomousController` (workflow-read-model.js:110) → `featureState.autonomousController` → emitted in the API payload (dashboard-status-collector.js:916, 1021) and spread into `computeCardHeadline` at both call sites (939, 1025). All DTO field names consumed by `card-headline.js` and `pipeline.js` (`status`, `reason`, `reasonLabel`, `reasonCategory`, `error`, `updatedAt`, `endedAt`, `startedAt`, `sessionName`, `sessionRunning`) match the producer exactly.
- Reconciliation acceptance criterion satisfied: the failed-controller headline rule in `card-headline.js` sits above the stage-derived headline, so the card no longer shows "Review failed" and "Autonomous failed" as two top-line verbs. The autonomous-plan stage track still labels the failed stage "Failed" — that is complementary (shows *which* stage), not the contradictory top-line string the spec warned about.
- `statusMeta` in `buildAutonomousControllerStatusHtml` maps failed/running/stopped/completed/quota-paused; other real statuses (`starting`, `paused-on-failure`, `needs_attention`) fall through to the neutral `idle` tone with a humanised label — acceptable graceful default.
- Two deleted backlog specs in the diff (feature-586, feature-587) are not agent deletions: they were added to `main` *after* this worktree branched (absent at merge-base) and will return at merge. No action needed.
- Process gap (not code): the implementer left every log section above empty (Status / Key Decisions / Test Coverage etc.). Worth the implementer filling in before close, but not a code defect.
