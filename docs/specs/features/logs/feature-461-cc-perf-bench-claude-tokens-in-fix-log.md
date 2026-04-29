# Implementation Log: Feature 461 - perf-bench-claude-tokens-in-fix
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-30

### Fixes Applied
- 155c26c7 fix(review): keep claude bench token shape consistent

### Escalated Issues (exceptions only)
- None.

### Notes
- FIX_NOW: normalized Claude records now keep `billable` aligned with the cache-inclusive `input` value, and the perf-bench transcript fallback normalizes fresh-only Claude input before deriving `freshInputTokens`.
- `npm run test:iterate` passed after the review fix.
