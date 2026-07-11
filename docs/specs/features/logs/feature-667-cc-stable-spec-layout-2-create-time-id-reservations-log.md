---
commit_count: 4
lines_added: 993
lines_removed: 86
lines_changed: 1079
files_touched: 20
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 34
output_tokens: 1999
cache_creation_input_tokens: 195905
cache_read_input_tokens: 59684
thinking_tokens: 0
total_tokens: 257622
billable_tokens: 2033
cost_usd: 1.1855
sessions: 2
model: "claude-opus-4-8"
tokens_per_line_changed: null
---
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

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-11

### Fixes Applied
- `789eb98fb` fix(review): avoid duplicate aigon_id on --set create and update set tests

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — Acceptance criteria list two-clone coverage for parallel research creates, CAS retry after a lost race, and crash-after-reservation; branch ships parallel feature + sequential in-process research + pending-gap tests only. Safe to land core allocator; follow-up test hardening is separate harness work.

### Notes
- Core create-time reservation, lifecycle-only prioritise/unprioritise/rename, and git-branch CAS merge path look sound against the spec.
- `feature-create --set` was duplicating `aigon_id` in frontmatter; fixed to append `set:` only after `injectAigonIdFrontmatter`.
- `feature-sets.test.js` still assumed slug-only inbox filenames; updated for numbered create-time specs.
