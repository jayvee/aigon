# Feature: test-suite-dry-and-reduce-to-ceiling

## Summary
The test suite sits at 2866 LOC against a hard ceiling of 2000 LOC (143% of budget, enforced by `scripts/check-test-budget.sh`). This feature does a disciplined pass to cut ~900 LOC without losing regression coverage, by parametrizing duplicate test variants, extracting shared helpers for duplicated boilerplate, pruning tests that cannot name a specific regression they prevent, and consolidating overlapping coverage between unit-style and e2e-style suites.

The work is mechanical for the first two phases (parametrization + helper extraction), then becomes a judgment pass for the final phase (T2 compliance pruning — deleting tests that accumulated without justification). Scope is strictly `tests/`; no production code changes.

## User Stories
- [ ] As a contributor, `bash scripts/check-test-budget.sh` passes after my feature branch — I can push without bumping the ceiling or skipping hooks.
- [ ] As a future contributor who adds a new test, the helpers I need (`GIT_SAFE_ENV`, delay constants, path-wait wrappers) live in `tests/_helpers.js` (or a dashboard-e2e equivalent) instead of being copy-pasted across files.
- [ ] As a reviewer, every remaining test has a `// REGRESSION:` comment naming the specific bug or feature it protects, per CLAUDE.md rule T2.
- [ ] As the repo maintainer, I can later delete a test file and trust that if it mattered, another test will still fail — because duplicate coverage between unit + e2e has been resolved deliberately instead of by accident.

## Acceptance Criteria
- [ ] `bash scripts/check-test-budget.sh` reports LOC ≤ 2000 and exits 0.
- [ ] `npm test` passes.
- [ ] `MOCK_DELAY=fast npm run test:ui` passes.
- [ ] Every remaining file in `tests/integration/` and `tests/dashboard-e2e/` contains at least one `// REGRESSION:` comment on each `test()` / `test.describe()` block (per CLAUDE.md T2). Tests that cannot name a specific regression are deleted, not given a throwaway comment.
- [ ] `GIT_SAFE_ENV` is defined exactly once (in `tests/_helpers.js`); no duplicate definitions in `tests/dashboard-e2e/setup.js`, `tests/integration/mock-agent.js`, `tests/dashboard-e2e/solo-lifecycle.spec.js`, or `tests/dashboard-e2e/solo-branch-lifecycle.spec.js`.
- [ ] `SOLO_DELAYS` and `FLEET_DELAYS` constants live in a single helpers file and are imported, not redeclared per spec.
- [ ] A shared `waitForPath(path, timeoutMs)` (or equivalent) wrapper exists in `tests/dashboard-e2e/_helpers.js` and replaces the ad-hoc 30s waits in `solo-lifecycle.spec.js`, `solo-branch-lifecycle.spec.js`, and `fleet-lifecycle.spec.js`.
- [ ] `tests/integration/workflow-definitions.test.js` only covers behavior (create / load / resolve / merge precedence); schema-validation-only tests are removed (they belong in a thinner unit test or are implicit in the integration behavior tests).
- [ ] No test in the final suite uses `withTempRepo` boilerplate with more than 10 lines of identical setup that could be absorbed into the helper itself.
- [ ] `CLAUDE.md` is updated if any phase requires changing the ceiling (not expected) or the testing-discipline rules — otherwise no `CLAUDE.md` changes.
- [ ] Commit history preserves the reason for each deletion: no mega-commits. Each deletion commit names the file(s) and either the LOC saved, the duplicate coverage found, or the regression it couldn't justify.

## Validation
```bash
bash scripts/check-test-budget.sh
npm test
MOCK_DELAY=fast npm run test:ui
```

Manual scenarios:
- [ ] Re-run `wc -l tests/**/*.js` after each phase and record cumulative savings in the feature log so cuts are measurable, not vibes.
- [ ] Pick one recently-committed real bug (e.g. the `solo-cx-reviewed-cc` workflow-stages fix from commit `18c86036`, or one of the F269 multiuser fixes) and verify by grep that at least one remaining test would fail if the bug were reintroduced. If not, add that test and delete something else to stay under budget.

## Technical Approach

### Baseline (measured 2026-04-19)
Total: 2866 LOC. Largest contributors:
- `tests/integration/lifecycle.test.js` — 281 LOC
- `tests/dashboard-e2e/fleet-lifecycle.spec.js` — 198 LOC
- `tests/integration/workflow-definitions.test.js` — 185 LOC
- `tests/dashboard-e2e/setup.js` — 179 LOC
- `tests/integration/mock-agent.js` — 177 LOC
- `tests/dashboard-e2e/_helpers.js` — 142 LOC
- `tests/dashboard-e2e/state-consistency.spec.js` — 139 LOC
- `tests/integration/seed-reset-helpers.test.js` — 127 LOC
- `tests/integration/agent-log-collector.test.js` — 113 LOC
- `tests/integration/feature-close-scan-target.test.js` — 107 LOC

### Phase 1 — Parametrization + consolidation (~325 LOC cut)
Executed as one commit per file so each saving is attributable.

