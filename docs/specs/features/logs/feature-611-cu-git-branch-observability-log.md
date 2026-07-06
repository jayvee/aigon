# Implementation Log: Feature 611 - git-branch-observability
Agent: cu

## Status
git-branch observability: storage status/doctor/report/board, dashboard DTOs + 45s fetch poller, lease badges with user@machine(agent) and staleness.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-07-06

### Fixes Applied
- `548b6f6ee fix(review): clear lastFetchError in clearExpiredLeasesForKey sync state write` — After a successful doctor `--fix` that clears expired leases and pushes to remote, `clearExpiredLeasesForKey` was writing sync state without clearing `lastFetchError`. Because `computeLeaseDataStale` checks `syncState.lastFetchError` first, a prior fetch failure would leave the dashboard showing "stale" even though the fix was successful. Added `lastFetchAt` and `lastFetchError: null` to the writeSyncState call.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues
- ESCALATE:ambiguous — Compact CLI output for `storage report` (text mode) and `board --storage` shows `role:user@holderId` but omits `agentId` and `expiresAt`. The spec AC says "showing user, holderId, agentId, role, expiresAt" — this is fully satisfied in `--json` mode and in the dashboard DTOs. Pre-existing compact format also abbreviated; adding all fields to the one-line text row would make output unwieldy. Clarify whether compact text must include all fields or if `--json` coverage is sufficient.

### Notes
- `writeSyncState` uses patch/merge semantics (confirmed via sync-state.js), so all partial writes in storage-poller.js are safe.
- `readFileFromCommit` in git-branch-leases.js is correctly a 2-arg closure (repoPath pre-bound via ctx) — not a 3-arg call bug.
- The fetch-lock race between `clearExpiredLeasesForKey` and the background poller is a non-issue: doctor runs in a separate CLI/subprocess process from the server, so module-level lock state is not shared.
- `typeof formatLeaseHolderLabel === 'function'` guard in detail-tabs.js is safe; utils.js loads first per index.html script order.
- `visibilitychange` handler fires `POST /api/storage/refresh` regardless of backend; the server-side pollOnce short-circuits for non-git-branch backends — no wasted work.
