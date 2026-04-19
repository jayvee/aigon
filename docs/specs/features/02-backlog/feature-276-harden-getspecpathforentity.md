# Feature: harden-getspecpathforentity

## Summary
`getSpecPathForEntity` in `lib/workflow-core/paths.js` is on the hot path for F270/F271/F272 and several CLI commands, but it silently picks an arbitrary file whenever two specs share an id prefix across stage dirs. That caused the jvbot rename bug during the F272 incident (see summary in commit `cbe3aeba`). This feature hardens the function so its behaviour is either correct or loudly refuses, removes the unsafe `.aigon/workflows/specs/` fallback branch that caused the F250-253 junk-dir moves, and centralises "canonical spec file for an entity" through a single well-tested helper.

## User Stories
- [ ] As a developer, when two id-prefixed spec files exist (e.g. after a folder rename or a bad copy), the resolver either returns the one the workflow engine knows about or fails loudly — never silently picks a sibling.
- [ ] As a user, a spec file is never resolved into `.aigon/workflows/specs/` as an "expected" path during normal operation.
- [ ] As a reviewer, all call sites of `getSpecPathForEntity` are reviewable in one pass — the contract is clear and the helpers are colocated.

## Acceptance Criteria
- [ ] When exactly one spec file matches an id prefix across visible stage dirs, `getSpecPathForEntity` returns `<specDir>/<basename>` unchanged. (current happy-path behaviour preserved)
- [ ] When two or more spec files match, the function picks the one matching the engine snapshot's recorded `specPath` (if available) or throws a clear error naming both conflicting files. No silent "first-wins" selection.
- [ ] When zero spec files match, behaviour is unchanged: returns `<specDir>/<padded-id>.md` as the workflow-expected fallback.
- [ ] The `.aigon/workflows/specs/<lifecycle>/` fallback branch in `getSpecStateDirForEntity` is removed. If a lifecycle key is missing from `LIFECYCLE_TO_{FEATURE,RESEARCH}_DIR`, the function throws with a message that points at the maps so the missing key can be added (fail-fast, no junk-dir targets).
- [ ] Existing stray files under `.aigon/workflows/specs/{inbox,done,implementing}/` (pre-existing `172.md`, `173.md`, and anything else) are left on disk untouched — this feature changes code, not data.
- [ ] All callers that relied on the `.aigon/workflows/specs/` fallback are either updated to provide the missing mapping or confirmed not to hit it (verified via grep + manual trace, covered by tests below).
- [ ] New unit tests cover: single-match happy path, duplicate-match with snapshot disambiguation, duplicate-match without snapshot (throws), zero-match fallback, missing-lifecycle throw.
- [ ] Net test-suite LOC change ≤ 0. New `tests/integration/spec-path-resolver.test.js` either replaces equivalent older drift/path tests 1-for-1, or is offset by deletions in the same commit. `bash scripts/check-test-budget.sh` passes at end of feature. (F274 landed the suite at 1974 LOC; this feature must not reopen the T3 budget fight.)
- [ ] Errors thrown for duplicate-without-disambiguation and missing-lifecycle cases use a consistent message shape so tests and log grepping are stable: `Spec path resolution failed for <entityType>#<entityId>: <reason>. <details>` — where `<reason>` is one of `duplicate-matches-no-snapshot-hint`, `duplicate-matches-snapshot-mismatch`, `unknown-lifecycle`, and `<details>` lists the relevant filenames / lifecycle value. Error shape is stable across both `getSpecPathForEntity` and `getSpecStateDirForEntity`.
- [ ] Pre-implementation lifecycle sweep has been run across all registered repos and the result is logged in the feature log. Any lifecycle values found in the wild that are not in `LIFECYCLE_TO_{FEATURE,RESEARCH}_DIR` must be either added to the map or noted as dead data before the throw-on-unknown-lifecycle change ships. Measured 2026-04-19: aigon + jvbot + aigon-pro snapshots use only {inbox, backlog, implementing, reviewing, evaluating, ready_for_review, closing, done, paused} — all present in the current maps.

