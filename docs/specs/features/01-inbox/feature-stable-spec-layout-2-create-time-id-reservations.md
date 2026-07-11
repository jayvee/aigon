---
complexity: very-high
set: stable-spec-layout
depends_on: [stable-spec-layout-1-read-only-storage-projection]
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

Update entity creation, identity parsing, dependency indexes, set prioritisation, dashboard inbox rows, and migration tooling to accept numbered inbox entities. Delete or deprecate `migrateEntityWorkflowIdSync` as a normal prioritise write path; keep a narrowly scoped legacy importer until the layout migration is complete.

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

