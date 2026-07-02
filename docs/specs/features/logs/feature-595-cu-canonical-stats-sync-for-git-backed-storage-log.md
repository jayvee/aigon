# Implementation Log: Feature 595 - canonical-stats-sync-for-git-backed-storage
Agent: cu

## Status
Implemented `stats.recorded` canonical events, git-ref projection rebuild on sync, storage doctor drift repair, and two-clone convergence test.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-02

### Fixes Applied
- c08eac990 fix(review): ignore volatile stats projection timestamp in event id
- 6a56465e1 fix(review): sync canonical stats after recording

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Fixed canonical stats idempotency so refreshed local `updatedAt` values do not create duplicate `stats.recorded` event IDs.
- Fixed the canonical stats writer to run post-write SpecStore sync, matching workflow event write semantics for `research-close` and direct stats recording.