## Validation
```bash
node --check aigon-cli.js
npm test
```

Manual scenarios:
- [ ] Create a duplicate id-prefixed spec across two stage dirs in a throwaway repo, run `aigon board` → no silent rename, clear error or correct selection.
- [ ] Temporarily corrupt a snapshot to have an unknown lifecycle value, run `aigon doctor --fix` → throws fail-fast rather than writing to `.aigon/workflows/specs/unknown/`.

## Technical Approach
- Refactor `getSpecPathForEntity` in `lib/workflow-core/paths.js`:
  - Collect all prefix matches across stage dirs into an array instead of returning the first.
  - If `matches.length === 1`, return `path.join(specDir, matches[0].file)`.
  - If `matches.length > 1`, check for a `snapshot.specPath` hint (read via an injected dependency to avoid circular import) and pick the one whose basename matches. If no snapshot hint is available or neither matches, throw a detailed `Error` naming every match.
  - If `matches.length === 0`, keep the current fallback.
- Delete the `.aigon/workflows/specs/<lifecycle>/` branch from `getSpecStateDirForEntity`. Replace with an exception when the lifecycle key is not in the map.
- Audit and update callers: search for `getSpecPathForEntity`, `getSpecStateDir`, `getSpecStateDirForEntity`. Any caller that must tolerate duplicates passes a snapshot hint; any caller that hits an unknown lifecycle gets fixed at the source (most likely by adding the missing key to the map).
- Add `tests/integration/spec-path-resolver.test.js` — kept under the test-suite LOC ceiling by removing any now-redundant drift tests that the new ones subsume.

## Dependencies
- None — standalone refactor. Builds on the detect-only F272 patch so misbehaving call sites no longer cause silent mutation, giving this refactor a safe landing zone.

## Out of Scope
- Changing the lifecycle taxonomy itself. Adding keys to `LIFECYCLE_TO_*_DIR` where they're missing is fine; renaming or removing existing keys is not.
- Cleaning up the pre-existing stray files under `.aigon/workflows/specs/`. Those are data, not code; a separate one-shot cleanup script or follow-up can address them.
- Broader snapshot-schema work. We read `snapshot.specPath` opportunistically; formalising it as mandatory is another feature.
- Migration of other path-helper functions (`getEntityRoot`, `getSnapshotPathForEntity`, etc.) — they don't share the duplicate-file hazard.

## Pre-start findings (measured 2026-04-19)

Both original open questions resolved with live data before start:

- **Fallback callers audit:** `grep -n "getSpecStateDirForEntity\|getSpecPathForEntity" lib/**/*.js` shows only three external callers of `getSpecPathForEntity` (`lib/feature-spec-resolver.js`, `lib/spec-reconciliation.js`, `lib/workflow-core/engine.js`) and zero external callers of `getSpecStateDirForEntity` (only internal use within `lib/workflow-core/paths.js`). No caller depends on the `.aigon/workflows/specs/<lifecycle>/` fallback branch. Safe to remove without a migration.
- **`snapshot.specPath` reliability:** every snapshot in every registered repo with workflow state has `specPath`. Verified counts: aigon 250/250, jvbot 64/64, aigon-pro 21/21 (brewboard was freshly seeded and has no workflows dir). Safe to use as the primary disambiguation hint; a fall-through to `snapshot.lifecycle` + padded-id naming is still worth implementing as defence-in-depth but is not the happy path.
- **Lifecycle values in the wild:** only {inbox, backlog, implementing, reviewing, evaluating, ready_for_review, closing, done, paused} observed; all are already in `LIFECYCLE_TO_{FEATURE,RESEARCH}_DIR`. No unmapped values will trip the new throw-on-unknown-lifecycle change.

## Open Questions

- None. Both original open questions resolved above.

## Related
- Research:
- Parent context: F272 incident summary in commits `cbe3aeba`, `98ed172b`
- Related: `lib/spec-reconciliation.js` (consumer), `lib/feature-spec-resolver.js` (parallel resolver)
