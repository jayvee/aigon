---
commit_count: 3
lines_added: 646
lines_removed: 207
lines_changed: 853
files_touched: 18
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 11619110
output_tokens: 41642
cache_creation_input_tokens: 0
cache_read_input_tokens: 11207168
thinking_tokens: 13953
total_tokens: 11660752
billable_tokens: 11674705
cost_usd: 25.8128
sessions: 3
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 283 - rethink-spec-review-workflow-state
Agent: cx

## Plan
- Replace git-log-derived spec-review reads with workflow-core state.
- Record review/ack writes explicitly from the spec-review command flow.
- Backfill legacy `spec-review:` / `spec-review-check:` commits into workflow state on install/upgrade.

## Progress
- Added workflow-core `spec_review.submitted` / `spec_review.acked` event handling and snapshot projection for feature and research entities.
- Added CLI record commands that persist spec-review state from the current HEAD commit after reviewer/checker commits land.
- Updated spec-review templates to enforce `AIGON_AGENT_ID` before review commits and to record workflow state immediately after the commit.
- Replaced dashboard spec-review status reconstruction with snapshot reads instead of `git log` scanning.
- Blocked `feature-close` when pending spec reviews exist.
- Added migration registration to backfill legacy review commits into workflow state during install/upgrade.
- Updated docs and kept the test suite under the hard LOC budget by compressing the new regression coverage.

## Decisions
- Chose the workflow-engine-backed design from the spec rather than a sidecar JSON file so pending review state and close gating live under the same authority as lifecycle state.
- Kept git commits as informational audit trail only; they still exist, but dashboard reads and close behavior now depend on workflow snapshots.
- Used a blocking close policy for unresolved spec reviews. This guarantees Done items cannot retain stale pending-review state.
- Added slug-to-numeric workflow-state migration during prioritise so pre-prioritisation inbox reviews survive assignment of a numeric entity ID.
- Conversation summary: implemented the engine-backed store, fixed the failing regressions, compressed the new tests to stay under `scripts/check-test-budget.sh`, restarted the server, and re-ran the full validation set.
