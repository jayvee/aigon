---
commit_count: 6
lines_added: 172
lines_removed: 7
lines_changed: 179
files_touched: 7
fix_commit_count: 2
fix_commit_ratio: 0.333
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 3789347
output_tokens: 17768
cache_creation_input_tokens: 0
cache_read_input_tokens: 3356800
thinking_tokens: 5435
total_tokens: 3807115
billable_tokens: 3812550
cost_usd: 8.3922
sessions: 3
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 304 - dashboard-review-check-status-indicators
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc (claude-opus-4-7)
**Date**: 2026-04-22

### Fixes Applied
- `fix(review): plumb review-check statuses end-to-end` — two bugs that prevented the new statuses from ever reaching the dashboard:
  1. `buildFeatureAgentsFromSnapshot` never read `statusData.status`, so `feedback-addressed` from the per-agent status file (the only producer) was discarded. Now captured and threaded through as `fileStatus`; `deriveFeatureDashboardStatus` prefers it.
  2. `collectFeatures` unconditionally reset `agent.status` from `featureState.snapshotStatuses[agent.id]` after `buildFeatureAgentRow` ran, clobbering the `'addressing-review'` derivation back to `'implementing'`. The override now skips rows already in a derived review-loop state.
- Expanded `tests/integration/dashboard-review-statuses.test.js` to exercise `collectRepoStatus` end-to-end for `feedback-addressed`. Confirmed it fails on the previous implementation and passes after the fix.
- `fix(review): restore unrelated test-budget guidance reverted in error` — the diff reverted commit 476c36cb (`lib/profile-placeholders.js` test-budget escape hatch) which is unrelated to feature 304. Restored to match main verbatim.

### Residual Issues
- None.

### Notes
- Existing helper-only test passed even with both bugs present because it called `deriveFeatureDashboardStatus` directly and only inspected `reviewStatus` from the read model — it never exercised the dashboard collector pipeline where the override lived. The new `collectRepoStatus` test pins this down.
- `addressing-review` was harder to test end-to-end because the derivation requires a live tmux session; the helper-level assertion in the existing test is the safety net for that branch.
- The spec's claim that "`feedback-addressed` already arrives from the agent status file" was incorrect — it had to be added.
