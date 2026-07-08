# Implementation Log: Feature 634 - be-arch-6-telemetry-provider-registry
Agent: cu

## Status
Split `lib/telemetry.js` into `lib/telemetry/` package (core, pricing, sqlite, capture, providers/cc|gg|ag|cx|op + registry); lazy facade preserves module-graph cycle count; session-sidecar path resolution unchanged.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- 73c9821a5 fix(review): restore telemetry provider dispatch guards

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Restored the F633 dashboard-collect module-boundary guard while keeping the new F634 telemetry provider guard.
- Added the missing Claude `parseTranscripts` provider contract path so registry dispatch for `claude-transcript` remains reachable.
