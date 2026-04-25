---
commit_count: 3
lines_added: 98
lines_removed: 11
lines_changed: 109
files_touched: 8
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 141
output_tokens: 76580
cache_creation_input_tokens: 218160
cache_read_input_tokens: 9906966
thinking_tokens: 0
total_tokens: 10201847
billable_tokens: 76721
cost_usd: 4.9393
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 354 - spec-review-cycle-inbox-backlog-only
Agent: cc

## Status
Submitted. All tests pass (4649/4650 LOC budget).

## New API Surface
- `isSpecReviewCycleAllowed(lifecycle)` exported from `lib/spec-review-state.js` — returns true iff lifecycle is `'inbox'` or `'backlog'`. Single predicate used by action registry, CLI, and engine write path.

## Key Decisions
- Predicate takes `lifecycle` string (engine truth from snapshot), not folder path — satisfies the inbox nuance where an inbox entity with a bootstrapped snapshot still gets spec review.
- `spec-revise` CLI and engine additionally allow `spec_review_in_progress` since that state is reached from inbox/backlog (still pre-implementation).
- Engine strategy chosen: **fail loud** — `recordSpecReviewStarted` throws if lifecycle is out of bounds. This is preferable to the prior silent xstate `sendIfAllowed` no-op that wrote the event to disk but ignored it.
- Consolidated the old 5-line label-only test into the new combined guard test to stay within the 4650 LOC budget (ended at 4649).

## Gotchas / Known Issues
- `recordSpecReviewCompleted` and `recordSpecReviewSubmitted` are NOT guarded — these complete an already-started review cycle and should remain callable from `spec_review_in_progress`. Only the start events are guarded.

## Explicitly Deferred
- Paused lifecycle: spec review while paused is out of scope per spec Open Questions — predicate returns false for `paused`.
- CLI invocation test (direct CLI subprocess): replaced with engine guard test since it validates the write path. The CLI guard itself is a thin wrapper around the same predicate.

## For the Next Feature in This Set
- The paused-state question (should spec review be allowed when paused?) remains open.

## Test Coverage
Added to `tests/integration/spec-review-status.test.js`:
1. `spec-review cycle: backlog allows, implementing blocks, labels distinct` — tests both feature and research entity types, verifies presence/absence of spec-review actions in `validActions`, and preserves label regression coverage.
2. `spec-review engine guard rejects implementing lifecycle` — creates a real in-progress feature and asserts `recordSpecReviewStarted` throws with the expected `inbox or backlog` message.
