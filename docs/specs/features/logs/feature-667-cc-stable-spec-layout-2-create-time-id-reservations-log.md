# Implementation Log: Feature 667 - stable-spec-layout-2-create-time-id-reservations
Agent: cu (failover from cx/cc)

## Status
Complete. Create-time numeric identity reservation shipped for local and git-branch backends.

## New API Surface
- `SpecStore.reserveIdentitySync(kind)` / `markIdentityMaterializedSync(kind, number)` / `readIdentityPending()` — monotonic F/R allocation boundary.
- `identity/sequences.json` on git-branch state branch; `.aigon/state/identity-sequences.json` locally.
- `engine.transitionEntityLifecycleSync` — lifecycle-only inbox↔backlog transitions without workflow re-keying.
- `specCrud.findInboxFile` / `parseNumberedSpecFilename` — numbered inbox entity lookup.

## Key Decisions
- Git-branch reservations use CAS on `identity/sequences.json` (FF-only push, remote-tip align); mergeRemote carries remote sequence blobs verbatim like leases — never union-merge.
- `feature-create` / `research-create` reserve ID before spec write; filename is `{prefix}-{paddedId}-{slug}.md` with immutable `aigon_id:` frontmatter; workflow bootstraps at numeric id immediately.
- `feature-prioritise` / `research-prioritise` are lifecycle-only for numbered inbox specs; legacy slug-only inbox specs still use `migrateEntityWorkflowIdSync` as a narrow importer.
- Unprioritise/rename detect create-time specs via `aigon_id` frontmatter and avoid slug re-keying.

## Gotchas / Known Issues
- Abandoned reservations remain in `pending` and surface as `identity_pending` in `aigon storage doctor` — numbers are never reused.
- Legacy unprioritised inbox specs (no numeric filename) still migrate on prioritise until operator runs doctor/import.

## Explicitly Deferred
- Full legacy inbox import command (doctor still bootstraps snapshotless slug inbox specs).
- Duplicate legacy identity loud-fail scanner beyond existing spec-index paths.

## For the Next Feature in This Set
- Feature 668 can assume every new spec has `aigon_id`, numbered filename, and stable workflow dir from create.
- Projection/read paths should treat inbox numbered specs as first-class (not slug-keyed pre-prioritise).

## Test Coverage
- `bootstrap-engine-state.test.js`: numbered create bootstrap, lifecycle-only prioritise, legacy slug prioritise migration retained.
- `two-clone-git-branch-storage.test.js`: parallel distinct feature reservations, independent research sequence, offline refusal, pending gap semantics.
