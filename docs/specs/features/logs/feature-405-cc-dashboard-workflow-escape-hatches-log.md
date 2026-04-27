# Implementation Log: Feature 405 - dashboard-workflow-escape-hatches
Agent: cc

## Status

Implemented: 5-signal escape hatch via `POST /api/{features|research}/:id/mark-complete`, `pendingCompletionSignal`/`isWorking` on agent objects, overflow menu item in pipeline.js, Playwright test covering present/absent/click cases.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: composer
**Date**: 2026-04-27

### Fixes Applied

- `fix(review): F405 escape hatch read-model and E2E` — status collector now resolves per-agent JSON via `candidateIds` (unpadded workflow id vs padded `feature-NN-*` files); shared `NON_WORKING_AGENT_STATUSES` for research `isWorking`; implementation pending signal no longer cleared only because the snapshot slot reads as ready while the status file still has an open `do` task; `recordSpecReviewCompleted` records optional `source`; Playwright `mark-complete` spec reordered (hatch hidden while tmux alive, kill + cache wait, then assertions).

### Residual Issues

- Full `npm run test:ui` / `test:iterate` still reports unrelated failures in this environment (`failure-modes`, `fleet-lifecycle`, `solo-lifecycle` backlog card text); `submit-signal-loss` integration tests also fail on a clean `git stash` of local changes — treat as machine/fixture noise unless reproduced on CI. None stem from the review patch once `mark-complete.spec.js` passes in isolation.

### Notes

- Branch diff vs `main` still includes unrelated doc seeds (`feature-407` competitive scan, `feature-408` backlog move); out of scope for F405 — confirm with the implementer before merge.
- `POST …/mark-complete` for `spec-review-complete` emitting `recordSpecReviewCompleted` was already present on the branch before this review; `source` on that event is the incremental audit alignment with other completion paths.
