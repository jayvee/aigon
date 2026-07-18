# Testing

**Goal: ship features fast. Tests exist to catch regressions, not to perform.** Every minute spent re-running a green suite is a minute taken from the next feature. This doc tells you the minimum testing required at each step of the lifecycle, where the rules live, and what NOT to do.

If you remember nothing else: **default to scoped (`npm run test:iterate`); rerun the failed file; full release suites are explicit, rare, and operator-driven.**

---

## Test stages

There are four named stages. The iterate gate and deploy gate are the two lifecycle checkpoints. The others are building blocks.

| Script | What it runs | When to use |
|---|---|---|
| `npm run test:quick` | alias for `test:iterate` | shorthand |
| `npm run test:iterate` | scoped lint + matched integration/workflow tests + smoke fallback | every code change mid-iteration |
| `npm run test:core` | lint + workflow diagram check + fast integration + workflow | normal non-browser safety gate |
| `npm run test:core:full` | `test:core` + heavyweight unit/integration files | release triage only |
| `npm run test:browser` | alias for browser smoke | normal browser safety gate |
| `npm run test:browser:full` | full Playwright E2E suite (`MOCK_DELAY=fast`) | release triage only |
| `npm run test:browser:smoke` | Playwright @smoke subset only | auto-run by iterate gate on dashboard-file changes |
| `npm run test:deploy` | `test:core` + browser smoke + budget check | **deploy gate** — run before `git push` / `feature-close` |
| `npm run test:release` | full heavyweight integration + security/audit + full Playwright + budget | maintainer release check |
| `npm run test:all` | alias for `test:release` | |
| `npm test` | same as `test:core` | backwards compat; kept for existing tooling |
| `npm run test:ui` | same as `test:browser` | backwards compat; kept for existing tooling |

### Iterate gate — runs constantly during work

```bash
npm run test:iterate
```

- **What it runs**: lint scoped to changed `lib/` files; integration + workflow tests whose filename matches keywords from `git diff`; a 5-test smoke fallback if no match. Lints + scoped tests + diagram check only when relevant.
- **What it skips**: full Playwright suite (`test:browser:full`); LOC budget check; tests unrelated to changed files.
- **Dashboard touch**: when the diff includes `templates/dashboard/**`, `lib/dashboard*.js`, or `lib/server*.js`, the iterate gate automatically runs `test:browser:smoke` (Playwright @smoke subset, ~fast) instead of the 2-minute full browser suite.
- **Wall-time target**: <30s for the typical iteration; ~2s for `lib/`-only changes with no dashboard touches.
- **Implementation**: `lib/test-loop/scoped.js`, `scripts/iterate-validate.js`.
- **When it fires**: every iteration of the autopilot loop (`aigon feature-do <ID> --iterate`); after any non-trivial code change you make manually.

### Deploy gate — runs once, before `git push`

```bash
npm run test:deploy
```

- **What it runs**: `test:core` (lint + diagrams + fast integration + workflow) + browser smoke + `scripts/check-test-budget.sh`.
- **When it fires**: before `git push`, before `aigon agent-status implementation-complete`, before `feature-close` merges to main. Catches everything the iterate gate skipped.
- **Failures here block the push.** Do not skip with `--no-verify`. Do not proceed past a real failure — fix it.

The deploy gate is the safety net that lets the iterate gate be aggressive. Trust it.

---

## What runs at each lifecycle step

This table is the authoritative answer for "what tests do I run when I'm doing X?"

