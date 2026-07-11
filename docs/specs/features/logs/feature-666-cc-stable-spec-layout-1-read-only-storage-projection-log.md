# Implementation Log: Feature 666 - stable-spec-layout-1-read-only-storage-projection
Agent: cu (failover from cx)

## Status
Complete. Projection rebuild is read-only for tracked checkout content.

## New API Surface
- `tests/git-repo-state.js`: `captureGitRepoState` / `assertGitRepoStateUnchanged` — reusable checkout invariant assertions excluding `.aigon/` projection writes.

## Key Decisions
- Removed `reconcileEntitySpec` and `stageAndCommitSpecMove` from `rebuildLocalProjection` entirely; spec drift remains detect-only on dashboard/CLI read paths (`dryRun: true` default) and explicit repair via `aigon repair`.
- Git-state test helper scopes invariants to `HEAD`, `docs/specs` index/worktree, and tracked content outside `.aigon/` — allowing `.aigon/workflows/**` and `.aigon/state/**` updates per spec.

## Gotchas / Known Issues
- `engine.startFeature` writes lifecycle events but does not move spec files; only lifecycle commands (`feature-start`, etc.) run `move_spec` effects. Two-clone test models peer drift accordingly.

## Explicitly Deferred
- Generated lifecycle symlink view (feature 669) and ID-at-create cutover (667–670 set members).

## For the Next Feature in This Set
- Member 667 can assume storage fetch/sync never mutates `docs/specs/**` on the checked-out branch.

## Test Coverage
- `dashboard-storage-status.test.js`: projection rebuild leaves stale spec in place, surfaces `specDrift`, checkout invariant holds.
- `two-clone-git-branch-storage.test.js`: remote lifecycle fetch + storage poller leave peer checkout unchanged while updating `.aigon/workflows` projection.
