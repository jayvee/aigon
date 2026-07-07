# Implementation Log: Feature 620 - dash-arch-1-status-version-etag
Agent: cu

## Status
Server-side `statusVersion` + ETag/304 on `/api/status`; client sends `If-None-Match` and dropped F454 fingerprint gate.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-07

### Fixes Applied
- `1d9971b98 fix(review): complete conditional dashboard refresh`

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Manual `/api/refresh` now participates in the same ETag/304 contract as `/api/status`, including the client refresh path.
- The server fingerprint now includes the update-check fields used by the visible update pill, not just `updateCheck.state`.
