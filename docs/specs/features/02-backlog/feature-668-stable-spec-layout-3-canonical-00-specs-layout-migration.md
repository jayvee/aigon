---
complexity: very-high
set: stable-spec-layout
depends_on: [667]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-11T08:31:57.742Z", actor: "cli/feature-prioritise" }
---

# Feature: introduce canonical 00-specs storage and explicit layout migration

## Summary
Introduce a lifecycle-independent canonical home for feature and research Markdown under `00-specs`, update spec CRUD/resolution/indexing to treat those files as the only durable content copies, and provide an explicit, validated migration from legacy stage-folder storage. The migration applies uniformly to local and git-branch repositories and creates a committed main-branch content move without depending on storage polling.

## User Stories
- [ ] As an operator, each spec has one stable canonical path for its entire lifetime.
- [ ] As an operator, I can migrate an existing repository deliberately, inspect the plan, and commit the content move without background mutation.
- [ ] As a maintainer, scanners and commands resolve one canonical Markdown file and do not double-count future lifecycle view links.

## Acceptance Criteria
- [ ] Canonical feature files live under `docs/specs/features/00-specs/`; canonical research files live under `docs/specs/research-topics/00-specs/`.
- [ ] New creates write numbered, immutable canonical files directly into the relevant `00-specs` directory.
- [ ] Spec CRUD, resolver, dashboard spec index, dependency/set scanners, agent prompt resolution, close/eval validation, and other content consumers resolve canonical files without relying on lifecycle folders.
- [ ] The project records an explicit layout version (e.g. `specLayout: stable`) in a tracked, committed project file such as `.aigon/config.json`, so every clone and worktree agrees on the layout after normal Git sync; storage backend selection does not alter the layout.
- [ ] `aigon spec-layout status` reports legacy, mixed, migration-blocked, or stable state without changing files.
- [ ] `aigon spec-layout migrate --stable --dry-run` produces a complete deterministic move/collision plan and performs no writes.
- [ ] `aigon spec-layout migrate --stable` validates IDs, duplicate specs, destination collisions, dirty relevant files, and paths outside Aigon-owned spec roots before moving anything.
- [ ] Migration detects entities with active worktrees or unmerged feature branches (in-progress, eval, review) and blocks or requires explicit acknowledgement, documenting that those branches still reference legacy spec paths and how that resolves at merge.
- [ ] Migration moves feature/research content to `00-specs`, preserves Git rename history where possible, updates portable spec references/projections, and commits only explicit migration paths on main.
- [ ] Migration is idempotent and recoverable: rerunning after success is a no-op, while an interrupted run is diagnosed and safely resumed or repaired.
- [ ] Existing unnumbered inbox specs receive IDs allocated through the feature-2 allocation contract; existing numbered specs retain their IDs.
- [ ] Legacy layouts remain readable during a bounded compatibility period, but mixed layouts never silently select between duplicate real files.
- [ ] No symlinks are followed as canonical content by scanners, dependency resolution, template generation, or search indexes.
- [ ] Tests cover feature and research migration, dirty files, duplicate IDs, destination collisions, partial migration recovery, and both storage backends.

## Validation
```bash
npm test
node tests/integration/bootstrap-engine-state.test.js
node tests/integration/spec-review-status.test.js
```

## Pre-authorised

## Technical Approach
Add a single canonical-path API owned by the spec storage/content layer; downstream modules request a spec by identity rather than constructing stage paths. Extend the project manifest/config with a layout version and route all new writes through the stable path once enabled. Implement migration as an explicit command with plan, validate, apply, commit, and verify phases. Do not run migration from `aigon apply`, dashboard startup, storage polling, or ordinary read paths.

During compatibility, the resolver may discover a legacy real file only when no canonical file exists. If both exist, it reports a collision. Symlinks are excluded from canonical discovery by `lstat`/equivalent rather than filename heuristics.

## Dependencies
- `stable-spec-layout-2-create-time-id-reservations`.

## Out of Scope
- Creating lifecycle symlinks.
- Removing lifecycle `move_spec` effects from every command; final cutover is a later set member.
- VS Code settings, extensions, or editor-specific views.
- Automatically pulling or pushing the target repository's main branch.

## Open Questions
- None. Migration is explicit and canonical files use `00-specs` for both entity kinds.

## Related
- Architecture: `docs/specstore-architecture.md`.
- Current spec lookup: `lib/feature-spec-resolver.js`, `lib/spec-crud.js`, and `lib/dashboard-spec-index.js`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 668" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-668" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-668)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-668)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-668)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-668)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#666</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 1 read…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#667</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 2 crea…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#668</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 3 cano…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#669</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 4 gene…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#670</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 5 life…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