| Lifecycle step | Tests that run automatically | What you (the agent) should do | What you should NOT do |
|---|---|---|---|
| **`feature-do` iteration** | `npm run test:iterate` invoked by the autopilot loop after each iteration | Trust the iterate gate. Fix what it surfaces. | Don't manually run `npm test`, `test:browser`, `test:deploy`, or `test:ui` mid-iteration. |
| **`feature-do` end of work, before submit** | None automatic. Spec's `## Validation` block runs if present. | Quick sanity: `npm run test:iterate` once. If green, submit. | Don't re-run the full suite "to be sure" — the deploy gate catches it. |
| **`feature-code-review` making fixes** | None automatic. | **Reviewers do not run tests.** Record `Validation not run by reviewer per policy` in the review log. The implementor owns validation after revision. | Don't run any test command — not even `test:iterate`. |
| **`feature-code-revise` accepting/reverting/modifying** | None automatic. | Run `npm run test:iterate` for the files you changed after accepting/modifying. See `feature-code-revise.md` Step 4.5. | Don't run the full browser suite. |
| **`feature-close` (Drive mode)** | Triggers the **deploy gate** as part of the merge sequence. | Let it run. Watch for failures. | Don't bypass with `--no-verify`. Don't push past a red gate. |
| **`feature-close` (Fleet, after adopting changes)** | Per `feature-close.md:114-117`: "After all adoptions are applied, run the project's test suite. Re-run tests until green." | Run `npm run test:deploy` after each adoption batch. If one file fails, rerun that file directly after the fix. | Don't restart the full suite after a single-file failure. |

**Rule of thumb:** if you didn't change code in this turn, you don't need to run any tests. If you changed code, the iterate gate is enough until the deploy gate.

---

## What agents MUST NOT do mid-work

These are anti-patterns that have repeatedly slowed the dev cycle. Don't:

1. **Run the full Playwright suite mid-iteration.** It takes ~76s. If your diff doesn't touch `templates/dashboard/**` or `lib/(dashboard|server)*.js`, you have nothing to verify there. The iterate gate will auto-include browser smoke when relevant — trust it.
2. **Run `npm test` "to be sure" between edits.** That's what `test:iterate` exists to scope.
3. **Run `bash scripts/check-test-budget.sh` mid-iteration.** Budget is a deploy-gate concern. Mid-iteration it just adds noise.
4. **Re-run a green suite to "verify".** Per `feature-do.md:85`: "Ship within 60 seconds of green tests — don't re-run validation 'to be sure'."
5. **Restart a full suite after one file fails.** Run the exact failed file first, for example `node tests/integration/spec-author-provenance.test.js`. Only run a broader command when the targeted file is green and the operator asks for a gate.
6. **Add a test for code that already has coverage.** Per `AGENTS.md` T3, the suite has a hard LOC ceiling (see `scripts/check-test-budget.sh` for the current value); before adding, check if coverage already exists.

---

## Where the rules live (single source of truth map)

| Rule | Authoritative location |
|---|---|
| Test stage commands | `CLAUDE.md` hot rule #6 |
| Testing Discipline (T1/T2/T3 — gates, new-code rule, LOC ceiling) | `AGENTS.md` § Testing Discipline |
| Per-iteration agent behaviour | `templates/generic/commands/feature-do.md` |
| Reviewer no-tests policy | `templates/generic/commands/feature-code-review.md` Step 3.5 |
| Code-revise post-change tests | `templates/generic/commands/feature-code-revise.md` Step 4.5 |
| Fleet-close adoption tests | `templates/generic/commands/feature-close.md` |
| Iterate gate implementation | `lib/test-loop/scoped.js`, `scripts/iterate-validate.js` |
| Parallel test runner | `scripts/run-tests-parallel.js` |
| LOC budget enforcement | `scripts/check-test-budget.sh` (ceiling in file header) |
| Per-feature extra validation | The `## Validation` block in each feature spec |
| Root agent-instruction size and safety anchors | `scripts/check-root-instruction-budget.js` (wired into `test:core` and `prepublishOnly`) |
| **This summary doc** | `docs/testing.md` (you are here) |

If those sources disagree, the order of precedence is: `CLAUDE.md` > `AGENTS.md` > templates > this doc. This doc is a digest, not the canon.

---

## Adding new tests (T2 + T3, summarised)

Full rules in `AGENTS.md` § Testing Discipline. Summary:

