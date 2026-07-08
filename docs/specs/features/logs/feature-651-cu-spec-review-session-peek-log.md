# Implementation Log: Feature 651 - spec-review-session-peek
Agent: cu

## Status
Implemented spec-review/spec-revision session peek+open on all card layouts, pending-review callout, `/api/peek` spec-role resolution, and `sessionRunning` on read-model rows.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: codex

**Date**: 2026-07-09

### Fixes Applied
- 47c38aa43 `fix(review): preserve code review open buttons`

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Kept the spec-review session liveness change scoped to spec-review rows; code-review Open buttons still fall back to the existing running-state behavior.