| File | Action | LOC saved |
|------|--------|-----------|
| `tests/integration/lifecycle.test.js` | 11 tests → 6 parametrized rows; move telemetry sub-test out into its own file or delete if telemetry coverage is elsewhere | ~80 |
| `tests/integration/workflow-definitions.test.js` | Delete 11 trivial schema-validation tests (lines ~36–79); keep behavior tests (built-ins validate, resolve to usable autonomous inputs) | ~60 |
| `tests/integration/feature-close-scan-target.test.js` | Merge 4 variants of `resolveScanCwd` tests into 2 parametrized tests; drop trivial fake stubs | ~40 |
| `tests/integration/seed-reset-helpers.test.js` | Merge the two `cleanupSeedResetRemoteBranches` tests (worktree-exists=true vs false) into one parametrized test | ~35 |
| `tests/dashboard-e2e/solo-lifecycle.spec.js` + `tests/dashboard-e2e/solo-branch-lifecycle.spec.js` | Merge into one `solo-lifecycle.spec.js` with a `mode: 'worktree' \| 'branch'` parameter | ~35 |
| `tests/dashboard-e2e/state-consistency.spec.js` | Inline the `verifyStageActions()` helper at its two call sites; deduplicate the stages array | ~30 |
| `tests/dashboard-e2e/fleet-lifecycle.spec.js` | Reduce staggered `CC_DELAYS` / `GG_DELAYS` patterns using `test.describe` parametrization | ~25 |
| `tests/integration/remote-gate-github.test.js` | Parametrize the 20 closure-based tests (currently dense but parametrizable) | ~20 |

### Phase 2 — DRY extractions (~72 LOC cut, net)
Extract duplicated scaffolding into shared helpers. Done as a single commit to avoid churn.

- Move `GIT_SAFE_ENV` into `tests/_helpers.js`; delete 4 duplicates (~42 LOC net after the new definition is written)
- Define `SOLO_DELAYS` and `FLEET_DELAYS` in `tests/dashboard-e2e/_helpers.js`; import instead of redeclaring (~10 LOC)
- Add `waitForPath(path, timeoutMs = 30000)` to `tests/dashboard-e2e/_helpers.js`; replace ad-hoc waits in three specs (~20 LOC)

### Phase 3 — T2 compliance pruning (~150–250 LOC cut)
Walk every `test()` / `test.describe()` in `tests/integration/` and `tests/dashboard-e2e/`. For each:

1. Does it already have a `// REGRESSION:` comment naming a specific bug? → keep.
2. Can I write one honestly based on git history / feature specs? → add it.
3. Neither? → delete the test.

Do **not** invent regression stories to preserve tests. If a test looks like it was added defensively during a refactor rather than to pin a real bug, delete it — the e2e suite and the engine state machine tests cover the real lifecycle.

Candidates flagged in the audit for this phase: `agent-log-collector.test.js`, `migration.test.js`, `pro-gate.test.js`, `dashboard-pr-status-endpoint.test.js`, `iterate-flag-rename.test.js`, `repair-command.test.js`, `open-folder-button.spec.js`, plus any stragglers from phase 1 files.

### Phase 4 — Only if still over ceiling after phases 1–3
Structural moves (higher-risk, needs judgment call before executing):

- Move telemetry aggregation assertions out of `lifecycle.test.js` into `telemetry.test.js` if they exercise code not reached by the e2e lifecycle specs — otherwise delete.
- Review `lifecycle.test.js` engine-state assertions against what `solo-lifecycle.spec.js` + `fleet-lifecycle.spec.js` actually assert through the dashboard. Delete unit-style assertions that are already covered end-to-end, **keep** state-machine edge cases (invalid transitions, event-log structure, recovery scenarios) that e2e can't reach cheaply.

Target from this phase: up to 100 LOC if needed; stop as soon as budget is satisfied.

### Execution order
1. Phase 1 files one commit each (safe, mechanical).
2. Phase 2 helper extraction (one commit).
3. Run `bash scripts/check-test-budget.sh` — if already under 2000, stop and skip phase 3.
4. Phase 3 T2 compliance pass (one commit per file touched, with regression reasoning in each commit message).
5. Re-run budget check; run phase 4 only if still over.

After each phase: `npm test && MOCK_DELAY=fast npm run test:ui` before moving to the next. Any failure halts the run for diagnosis, not a blind revert.

## Dependencies
- None. Work is localized to `tests/`.

## Out of Scope
- Changing the 2000 LOC ceiling in `scripts/check-test-budget.sh`. If phase 4 cannot get below 2000 without deleting load-bearing coverage, stop and ask — do not raise the ceiling silently.
- Adding new tests for untested code paths (feature-close UI coverage gap, workflow CLI coverage) — track separately as a follow-up feature.
- Changing production code. Fixes discovered during the audit (e.g. a dead code path revealed by a deleted test) are logged for follow-up, not fixed in this feature.
- Refactoring the test runner (`tests/_helpers.js` test framework) itself. Only shared test data/constants/wrappers move; the harness stays as-is.

## Open Questions
- None pre-start. Questions raised mid-implementation should be resolved in-thread and noted in the feature log, not deferred.

## Related
- CLAUDE.md "Testing Discipline" section (rules T1, T2, T3) — this feature exists to restore T3 compliance.
- `scripts/check-test-budget.sh` — the enforcement mechanism being honored.
- Commit `18c86036` — example real-bug regression (built-in workflow stages) that a data-integrity test could pin.
- Research: none directly; audit performed 2026-04-19 in conversation with user before feature creation.
