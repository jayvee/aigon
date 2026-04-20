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
