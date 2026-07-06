# Implementation Log: Feature 610 - git-branch-cas-leases
Agent: cc

## Status
Implemented authoritative CAS leases on the git-branch backend. The current lease per key now lives in `leases/<KEY>.json` (a roles map), written only via fast-forward-only push — the remote accepts one writer per race and the loser's rejected push is the conflict signal. Lease history still appends `lease.*` audit events to `specs/<KEY>/events.jsonl` in the same commit; the file, not the derived events, is the authority on this backend. Local + git-ref backends unchanged.

## New API Surface
- `lib/spec-store/git-branch-leases.js` — `createGitBranchLeaseApi(ctx)` returns the five-method lease surface (`readLeases/acquireLease/renewLease/releaseLease/assertLeaseAllowed`) backed by CAS. Wired into `git-branch-backend.js` in place of `createLeaseApi`.
- `leases.js`: `LeaseUnavailableError`, `resolveLeaseUser(repoPath)` (git `user.email`→`user.name`→null), and pure file helpers `leasesPathForKey / parseLeaseFile / serializeLeaseFile / isLeaseRecordExpired`. `buildLeaseEvent` now carries `user`.
- `git-plumbing.js`: `treeBlobSha(repo, commit, path)` — blob-sha compare classifies a rejected push (unchanged lease blob → retry; changed → LeaseConflictError).
- `lease-coordination.js`: online-mandatory enforcement point + `formatLeaseUnavailable`; exports `LeaseUnavailableError`.

## Key Decisions
- One `leases/<KEY>.json` per key with a roles map (not per-role files) — impl/eval serialize through one CAS blob; read path stays one `cat-file`.
- `mergeRemote` now carries remote lease blobs forward verbatim (remote is always at-or-ahead for lease files under FF-only CAS), so an unrelated events push can never drop/resurrect a lease. Release writes the role out of the map (never deletes the file) so the carry-forward clears it correctly.
- Online-mandatory claims: `acquireLease`/takeover throw `LeaseUnavailableError` when offline or remote unreachable (coordinate guards the explicit-offline case; the mandatory fetch guards unreachable). `renewLease` network failure → warning result (TTL still covers). `releaseLease` is NOT online-mandatory — returns gracefully so `feature-close` never blocks.
- Retry-on-unrelated-change bounded to 3 attempts with jittered backoff; exhaustion throws a distinct retryable error.

## Gotchas / Known Issues
- `test:core` in THIS live environment shows unrelated failures NOT caused by this feature: (a) pre-existing lint errors in `templates/dashboard/js/{pipeline,sidebar}.js` (`buildLeaseBadgeHtml`/`buildStorageStatusBadgeHtml` undefined, from prior commit 034b1f82c — F611 dashboard territory); (b) a module-load `SyntaxError` cascade because concurrent autonomous run-loops + the dashboard server + `doctor --fix` integration tests share one `.git` and `git stash apply` the repo's two real June stashes into the worktree, injecting conflict markers into `worktree.js`/`dashboard-server.js`. Restored those non-feature files to HEAD (never mine). Feature surface passes in isolation: new `tests/integration/git-branch-cas-leases.test.js` (5), existing lease/git-branch unit + two-clone integration, and `npm run test:related -- tests/integration lib/spec-store` (9/9). Changed files lint clean.

## Explicitly Deferred
- Dashboard rendering of holder/user + freshness polling → F611. Full concurrency matrix → F612. Convert + git-ref removal → F613.

## For the Next Feature in This Set
- The lease file is authoritative; `readLeases` returns the derived-lease shape (with `expired`, `user`) from the file. Dashboard (F611) should read `leases/<KEY>.json` directly rather than deriving from events.
- `treeBlobSha` + the `mergeRemote` lease carry-forward are the load-bearing invariants; keep lease writes FF-only (no `--force`).

## Test Coverage
`tests/integration/git-branch-cas-leases.test.js`: concurrent two-clone acquire race (exactly one winner + one LeaseConflictError, byte-identical lease file), audit-event-in-same-commit, renew/takeover/release round-trip, offline claim refusal (LeaseUnavailableError) + offline-tolerant release, and unrelated-events-push does-not-conflict.

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-06

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- CAS protocol matches the spec: `leases/<KEY>.json` roles map, FF-only push, blob-sha classification on rejection (unchanged lease → retry; changed → `LeaseConflictError`), audit events in the same commit, and `mergeRemote` remote lease carry-forward are all wired correctly.
- Online-mandatory claims are enforced at both `coordinateMutatingCommand` (explicit offline) and `acquireLease` (unreachable remote); `renewLease`/`releaseLease` offline tolerance matches the AC.
- Local and git-ref backends remain on advisory `createLeaseApi`; git-branch swaps in `createGitBranchLeaseApi` behind the same five-method surface.
- Same-repo concurrent `acquireLease` interleaving with `mergeRemote` event pushes is out of scope here (F612 race harness); two-clone integration coverage is sufficient for this feature.
