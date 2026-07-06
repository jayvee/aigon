# Implementation Log: Feature 609 - git-branch-backend-core
Agent: cc

## Status
Implemented: `git-branch` backend (`lib/spec-store/git-branch-backend.js`) storing canonical events as `meta.json` + `specs/<KEY>/events.jsonl` on an orphan branch via new tree-plumbing helpers in `git-plumbing.js` (throwaway index, never checked out); registered in factory + storage-config; branch added to engine/adapter cache keys; unit + two-clone convergence tests green; leases stay advisory (deferred to git-branch-cas-leases). One gotcha: git-branch stores raw JSONL, so it needs its own `parseEventsJsonl` (git-ref's `parseEventsPayload` mis-reads a leading `{` as the wrapped payload form).

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-06

### Fixes Applied
- `720cddd94` fix(review): wire git-branch into stats recording and pre-write sync paths

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — `buildRepoStorageStatus` in `lib/dashboard-storage.js` still assumes git-ref for non-local backends; dashboard sync action and storage health for git-branch are explicitly deferred to F611 (git-branch-observability).
- ESCALATE:architectural — Same-machine concurrent `appendEvent` calls to different specs share one branch ref without a branch-level lock; divergent tips recover on push/sync, but a lost local tip could orphan a commit until the next full sync. A branch-wide write mutex or optimistic tip retry belongs in a follow-on hardening pass (related set member F612).

### Notes
- Core backend, plumbing, factory registration, cache keys, convergence tests, and `health()` shape look solid and match the spec.
- `rebuildStatsProjectionForKey` is correctly wired on every write/merge path; the missing producer was `recordCanonicalStats` still gating on git-ref only.
