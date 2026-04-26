---
complexity: high
agent: cc
---

# Feature: slash-test-loop-runtime

## Summary

The Aigon iterate loop currently runs the **entire** test suite (integration + workflow + Playwright UI) after every iteration of every feature, regardless of what files changed. A `lib/`-only change with zero dashboard impact still pays the full Playwright cost. This is unacceptable: it has stretched the iterate cycle to 5–10 minutes per pass for trivial features and is now actively slowing every contributor and every agent.

This feature **rips out** the unconditional full-suite gate from the iterate loop and replaces it with a **scoped, fast** smoke set that runs in seconds. The full suite runs **only at submit time** (the existing pre-push gate), not on every iteration. The change is mostly *deletion* of safety theatre, not addition of cleverness — per the project rule that simplification means removing layers, not adding smarter ones.

Three cuts:

1. **Iterate loop default = scoped smoke set.** Detect changed paths via `git diff --name-only`; run only the test files whose targets match (or a fast smoke suite if nothing matches). Target: <30 seconds for the typical iteration.
2. **`npm run test:ui` removed from the iterate loop entirely.** Playwright runs only at submit/pre-push, OR when the iteration touched `templates/dashboard/**` or `lib/dashboard*.js` / `lib/server*.js`. No exceptions.
3. **Parallelise the integration + workflow suites.** They currently run serially via a shell `for` loop (`package.json:test:integration`, `:test:workflow`). Convert to parallel execution. Target: 3–5× speedup on the full suite when it does run.

## User Stories
- [ ] As a developer, when I iterate on a `lib/`-only feature, the iterate loop validation completes in **under 30 seconds**, not 5–10 minutes.
- [ ] As an agent implementing a feature, I never run `npm run test:ui` mid-iteration unless I touched dashboard files.
- [ ] As a developer, the full pre-push gate still catches what it always caught — no regressions in pre-push coverage.
- [ ] As a developer, the full suite (`npm run test:all`) finishes in **under 90 seconds** total wall-time once parallelised, vs. the current several-minute serial run.
- [ ] As an agent reading a feature spec, the new spec template default Pre-authorised section already includes "skip test:ui when feature is lib-only" so future specs don't have to remember.

## Acceptance Criteria
- [ ] **Iterate-loop change.** Wherever the iterate loop currently invokes `npm test && npm run test:ui && bash scripts/check-test-budget.sh`, replace with a scoped runner that:
  - Runs `eslint` only on changed `lib/**/*.js` files (`eslint <files>`, not the full glob).
  - Runs `node scripts/generate-workflow-diagrams.js --check` only if `lib/workflow*.js` or templates were touched.
  - Runs the subset of `tests/integration/*.test.js` + `tests/workflow-core/*.test.js` whose **filename** contains a keyword from the changed paths (e.g. change `lib/scheduled-kickoff.js` → run any test file matching `scheduled` / `kickoff`). If no match, run a designated smoke set (≤5 tests covering core flows: spec resolver, workflow snapshot, command dispatch, recurring engine, server boot smoke).
  - **Never** runs `npm run test:ui` in the iterate loop unless changed paths intersect `templates/dashboard/**` or `lib/(dashboard|server)*.js`.
  - **Never** runs `bash scripts/check-test-budget.sh` in the iterate loop. Budget check is a pre-push concern, not a per-iteration concern.
