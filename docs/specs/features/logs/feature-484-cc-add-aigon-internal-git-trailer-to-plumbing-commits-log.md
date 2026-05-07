---
commit_count: 3
lines_added: 114
lines_removed: 35
lines_changed: 149
files_touched: 5
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 81
output_tokens: 42785
cache_creation_input_tokens: 103434
cache_read_input_tokens: 3395685
thinking_tokens: 0
total_tokens: 3541985
billable_tokens: 42866
cost_usd: 2.0486
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 484 - add-aigon-internal-git-trailer-to-plumbing-commits
Agent: cc

## Status
Complete. All acceptance criteria met. 76/77 tests pass (pre-existing tmux failure unrelated).

## New API Surface
- `commits.js` `parseLogLines` now returns `aigonInternal: boolean` on each commit object.
- Git log format extended to `%H%x1f%aI%x1f%an%x1f%s%x1f%(trailers:key=Aigon-Internal,valueonly,separator=%x1f)`.

## Key Decisions
- Used `--trailer "Aigon-Internal: true"` (not a second `-m`) at all write sites — explicit and portable (git ≥ 2.18).
- Filter applied before `attachFiles` so file-stat queries are skipped for hidden commits.
- No `PLUMBING_PATTERNS` existed to remove (already reverted in f7d10aff); spec criteria satisfied by absence.

## Gotchas / Known Issues
- Pre-existing bug: `dashboard-commits-route.test.js` used synchronous `test()` for an async HTTP handler, so all 5 existing tests returned `null !== 200`. Fixed by converting all tests to `testAsync`/`withTempDirAsync` + a `done` promise resolved on `res.end()`. This is an infrastructure fix, not scope creep — the tests were broken before this feature.

## Explicitly Deferred
- Backfilling the trailer onto existing commits (out of scope per spec).
- UI toggle to show/hide `Aigon-Internal` commits (out of scope per spec).

## For the Next Feature in This Set
- Standalone — no follow-on features in this set.

## Test Coverage
- Added: `worktree path: filters commits with Aigon-Internal: true trailer` — commits a plumbing commit with the trailer then asserts it is excluded from the response.
- Fixed: 5 pre-existing async tests now pass (0/5 → 5/5).
