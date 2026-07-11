---
commit_count: 9
lines_added: 1142
lines_removed: 4
lines_changed: 1146
files_touched: 9
fix_commit_count: 1
fix_commit_ratio: 0.111
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 298
output_tokens: 153171
cache_creation_input_tokens: 425285
cache_read_input_tokens: 16480227
thinking_tokens: 0
total_tokens: 17058981
billable_tokens: 153469
cost_usd: 14.7289
sessions: 1
model: "claude-opus-4-8"
tokens_per_line_changed: null
---
# Implementation Log: Feature 668 - stable-spec-layout-3-canonical-00-specs-layout-migration
Agent: cc

## Status
Core complete. Canonical `00-specs` storage, an explicit tracked layout version, and a validated
plan→apply→commit migration ship with full unit/integration coverage. Broad read-path consumers are
canonical-aware via the shared resolver; the stage-keyed dashboard index and direct-scan scanners are
deferred to the lifecycle-view set members (see below).

## New API Surface
- `lib/workflow-core/paths.js`: `CANONICAL_SPEC_DIR` (`00-specs`) + `getCanonicalSpecDirForEntity(repo, type)`.
  Deliberately excluded from `CANONICAL_STAGE_DIRS` so the stage resolver never treats it as a stage.
- `lib/spec-layout.js` (new): `getLayoutVersion` / `isStableLayout` / `setLayoutVersion` (reads/writes
  `.aigon/config.json specLayout`), `listCanonicalSpecs`, `listLegacySpecs`, `findCanonicalSpecFile`
  (symlink-excluded via `lstat`), `detectStatus`, `buildMigrationPlan`, `applyMigrationPlan`.
- `aigon spec-layout status | migrate --stable [--dry-run] [--yes]` (`lib/commands/spec-layout.js`,
  registered through `lib/commands/infra.js`).
- `lib/feature-spec-resolver.js`: resolves canonical files first (`source: 'canonical'`), legacy stage
  discovery only when no canonical file exists.

## Key Decisions
- Layout is a **tracked config version** (`specLayout`), not a filesystem probe — every clone/worktree
  agrees after Git sync, and storage backend selection never changes it.
- Migration is **explicit-only**: never invoked from `aigon apply`, dashboard startup, storage polling,
  or read paths. Plan is pure (no writes); dry-run reports unnumbered-spec counts instead of inventing IDs.
- `git mv` for tracked specs preserves rename history. Commit staging is scoped to the actually-staged
  set computed with `git diff --cached --name-only --no-renames` — re-adding a renamed-away source path
  makes `git add` fatal and folds the rename, leaving the source deletion uncommitted (both bugs fixed).
- Unnumbered inbox specs get IDs through the feature-667 create-time reservation contract (injected
  `allocateId`); numbered specs keep their IDs.

## Gotchas / Known Issues
- `detectStatus` calls `buildMigrationPlan` without an allocator, so unnumbered specs surface as an
  informational `needsId` warning, not a blocker.
- Pre-existing (not caused by 668): `tests/integration/spec-author-provenance.test.js` two `--agent`
  cases read snapshots by slug path (`features/authored-by-flag/…`) — stale since 667 made creates
  numbered. Fails identically on the base tree; left for a 667-era test fix.

## Explicitly Deferred
- `lib/dashboard-spec-index.js` (stage-folder-keyed warm/cold cache) and direct-scan dependency/set
  scanners still enumerate stage folders. Their canonical integration lands with the lifecycle-view /
  cutover work (669–670), where the lifecycle→folder projection is regenerated.
- Lifecycle `move_spec` effects are unchanged (out of scope; final cutover is 670).

## For the Next Feature in This Set
- Read the canonical path via `spec-layout.getCanonicalSpecDirForEntity` / `findCanonicalSpecFile`;
  do not reconstruct `00-specs` literals.
- Under `specLayout: stable`, a spec's file location is fixed at `00-specs` for its whole lifetime —
  stage is derived from the workflow snapshot, not the folder. The generated lifecycle view (669) should
  project stage→folder as symlinks/links pointing back at the single canonical file.
- `buildMigrationPlan` already classifies active (in-progress/eval) entities as `needsAck`; the cutover
  member can reuse that to know which branches still reference legacy paths at merge.

## Test Coverage
- `tests/integration/spec-layout-migration.test.js` (12 tests): feature+research migration with rename
  history and commit; idempotent re-run; interrupted-run recovery; dirty-file block; duplicate-id block;
  destination-collision block; unnumbered→allocated ID; active-entity ack gate; symlink exclusion;
  git-branch backend does not alter the plan; resolver prefers canonical; CLI `status` smoke.
- Spec-declared validation green: `bootstrap-engine-state.test.js`, `spec-review-status.test.js`.

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-11

### Fixes Applied
- efd8f8eac — fix(review): commit layout version on no-op migrate and finish allocated-ID contract

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — `lib/dashboard-spec-index.js` and direct-scan dependency/set scanners remain stage-folder keyed; implementation log defers to set members 669–670 (lifecycle view / cutover).
- ESCALATE:subsystem — Migration does not rewrite workflow snapshot `specPath` fields; resolver-first read paths (entity-view, dashboard collector) compensate until lifecycle cutover (670).

### Notes
- Core migration engine, CLI wiring, resolver canonical-first lookup, and stable-layout creates look solid. Deferred scanner/index work is documented and consistent with the set plan.
