---
complexity: very-high
set: stable-spec-layout
depends_on: [666]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-11T08:31:56.611Z", actor: "cli/feature-prioritise" }
---

# Feature: reserve immutable feature and research IDs at creation time

## Summary
Remove slug-to-numeric workflow re-keying by assigning every feature and research topic its immutable numeric identity when it is created. Add a collision-safe allocator for git-branch storage so concurrent creates on separate machines cannot receive the same ID, retain deterministic local allocation for the single-machine backend, and make prioritise a lifecycle-only transition rather than an identity migration.

## User Stories
- [ ] As an operator, a new feature has its permanent `F<number>` identity while it is still in inbox.
- [ ] As an operator creating specs concurrently on two machines, each create receives a distinct ID without manual coordination.
- [ ] As an operator, a failed create may leave an explainable numbering gap but never causes an ID to be reused.
- [ ] As a maintainer, workflow aggregates have one identity from bootstrap through done and no slug-directory migration path.

## Acceptance Criteria
- [ ] `feature-create` and `research-create` allocate a numeric ID before creating the canonical workflow aggregate and spec file.
- [ ] The canonical identity is stored in spec frontmatter as `aigon_id: F42` or `aigon_id: R42`; it is immutable and is not derived solely from filename or folder.
- [ ] `feature-prioritise` and `research-prioritise` transition an existing numbered entity from inbox to backlog without renaming its workflow directory or assigning a new ID.
- [ ] Spec files are numbered from creation (e.g. `feature-42-slug.md` while still in inbox), so lifecycle spec moves under the legacy layout change only the folder, never the filename.
- [ ] `feature-unprioritise` and `research-unprioritise` become lifecycle-only reverse transitions: they no longer strip the numeric ID from the spec filename or re-key workflow state back to a slug (today `runUnprioritise` in `lib/feature-lifecycle.js` does both via `migrateEntityWorkflowIdSync`).
- [ ] `feature-rename` / `research-rename` accept numbered inbox entities: they rename the slug portion only and never alter the reserved numeric ID (today they refuse anything that already has an ID).
- [ ] Git-branch allocation uses remote compare-and-swap semantics: two clones racing for the same next number produce different successful reservations, and a non-fast-forward loser refetches and retries.
- [ ] Reservations are validated as unique and are never combined through the current local-first union merge path.
- [ ] Feature and research number sequences are independent, existing numeric IDs seed the allocator, and abandoned reservations are never reused.
- [ ] A git-branch create refuses to allocate an official numeric ID when the configured state remote is offline or unreachable; it does not fall back to a locally guessed number.
- [ ] Local storage retains a safe local allocator and does not require a remote.
- [ ] Set creation and `set-prioritise` continue to resolve slug dependencies while IDs are assigned at create rather than prioritise; prioritisation order remains dependency-safe even though numeric ordering is no longer assigned at that step.
- [ ] Existing unnumbered inbox specs remain readable and have an explicit migration/import path; duplicate legacy identities fail loudly.
- [ ] Two-clone tests cover simultaneous feature creates, simultaneous research creates, retry after a lost reservation race, unreachable remote, and crash after reservation but before file creation.

## Validation
```bash
npm test
node tests/integration/two-clone-git-branch-storage.test.js
node tests/integration/bootstrap-engine-state.test.js
```

## Pre-authorised

## Technical Approach
Introduce a SpecStore identity-allocation boundary rather than extending `getNextId` filesystem scans. On git-branch storage, store reservation state in the Aigon state branch and publish it with compare-and-swap/fast-forward semantics. A reservation transaction returns a durable display key; only then does create bootstrap the numbered aggregate and write its spec. Treat a reserved-but-unmaterialised identity as abandoned/pending and expose it to doctor rather than recycling it.

Update entity creation, identity parsing, dependency indexes, set prioritisation, dashboard inbox rows, and migration tooling to accept numbered inbox entities. Delete or deprecate `migrateEntityWorkflowIdSync` as a normal prioritise/unprioritise write path; keep a narrowly scoped legacy importer until the layout migration is complete.

## Dependencies
- `stable-spec-layout-1-read-only-storage-projection`.

## Out of Scope
- Moving canonical files into `00-specs`.
- Generating symlink status views.
- Offline creation of official IDs. A later explicit draft concept may use an opaque temporary identity, but must not invent a number.
- Solving normal main-branch content divergence.

## Open Questions
- The implementation may choose a registry document or reservation event stream, but uniqueness must be CAS-enforced rather than inferred after union merge.

## Related
- Existing identity helpers: `lib/spec-identity.js` and `lib/spec-store/spec-key.js`.
- Existing create/prioritise path: `lib/entity.js` and `lib/commands/entity-commands.js`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 667" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-667" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-667)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-667)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-667)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-667)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#666</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 1 read…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#667</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 2 crea…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#668</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 3 cano…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#669</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 4 gene…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#670</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 5 life…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
