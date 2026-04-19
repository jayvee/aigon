# Feature: test-suite-reduce-back-under-2000

## Summary
Bring the test suite back under the 2000 LOC hard ceiling enforced by `scripts/check-test-budget.sh`. Current state: **2140 LOC / 2000 ceiling (107% of budget)**. F274 got the suite to 1974 LOC; then F271, F275, F276, and F277 each added new integration tests without offsetting deletions, drifting past the ceiling. F277's own AC required "Net test LOC change ≤ 0" and was merged with that AC unmet — this feature closes that gap **and** names the pattern explicitly so the next F28x-era feature doesn't repeat it.

This is not a carpet-bomb. It's a targeted trim guided by three questions asked of every test and every helper: (1) does it pin a specific named regression? (2) is its coverage already supplied by a broader test? (3) does its maintenance cost exceed the cost of a real bug sliding past? Anything where the honest answer is no, yes, or yes gets cut.

## User Stories
- [ ] As a contributor, `bash scripts/check-test-budget.sh` passes with at least 50 LOC of headroom so the next small feature doesn't immediately push the suite back over.
- [ ] As a reviewer, every remaining test has a `// REGRESSION:` comment naming the specific bug/feature it protects (per CLAUDE.md rule T2). Tests that can't justify themselves have been deleted, not given a throwaway comment.
- [ ] As a maintainer looking at an e2e flake, the shared setup/teardown/mock-agent helpers live in one place, not three — a fix to scaffolding propagates everywhere automatically.
- [ ] As someone onboarding to the codebase, the test tree is small enough to read in one sitting and understand what each file protects.

## Acceptance Criteria

