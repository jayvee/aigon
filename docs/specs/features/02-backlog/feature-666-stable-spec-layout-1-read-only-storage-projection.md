---
complexity: high
set: stable-spec-layout
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-11T08:31:54.012Z", actor: "cli/feature-prioritise" }
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
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="132" viewBox="0 0 1168 132" role="img" aria-label="Feature dependency graph for feature 666" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-666" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-666)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-666)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-666)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#666</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 1 read…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#667</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 2 crea…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#668</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 3 cano…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#669</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 4 gene…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
