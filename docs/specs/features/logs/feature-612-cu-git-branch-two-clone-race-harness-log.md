---
commit_count: 4
lines_added: 719
lines_removed: 291
lines_changed: 1010
files_touched: 7
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 612 - git-branch-two-clone-race-harness
Agent: cu

## Status
Extended F598-style two-clone harness for git-branch: parallel + interleaved CAS races, retry-on-unrelated-push, clock-injected expiry reclaim, takeover/renew contention, offline/unreachable refusal, stats convergence, crash-window recovery, and property-named failure dumps. Deleted overlapping `git-branch-cas-leases.test.js` (coverage moved here).

## New API Surface
- `leases.js`: `setLeaseNowForTests`, `clearLeaseNowForTests`, `leaseNowMs` — injectable wall clock for TTL tests.
- `git-branch-leases.js`: `setCasTestHooks`, `clearCasTestHooks` with `afterFetch` / `beforePush` / `afterPushBeforeProjection` seams.
- `tests/integration/two-clone-git-branch-harness.js` + `two-clone-git-branch-worker.js` — shared fixture, forked parallel acquire, `formatHarnessDump`.

## Key Decisions
- Harness tests run sequentially in-file so injected lease clock and CAS hooks do not leak across cases (integration `report()` runs files concurrently).
- Interleaved race expects exactly one success + one `LeaseConflictError` (B may win via hook); parallel race uses forked workers for genuine multi-process honesty.
- Crash-after-push hook throw is wrapped as `LeaseUnavailableError`; recovery via `fetchRemoteProjection()` matches production push-then-project ordering.

## Gotchas / Known Issues
- Suite LOC still over global `check-test-budget.sh` ceiling (pre-existing); this feature net-deleted `git-branch-cas-leases.test.js` when adding harness.

## Explicitly Deferred
- Real-forge manual checklist → implementation log note only (per spec Out of Scope).

## For the Next Feature in This Set
- F613 convert/removal can gate on `tests/integration/two-clone-git-branch-storage.test.js` green in `test:core`; keep `setCasTestHooks` when adding new CAS scenarios.

## Test Coverage
`tests/integration/two-clone-git-branch-storage.test.js` (13 sequential cases): event union-merge, parallel/interleaved one-winner races, unrelated-push retry, expiry reclaim, takeover+priorHolder, offline/env-offline/unreachable refusal + offline append sync, stats convergence, pre-push and post-push crash recovery, health, releaseLease clears entry.

## Code Review

**Reviewed by**: cc
**Date**: 2026-07-06

### Fixes Applied
- cc6efd3cd fix(review): port two missing coverage cases from deleted git-branch-cas-leases.test.js
  - Added same-commit atomicity assertion (cat-file on branch tip) to the parallel race test
  - Added 13th case: releaseLease clears the impl entry via CAS on git-branch backend
  - Updated case count from 12 to 13

### Validation
- Validation not run by reviewer per policy

### Escalated Issues
- None

### Notes
- The implementation is well-structured. CAS hook seams are minimal and correctly scoped. Clock injection pattern is clean. Sequential test execution within the file correctly prevents hook/clock leak across cases.
- `assertHarness` (sync) is exported but unused in the current test suite — fine as future scaffolding.
- `liveLeaseClock()` name is slightly misleading (it sets a fixed timestamp, not a live clock) but causes no correctness issue.
