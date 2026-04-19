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

## Open Questions
- Is there any legitimate caller that _relies_ on the `.aigon/workflows/specs/<lifecycle>/` fallback to write workflow-internal stub specs? Grep suggests no, but worth confirming during implementation.
- For the duplicate-match disambiguation, is `snapshot.specPath` reliable across all entities and historical snapshot shapes? Might need a fall-through to `snapshot.lifecycle`-derived dir + `snapshot.featureId` / `snapshot.researchId` name conventions.

## Related
- Research:
- Parent context: F272 incident summary in commits `cbe3aeba`, `98ed172b`
- Related: `lib/spec-reconciliation.js` (consumer), `lib/feature-spec-resolver.js` (parallel resolver)