- [ ] **Submit/pre-push gate unchanged.** The existing CLAUDE.md hot rule #6 (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`) remains the gate before `git push`. This feature does not weaken pre-push.
- [ ] **Parallel test runners.** `package.json` `test:integration` and `test:workflow` scripts use a parallel runner (e.g. `node --test tests/integration/*.test.js` if compatible, or a `xargs -P` invocation, or `concurrently` — implementer's call, document the choice). All test files must remain runnable individually for debugging.
- [ ] **Wall-time targets** (measured on the maintainer's machine, recorded in the implementation log):
  - Iterate loop, `lib/`-only change: **≤30 seconds**.
  - Full `npm test` (lint + diagram + integration + workflow): **≤45 seconds**.
  - Full `npm run test:all` (above + Playwright): **≤90 seconds**.
  - If any target is missed, the implementer documents *why* and the gap in the log.
- [ ] **Spec template update.** The default Pre-authorised block in `templates/generic/commands/feature-create.md` (or wherever the spec template lives) gains a standing line: *"May skip `npm run test:ui` when this feature touches no dashboard assets."* — so this is the **default**, not opt-in.
- [ ] **Agent instructions update.** `CLAUDE.md` and `AGENTS.md` get a new section explicitly stating: "Iterate-loop validation is scoped, not full. Full suite runs only at pre-push / submit time. Agents must NOT manually run `npm run test:ui` mid-iteration unless a dashboard change demands it."
- [ ] **Removed**: any code path in `lib/` that *currently* triggers full-suite validation per iteration. Don't leave it commented out — delete it.
- [ ] No new npm dependencies unless absolutely required for parallelism (and even then, prefer Node 22's built-in `node --test` parallelism over a new dep).
- [ ] All existing tests still pass (run via the new parallel runner). Pre-push gate still green.

## Validation
```bash
# Iterate-loop smoke timing — should print well under 30s for a lib-only diff
time node lib/iterate-validate.js   # or whatever the scoped entry point is named
# Full suite timing
time npm test
time npm run test:ui
```

## Pre-authorised
- May delete any test that exists solely to verify a now-removed code path (e.g. tests covering the old full-suite iterate gate).
- May raise `scripts/check-test-budget.sh` CEILING by up to **−** (i.e., ceiling should likely *drop*, not rise — deletions are the bias here).
- May refactor `package.json` scripts freely as long as backwards-compatible aliases exist for existing CI-style invocations.
- May skip `npm run test:ui` for this feature — it is `lib/` + scripts + docs only with no dashboard asset changes.
- May add a single small parallelism dep (e.g. `concurrently` or equivalent ≤30KB MIT/Apache) ONLY if Node's built-in `node --test` parallel mode proves insufficient. Default = use the built-in.

## Technical Approach

### Find where the iterate loop runs validation
Likely candidates: `lib/commands/feature.js`, `lib/iterate*.js` (if any), or the worktree-setup scripts in `templates/generic/commands/`. Implementer should grep for `npm test`, `test:ui`, `check-test-budget` to enumerate every invocation point. Replace each with a call to the new scoped runner.

### New scoped runner: `lib/test-loop/scoped.js`
Single function `runScopedValidation({ changedPaths }) → { ok, durationMs, ranTests }`. Logic:
1. Compute changed paths (`git diff --name-only HEAD@{1} HEAD || git status --porcelain` — implementer picks).
2. Compute keyword set (basenames + path segments minus extensions).
3. Run lint scoped to changed `lib/` files.
4. Run integration + workflow tests whose filename contains any keyword. If empty match set, run the smoke set (~5 hand-picked tests).
5. Run diagram check only if relevant paths touched.
6. **Skip Playwright entirely** unless `templates/dashboard/**` or dashboard server modules touched.
7. Return result.

### Parallel runners
Convert `package.json:test:integration` from `for f in ...; do node "$f"; done` to `node --test --test-concurrency=$(nproc) tests/integration/*.test.js` (Node ≥20 supports `--test`). Same for workflow. If individual tests assume serial execution (shared state, fixed ports), gate them with `node:test`'s `{ concurrency: false }` per-test or move them to a serial subdirectory.

### Smoke set
Curated list of 5 tests that exercise: spec-resolver, workflow snapshot adapter, command dispatch, recurring engine sanity, server boot smoke. Lives at `tests/smoke/index.js` and runs in <5 seconds. Used as fallback when scoped match returns empty.

### Spec template update
The "Pre-authorised" comment block in the feature-create template currently shows two example pre-auths. Add a third **default-on** pre-auth: skip `test:ui` for non-dashboard features. Wording so it's clear it's the *default*, not opt-in.

### Agent instructions
- `CLAUDE.md`: new hot rule replacing or amending #6 — make it explicit that iterate-loop ≠ pre-push.
- `AGENTS.md`: deeper section explaining the tier system (iterate / submit / pre-push) and listing the smoke set.

### Why `complexity: high`
- Cross-cuts engine (`lib/`), templates, agent instructions, package.json scripts, and the test infrastructure itself.
- Has to delete code carefully — the existing full-suite gate is load-bearing in some flows.
- Risk of weakening pre-push coverage if the line between iterate and pre-push gets blurred. Implementer must keep them sharply distinct.

## Dependencies
- None new. Uses Node's built-in `--test` runner if it works; fallback to a single small parallel-runner dep only as last resort.

## Out of Scope
- **Rewriting individual slow tests.** Targeting infrastructure here, not test bodies. If specific tests are pathologically slow after parallelisation, file separate features per slow test.
- **Replacing Playwright** for the dashboard suite. Keep Playwright; just stop running it mid-iterate.
- **Changing the test-budget ceiling enforcement.** Budget check stays at pre-push; this feature only removes it from per-iteration.
- **CI configuration.** No GitHub Actions changes; pre-push gate stays the same; CI will benefit automatically from the parallel scripts.
- **Adding test-coverage reporting.** Out of scope.

## Open Questions
- Is there a hidden code path that re-invokes the full suite from inside `npm test` that I'm not seeing? Implementer should grep aggressively for `test:ui` and `test:all` and walk every caller.
- Does Node's built-in `--test` runner handle test isolation well enough for our integration tests, or do they share state (temp dirs, ports) that requires explicit serial blocks?
- Smoke-set membership: which 5 tests? Implementer picks during iteration and documents in the log; final list approved at review.

## Related
- Research: none.
- Set: standalone urgent.
- Prior features in set: none.
