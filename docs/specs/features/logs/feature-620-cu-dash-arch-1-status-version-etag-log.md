---
commit_count: 4
lines_added: 424
lines_removed: 89
lines_changed: 513
files_touched: 9
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
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