- **New non-trivial code or bug fix → ships with a test in the same commit.** Exceptions: pure config, pure docs, pure template edits, system-integration code (launchd, signals, sockets). State the exception in the commit message.
- **Every test includes a `// REGRESSION:` comment** naming the specific bug or behaviour it pins. If you can't write that comment, the test isn't worth keeping.
- **Hard LOC ceiling on `tests/`** (see `scripts/check-test-budget.sh` for the current value). Before adding, check whether an older test can be deleted (integration subsumes unit; code rewritten; duplicated coverage). Forbidden patterns: snapshot tests, mock-heavy tests where setup > assertions, trivial-getter tests, private-implementation tests.
- **Hitting the ceiling**: ask the user for a one-time bump, or delete a less-valuable test. Never raise the default silently.

---

## Test directory layout

```
tests/
├── _helpers.js              Shared test() / report() helpers
├── commands/                CLI command-handler tests (run via integration glob)
├── integration/             Engine + filesystem + workflow integration
├── workflow-core/           XState machine core invariants
├── utils/                   Shared test utilities
└── dashboard-e2e/           Playwright UI + lifecycle (the slow tier)
    ├── playwright.config.js
    ├── setup.js / teardown.js
    ├── solo-lifecycle.spec.js
    ├── fleet-lifecycle.spec.js
    └── state-consistency.spec.js
```

`npm test` / `npm run test:core` runs `lint → workflow-diagrams check → fast tests/integration → tests/workflow-core`, all parallelised. `npm run test:browser` / `npm run test:ui` runs only the smoke browser subset. `npm run test:browser:full` runs all Playwright tests. `npm run test:deploy` chains core + browser smoke + budget. `npm run test:release` is the heavyweight maintainer gate.

---

## Writing tests

All test files use Node's built-in `assert` — no test framework. Each file is a standalone Node script run by `scripts/run-tests-parallel.js`. Files must remain runnable individually for debugging (`node tests/integration/foo.test.js`).

Pattern:

```js
const assert = require('assert');
let passed = 0, failed = 0;

function test(description, fn) {
    try { fn(); console.log(`  ✓ ${description}`); passed++; }
    catch (err) { console.error(`  ✗ ${description}\n    ${err.message}`); failed++; }
}

// REGRESSION: <one line naming the bug or behaviour this pins>
test('does the thing', () => { assert.strictEqual(1 + 1, 2); });

console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

For async tests, collect promises and `Promise.all()` them before reporting. Playwright tests use `@playwright/test` with the config in `tests/dashboard-e2e/playwright.config.js`.

---

## Common surprises (read these before complaining about test runtime)

- **"Why is the iterate gate running Playwright?"** Your diff touched a dashboard file. The scoped runner auto-includes the `@smoke` browser subset when `templates/dashboard/**` or `lib/(dashboard|server)*.js` change. If you didn't mean to touch them, check `git status`.
- **"Why does my feature spec say `npm test && npm run test:ui` in Validation?"** That's the old pre-push gate. Update any such spec blocks to use `npm run test:deploy` — or drop `test:browser`/`test:ui` from the per-feature block if the feature is `lib/`-only and doesn't need browser verification mid-iteration. The Pre-authorised default authorises skipping browser tests mid-iteration.
- **"Why is `npm test` taking 90s?"** It shouldn't. `npm test` (`test:core`) is the fast non-browser gate. If it's slow, check whether someone moved heavyweight files back into `test:unit` / `test:integration` or re-introduced a serial runner pattern in `package.json` scripts. The slow tiers are `test:unit:heavy`, `test:integration:heavy`, and `test:browser:full`; they belong in `test:release`, not mid-iteration.
- **"The deploy gate failed but my changes are unrelated."** Don't bypass it. Run the failing test in isolation (`node tests/integration/foo.test.js` or `npx playwright test tests/dashboard-e2e/foo.spec.js`) and either fix the regression or, if it's a flake, file a feature to de-flake it. Do not restart the full gate until the failed file is green.
