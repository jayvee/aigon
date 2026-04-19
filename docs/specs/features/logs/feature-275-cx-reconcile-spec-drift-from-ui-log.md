# Implementation Log: Feature 275 - reconcile-spec-drift-from-ui
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc (Claude)
**Date**: 2026-04-19

### Scope reviewed
Three commits on `feature-275-cx-reconcile-spec-drift-from-ui`:
- `5e2178a4 feat: add spec drift reconciliation from dashboard`
- `ee2ce3ad fix: make restart test ignore dashboard env`
- `4587f8dc test: validate board drift via projected items`

### Findings
- **Acceptance criteria**: all 10 AC bullets from the spec are satisfied.
  `specDrift` exposed via the read model with `{ currentPath, expectedPath, lifecycle }`,
  `POST /api/spec-reconcile` wired and outside-`docs/specs/` guard covered by integration test,
  `AIGON_AUTO_RECONCILE=1` opt-in preserved via `reconcileMutates` flag in
  `lib/workflow-read-model.js:119`, board list/kanban show `⚠ drift` suffix, and
  `RECONCILE_SPEC_DRIFT` action lives in both workflow-rules registries with
  `bypassMachine: true` per CLAUDE.md rule 8.
- **Idempotency**: concurrent-click safety is backed by the new ENOENT catch in
  `lib/spec-reconciliation.js:324` — second click returns `driftDetected:false` when
  the source is already gone and the target is in place.
- **Security**: outside-docs guard in `reconcileResolvedSpec` is exercised end-to-end
  through the HTTP endpoint by `tests/integration/spec-reconcile-endpoint.test.js`.
- **Action derivation context**: `workflow-read-model.js` passes `specDrift` into
  `enrichSnapshotWithInfraData` via a shallow-merged `actionContext` so the
  `RECONCILE_SPEC_DRIFT` guard in the registry evaluates against the snapshot-shaped
  object. Clean approach.

### Fixes Applied
None. Implementation is correct and matches the spec.

### Non-blocking notes for the user
- The empty `Plan / Progress / Decisions` sections above are cx's log style; the
  commit messages carry the intent.
- `scripts/check-test-budget.sh` reports **2144 LOC vs 2000 ceiling** on this branch.
  Main is already over ceiling (2072 LOC before this feature), so this feature
  did not raise the ceiling silently — but the budget script will block pre-push
  until the suite is trimmed or the ceiling is bumped. Not a code bug in this
  feature; flagged here so you can decide whether to trim tests before merge or
  defer to a cleanup pass.
- A `Warning: Accessing non-existent property 'readConductorReposFromGlobalConfig'
  of module exports inside circular dependency` fires when running the new
  `spec-reconcile-endpoint.test.js`. Same warning exists on main from the same
  import path — not introduced here.
