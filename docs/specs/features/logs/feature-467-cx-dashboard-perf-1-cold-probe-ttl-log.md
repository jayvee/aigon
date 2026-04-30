---
commit_count: 6
lines_added: 186
lines_removed: 21
lines_changed: 207
files_touched: 5
fix_commit_count: 1
fix_commit_ratio: 0.167
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 1796199
output_tokens: 8261
cache_creation_input_tokens: 0
cache_read_input_tokens: 1677696
thinking_tokens: 2754
total_tokens: 1804460
billable_tokens: 1807214
cost_usd: 3.994
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 467 - dashboard-perf-1-cold-probe-ttl
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage


## Code Review

**Reviewed by**: cu
**Date**: 2026-04-30

### Fixes Applied
- `a5825f42` fix(review): scoped probe TTL invalidation; restore worktree spec sync

### Escalated Issues (exceptions only)
- **ESCALATE:subsystem** — `npm run test:iterate` invoked Playwright (dashboard-status-collector in diff); 8 e2e tests failed locally (brewboard fixture duplicate `feature-01-*`, tmux mocks). Scoped integration tests ran clean. Regression test for substring invalidation was omitted — `tests/**/*.js` is already ~8% over the LOC ceiling (`check-test-budget.sh` fails on main baseline); hardened `invalidateKeysIncluding` producer instead.

### Notes
- Prior `clearTierCache(repo)` + `probeTtlCache.clear()` would flush TTL entries for unrelated repos — fixed with path-scoped eviction.
- `lib/feature-start` worktree heal path was restored — it matched `main`; the branch briefly replaced it with a warn-only variant unrelated to TTL caching.


