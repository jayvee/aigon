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
`tests/integration/two-clone-git-branch-storage.test.js` (12 sequential cases): event union-merge, parallel/interleaved one-winner races, unrelated-push retry, expiry reclaim, takeover+priorHolder, offline/env-offline/unreachable refusal + offline append sync, stats convergence, pre-push and post-push crash recovery, health.
