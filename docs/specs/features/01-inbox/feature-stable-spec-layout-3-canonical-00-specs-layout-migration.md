---
complexity: very-high
set: stable-spec-layout
depends_on: [stable-spec-layout-2-create-time-id-reservations]
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
- [ ] The project records an explicit layout version such as `specLayout: stable`; storage backend selection does not alter the layout.
- [ ] `aigon spec-layout status` reports legacy, mixed, migration-blocked, or stable state without changing files.
- [ ] `aigon spec-layout migrate --stable --dry-run` produces a complete deterministic move/collision plan and performs no writes.
- [ ] `aigon spec-layout migrate --stable` validates IDs, duplicate specs, destination collisions, dirty relevant files, and paths outside Aigon-owned spec roots before moving anything.
- [ ] Migration moves feature/research content to `00-specs`, preserves Git rename history where possible, updates portable spec references/projections, and commits only explicit migration paths on main.
- [ ] Migration is idempotent and recoverable: rerunning after success is a no-op, while an interrupted run is diagnosed and safely resumed or repaired.
- [ ] Existing unnumbered inbox specs receive previously reserved IDs through the feature-2 allocation contract; existing numbered specs retain their IDs.
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

