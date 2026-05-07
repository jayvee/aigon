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
