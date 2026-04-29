---
commit_count: 4
lines_added: 41
lines_removed: 4
lines_changed: 45
files_touched: 3
fix_commit_count: 2
fix_commit_ratio: 0.5
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 85
output_tokens: 46907
cache_creation_input_tokens: 124342
cache_read_input_tokens: 3390525
thinking_tokens: 0
total_tokens: 3561859
billable_tokens: 46992
cost_usd: 2.1873
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
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
