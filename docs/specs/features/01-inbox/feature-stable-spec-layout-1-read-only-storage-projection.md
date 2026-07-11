---
complexity: high
set: stable-spec-layout
---

# Feature: make storage projection strictly read-only for tracked repository content

## Summary
Establish the safety boundary required by the stable spec layout: fetching or rebuilding Aigon workflow state may update only Aigon-owned local projection data and generated view artefacts, never tracked spec files, the Git index, commits, or the checked-out branch. Remove projection-time spec reconciliation and auto-commit behaviour, make drift diagnostic-only during the transition, and add regression tests proving storage polling cannot mutate normal repository content.

## User Stories
- [ ] As an operator using git-branch storage, polling remote state never changes or commits files on my checked-out branch.
- [ ] As an operator with local spec edits, a remote lifecycle update cannot rename, overwrite, stage, or commit those edits.
- [ ] As a maintainer, I have a hard test boundary separating SpecStore projection rebuilds from tracked repository mutations.

## Acceptance Criteria
- [ ] `rebuildLocalProjection`, `fetchRemoteProjection`, the dashboard storage poller, and `aigon storage sync` do not invoke spec file moves, staging, or Git commits.
- [ ] A storage fetch may update the local state branch, `.aigon/workflows/**`, `.aigon/state/**`, and other documented Aigon-owned caches only.
- [ ] Projection refresh leaves the checked-out `HEAD`, index tree, tracked working-tree content, and untracked user files unchanged.
- [ ] Existing spec reconciliation remains available only as an explicit diagnostic/repair path during the legacy-layout transition; read paths and background pollers do not mutate specs.
- [ ] Projection failures and legacy spec-location drift surface structured diagnostics rather than being silently swallowed.
- [ ] Local and git-branch backends retain equivalent lifecycle snapshot/read-model behaviour after removing projection-time spec moves.
- [ ] Integration coverage creates two clones, publishes a remote lifecycle event, refreshes the peer projection, and proves the peer's normal Git state is byte-for-byte unchanged.
- [ ] Documentation no longer claims that storage polling is fetch-only while indirectly committing spec moves.

## Validation
```bash
npm test
node tests/integration/two-clone-git-branch-storage.test.js
node tests/integration/dashboard-storage-status.test.js
```

## Pre-authorised

## Technical Approach
Remove `reconcileEntitySpec` and `stageAndCommitSpecMove` from the SpecStore projection rebuild path. Split projection refresh from explicit repair so the storage backend owns only canonical event merge plus local `.aigon` cache materialisation. Add a reusable test assertion that snapshots `HEAD`, the index, tracked content, and untracked paths around a storage refresh. Preserve portable event paths as compatibility data, but do not execute tracked-file effects merely because a remote event was fetched.

This feature is containment, not the final layout. Legacy lifecycle commands may still move specs when explicitly invoked locally until the final set member performs the cutover.

## Dependencies
- None.

## Out of Scope
- Introducing `00-specs`.
- Allocating IDs at create time.
- Generating lifecycle symlinks.
- Changing lifecycle event ordering or implementing a general distributed event-log redesign.

## Open Questions
- None. Background storage projection is required to be read-only with respect to normal repository content.

## Related
- Supersedes the projection-applier direction in `feature-sync-visible-spec-file-moves-across-git-branch-storage-clones.md`.
- Architecture: `docs/specstore-architecture.md`.