### Hard gates
- [ ] `bash scripts/check-test-budget.sh` reports LOC ≤ 1900 (at least 100 LOC headroom under the 2000 ceiling) and exits 0.
- [ ] `npm test` exits 0.
- [ ] `MOCK_DELAY=fast npm run test:ui` exits 0.
- [ ] No test is deleted simply to hit the number. Every deletion is justified in the commit message against the three-questions test in the summary. Commit messages explicitly name either the deleted file, the coverage that now covers its regression, or the reason the regression it was pinning is no longer possible.
- [ ] At the end, the suite still catches **at least six specific named regressions** from 2026-04-18 / 2026-04-19 as a load-bearing check. Minimum list:
  1. F272 / `cbe3aeba` — reconciler moving files to junk dirs or renaming specs across duplicate prefixes.
  2. F271 / `936d2da7` — null entityId in research read-model.
  3. F271 / no-ID inbox items losing all validActions (today's `d015f7d1` fix).
  4. F270 / `1c2766bc` — `feature-prioritise` not creating a workflow snapshot.
  5. F277 / `b9c39a26` — autonomous feedback injection producing unrunnable `$aigon-…` phantom for cx.
  6. Today's `2047fd10` — four-in-one fix: error-swallowing in `formatCliError`, circular-require time-of-use bug in `utils.js`, log-dir false-match in `listVisibleSpecMatches`, `--full-auto` → `on-request` MCP approval bypass.
  Each regression must be grep-matchable in the surviving suite via an explicit `REGRESSION:` comment naming the commit or feature. If any is missing, add it as the deletion of an overlapping test frees budget.

### Surgical cuts — at minimum all of these
- [ ] **`tests/integration/spec-reconcile-endpoint.test.js` is fixed, not deleted.** Currently fails on main (F276's `unknown-lifecycle` throw in `getSpecStateDirForEntity` broke F275's endpoint test — classic read/write asymmetry). Either fix the endpoint handler to catch `unknown-lifecycle` and return 200 with `skipped: 'unknown-lifecycle'`, or change the test fixture to use a valid lifecycle and trigger the sandbox guard by a different vector. `npm test` must go green as part of this feature.
- [ ] **`tests/dashboard-e2e/state-consistency.spec.js` (~84 LOC)**: collapse the duplicated stage-action verifier (`verifyStageActions` helper used at two call sites) into inline assertions or move the helper to `tests/dashboard-e2e/_helpers.js` and have both spec files import it. Target saving: ≥20 LOC.
- [ ] **`tests/dashboard-e2e/fleet-lifecycle.spec.js` (~192 LOC)** and **`tests/dashboard-e2e/solo-lifecycle.spec.js` (~120 LOC)**: extract shared `waitForPath`, `GIT_SAFE_ENV`, `SOLO_DELAYS`/`FLEET_DELAYS`, and polling helpers into `tests/dashboard-e2e/_helpers.js`. Target combined saving: ≥40 LOC.
- [ ] **`tests/integration/remote-gate-github.test.js` (~107 LOC)**: parametrize the ~20 near-identical closure-based tests into a single data-table driver. Target saving: ≥20 LOC.
- [ ] **`tests/integration/autonomous-loop-injection.test.js` (~36 LOC, F277)** and **`tests/integration/agent-prompt-resolver.test.js` (~35 LOC)**: merge into one file — both cover agent-prompt-resolver behavior, one at launch time and one mid-session. The `buildReviewCheckFeedbackPrompt` gate assertions already overlap structurally with resolver-body assertions. Target saving: ≥20 LOC (one header/imports removed plus shared mock setup).
- [ ] **`tests/dashboard-e2e/setup.js` (~156 LOC)**, **`tests/dashboard-e2e/_helpers.js` (~138 LOC)**, **`tests/integration/mock-agent.js` (~160 LOC)**, **`tests/_helpers.js` (~58 LOC)**, **`tests/dashboard-e2e/teardown.js` (~48 LOC)**: audit for cross-file duplication. `GIT_SAFE_ENV` alone was identified as duplicated across four files earlier. Target combined saving: ≥30 LOC.

### Creative / judgment-call cuts (optional, needed if above doesn't hit 1900)
- [ ] **`tests/landing/home-carousel.spec.js` (~31 LOC)** and **`tests/landing/playwright.config.js` (~16 LOC)**: evaluate whether aigon (a CLI orchestration tool) needs Playwright coverage of its marketing landing page. If the carousel breaks in prod, a user-visible marketing bug, not a workflow bug — arguably belongs in site-level CI, not aigon's core test suite. Candidate for move to `site/` or deletion. Honest answer to "does this pin a specific regression?" should decide.
- [ ] **`tests/integration/migration.test.js` (~75 LOC)**: the migration framework in `lib/migration.js` is behind a feature flag and rarely fires. If no active migration is registered, the test exercises an inert code path. Candidate for deletion until the next real migration ships; then the test comes back with the migration, not independently.
- [ ] **`tests/integration/pro-gate.test.js` (~40 LOC)**: tests a ~25-line module. Likely over-tested for its surface area — one compact assertion on the env-var override behavior should suffice. Candidate for compression to ≤15 LOC or deletion if the env-var behavior is already covered incidentally.
- [ ] **`tests/integration/misc-command-wrapper.test.js` (~69 LOC)** and **`tests/integration/auto-session-state.test.js` (~66 LOC)**: audit for overlap with `lifecycle.test.js`. If the lifecycle integration test exercises the same write/read paths, these become redundant.
- [ ] **`tests/integration/stats-aggregate.test.js` (~26 LOC)** and **`tests/integration/feature-close-scan-target.test.js` (~79 LOC)**: audit for mock-heavy tests that verify implementation details rather than observable behavior. CLAUDE.md explicitly flags this pattern as a forbidden test shape.
- [ ] **`tests/integration/feature-close-restart.test.js` (~44 LOC)**: has the rebase drama that bit today; check whether the complicated env-restoration is testing a contract that could be expressed in 10 lines with a simpler mock.

### Parametrization pass
- [ ] **`tests/integration/lifecycle.test.js` (~183 LOC)**: if it still has 11 separate tests exercising variants of the same flow (discovered in earlier audit), parametrize into 4–6 rows. Expected saving: ≥30 LOC. **Keep** the engine state machine edge-case tests (invalid transitions, event-log structure, recovery scenarios) — those catch real regressions and aren't covered by e2e.

### Telemetry / anti-pattern enforcement
- [ ] `grep -rn 'it\.skip\|test\.skip\|describe\.skip' tests/` returns no results. A skipped test is a deleted-test-pretending-to-exist — delete it outright.
- [ ] `grep -rn '^\s*//\s*TODO' tests/` returns no more results than before the feature (no TODOs added during the trim).
- [ ] No file in `tests/integration/` or `tests/dashboard-e2e/` contains a test where the mock setup LOC exceeds the assertion count. Per CLAUDE.md T3 forbidden patterns.

## Validation
```bash
bash scripts/check-test-budget.sh                          # must pass with ≤1900
npm test                                                   # must pass
MOCK_DELAY=fast npm run test:ui                            # must pass
npx playwright test --config tests/landing/playwright.config.js 2>&1 || echo "landing tests OK to delete if moved"
grep -rn 'REGRESSION:' tests/ | wc -l                      # record before/after
wc -l tests/**/*.js | tail -1                              # total LOC before/after
```

Manual scenarios:
- [ ] For each of the six named regressions in the hard gates, run `grep -rn 'REGRESSION:' tests/ | grep -E '<commit-hash>|<feature-id>'` and confirm at least one match per regression. If any regression has no matching comment, add one to the nearest test that covers the bug's code path.
- [ ] Count `REGRESSION:` comments before and after the feature. The count should not decrease (tests may be consolidated, but their regression identifiers should survive into whichever test absorbs them).
- [ ] Run the implementer's own changes through the contract: is the deletion justified in a commit message that names what covers the regression now?

## Technical Approach

### Phase 1 — fix the broken test (prereq for `npm test` passing)
1. `tests/integration/spec-reconcile-endpoint.test.js` is currently 500-ing because F276's unknown-lifecycle throw short-circuits the sandbox guard. Either:
   - Fix the endpoint handler in `lib/dashboard-server.js` to catch `unknown-lifecycle` exceptions from `getSpecStateDirForEntity` and return 200 with `skipped: 'unknown-lifecycle'` — **preferred**, addresses the underlying read/write asymmetry for other callers too.
   - Or change the test fixture to trigger the sandbox guard by a different vector (e.g. craft a snapshot whose `specPath` points outside `docs/specs/` without using an unknown lifecycle value).
2. Commit this fix as its own commit — it unblocks the rest of the feature and also clears an existing main-is-red state independent of the budget work.

### Phase 2 — surgical parametrization (~90 LOC saved)
3. `lifecycle.test.js` parametrization pass: 11 tests → 5–6 rows. Preserve engine-state edge cases.
4. `remote-gate-github.test.js` parametrization: 20 closure tests → 1 data-table driver.
5. `autonomous-loop-injection.test.js` + `agent-prompt-resolver.test.js` merge into `agent-prompt-resolver.test.js`.

### Phase 3 — DRY helpers (~50 LOC net saved)
6. Move `GIT_SAFE_ENV`, `SOLO_DELAYS`, `FLEET_DELAYS`, `waitForPath(timeoutMs=30000)` into `tests/dashboard-e2e/_helpers.js`. Delete the duplicate definitions in `setup.js`, `mock-agent.js`, `solo-lifecycle.spec.js`, `solo-branch-lifecycle.spec.js`.
7. `state-consistency.spec.js` verifier inlining or shared-helper lift.

### Phase 4 — T2/T3 compliance pass (remaining budget)
8. Walk every remaining `test()` / `test.describe()`. For each:
   - Has `// REGRESSION:` naming a specific bug? → keep.
   - Can a specific regression be honestly named from git history? → add comment, keep.
   - Neither? → **delete**. Do not invent regression stories to preserve tests.
9. Special attention to: `pro-gate.test.js`, `migration.test.js`, `stats-aggregate.test.js`, `feature-close-scan-target.test.js`, `auto-session-state.test.js`, `misc-command-wrapper.test.js`, `agent-log-collector.test.js`, `dashboard-pr-status-endpoint.test.js`, `iterate-flag-rename.test.js` if it exists, `repair-command.test.js` if it exists.

### Phase 5 — landing-page spec relocation (optional, if budget needs more room)
10. Evaluate moving `tests/landing/` out of aigon's test budget. Options:
    - Move to `site/tests/` and update CI to run them alongside the site build.
    - Delete if the marketing-page carousel isn't a regression-catching test.
    - Keep if it protects a specific named bug (check git blame for the commit that added it).

### Phase 6 — validate the named-regression gate
11. Before committing the final trim, grep for each of the six named regressions. If any is missing, add a `REGRESSION:` comment to the nearest covering test, or if no covering test exists, add a minimal one and free the LOC from the weakest remaining test.

### Execution order & commit discipline
Each phase is its own commit (or commit cluster) with a message naming exactly what was removed and why. **No single "trim tests" mega-commit**. If a deletion requires an offsetting new test, they ship in the same commit so reviewers can see both sides.

After each phase: `npm test && bash scripts/check-test-budget.sh && MOCK_DELAY=fast npm run test:ui`. Any failure halts — diagnose, don't plough through.

## Dependencies
- None code-level. Work is localized to `tests/` plus one possible fix in `lib/dashboard-server.js` (the spec-reconcile unknown-lifecycle catch, if that path is chosen).
- Builds on F274 (which did the last carpet-trim from 2998 → 1974) and on F277's contract-test addition that pushed us over. Inherits the same discipline: no ceiling bumps, only deletions or consolidations.

## Out of Scope
- Raising the 2000 LOC ceiling in `scripts/check-test-budget.sh`. This feature exists to honor the ceiling, not to change it. If after all the above the budget is still red, STOP and ask the user — do not raise silently.
- Rewriting the test harness (`tests/_helpers.js` test runner primitives). Only data/constants/wrapper helpers move; the `test()` / `testAsync()` / `withTempDir()` primitives stay as-is.
- Adding new tests for untested code paths. That's a separate feature. This feature is **subtractive only** plus the one `spec-reconcile-endpoint` fix.
- Moving tests between integration and unit categories. Keep existing directory structure.
- Enforcement tooling changes (e.g. pre-commit hooks, lint rules for REGRESSION comments). Also a separate feature.

## Open Questions
- **Is `tests/landing/` worth keeping in aigon at all?** It tests a marketing page for a product that aigon *describes* but isn't part of the CLI workflow. Strong candidate for moving to `site/` or deleting. Resolve by checking whether any specific bug was pinned by these tests in git blame — if yes, keep; if no, cut.
- **Should the spec-reconcile endpoint handler catch `unknown-lifecycle` or should the test be changed?** Prefer handler fix — it also protects future callers. But the endpoint might be designed to fail hard on unknown states. Check `lib/dashboard-server.js` endpoint semantics before committing either direction.
- **Is parametrizing `remote-gate-github.test.js` actually a reduction?** Its 20 tests in 107 LOC is already dense (~5 LOC/test). A data-table might not save much once the table LOC is counted. Measure before committing — if the saving is <10 LOC, skip this candidate and find an alternative.
- **Budget target: 1900 (100 headroom) or 1800 (200 headroom)?** 1900 is the AC; going tighter gives more runway for future features. Decide at the end based on how much genuine cruft was found — if the trim finds obvious dead code, take it all; if each further LOC costs a real test, stop at 1900.

## Related
- CLAUDE.md "Testing Discipline" (T1/T2/T3) — this feature exists to restore T3 compliance.
- `scripts/check-test-budget.sh` — enforcement mechanism.
- F274 `test-suite-dry-and-reduce-to-ceiling` — the previous trim that this feature follows up on. Lessons: deletions must ship with their justification in the commit message; net-zero-LOC AC is only enforceable with an explicit gate (which F274 had, F277 ignored).
- F277 `harden-autonomous-loop-write-paths` — shipped with an explicit "Net test LOC change ≤ 0" AC that was ignored at close. This feature fixes that gap and names the pattern so the next feature doesn't repeat it.
- F271, F275, F276 — each added integration tests contributing to the current overage.
- Commits from 2026-04-18 / 2026-04-19 referenced in the named-regression gate above.
