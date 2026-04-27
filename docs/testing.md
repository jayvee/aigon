# Testing

**Goal: ship features fast. Tests exist to catch regressions, not to perform.** Every minute spent re-running a green suite is a minute taken from the next feature. This doc tells you the minimum testing required at each step of the lifecycle, where the rules live, and what NOT to do.

If you remember nothing else: **default to scoped (`npm run test:iterate`); full suite runs once before push.**

---

## The two gates

There are exactly two test gates. Do not invent a third. Do not collapse them into one.

### Iterate gate — runs constantly during work

```bash
npm run test:iterate
```

- **What it runs**: lint scoped to changed `lib/` files; integration + workflow tests whose filename matches keywords from `git diff`; a 5-test smoke fallback if no match. Lints + scoped tests + diagram check only when relevant.
- **What it skips**: Playwright UI suite (auto-runs ONLY if the diff touches `templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`); the LOC budget check; tests unrelated to changed files.
- **Wall-time target**: <30s for the typical iteration; ~2s for `lib/`-only changes with no dashboard touches.
- **Implementation**: `lib/test-loop/scoped.js`, `scripts/iterate-validate.js`.
- **When it fires**: every iteration of the autopilot loop (`aigon feature-do <ID> --iterate`); after any non-trivial code change you make manually.

### Pre-push gate — runs once, before `git push`

```bash
npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh
```

- **What it runs**: full integration + workflow suite (parallelised, ~12s), full Playwright UI suite (~76s), LOC budget check (~0.1s). Total: ~90s.
- **When it fires**: before `git push`, before `aigon agent-status implementation-complete`, before `feature-close` merges to main. Catches everything the iterate gate skipped.
- **Failures here block the push.** Do not skip with `--no-verify`. Do not proceed past a real failure — fix it.

The pre-push gate is the safety net that lets the iterate gate be aggressive. Trust it.

---

## What runs at each lifecycle step

This table is the authoritative answer for "what tests do I run when I'm doing X?"

| Lifecycle step | Tests that run automatically | What you (the agent) should do | What you should NOT do |
|---|---|---|---|
| **`feature-do` iteration** | `npm run test:iterate` invoked by the autopilot loop after each iteration | Trust the iterate gate. Fix what it surfaces. | Don't manually run `npm test`, `npm run test:ui`, or the full suite mid-iteration. |
| **`feature-do` end of work, before submit** | None automatic. Spec's `## Validation` block runs if present. | Quick sanity: `npm run test:iterate` once. If green, submit. | Don't re-run `npm test` "to be sure" — pre-push catches it. |
| **`feature-code-review` finding bugs** | None automatic. | If you made fixes, run the scoped tests for the files you changed (e.g. `node tests/integration/foo.test.js` for `lib/foo.js`). If the fix is cross-cutting, run `npm test`. See `templates/generic/commands/feature-code-review.md` Step 3.5. | Don't run the full Playwright suite. Don't run `npm test:ui`. |
| **`feature-code-revise` accepting/reverting/modifying** | None automatic. | If you accepted/modified, run scoped tests for changed files. Same logic as code-review. See `feature-code-revise.md` Step 4.5. | Same. |
| **`feature-close` (Drive mode)** | Triggers the **pre-push gate** as part of the merge sequence. | Let it run. Watch for failures. | Don't bypass with `--no-verify`. Don't push past a red gate. |
| **`feature-close` (Fleet, after adopting changes)** | Per `feature-close.md:114-117`: "After all adoptions are applied, run the project's test suite. Re-run tests until green." | Run `npm test` after each adoption batch; full pre-push gate before the merge. | Don't merge with adoptions unverified. |

**Rule of thumb:** if you didn't change code in this turn, you don't need to run any tests. If you changed code, the iterate gate is enough until pre-push.

---

## What agents MUST NOT do mid-work

These are anti-patterns that have repeatedly slowed the dev cycle. Don't:

1. **Run the full Playwright suite mid-iteration.** It takes ~76s. If your diff doesn't touch `templates/dashboard/**` or `lib/(dashboard|server)*.js`, you have nothing to verify there. The iterate gate will auto-include Playwright when relevant — trust it.
2. **Run `npm test` (full integration + workflow) "to be sure" between edits.** That's what `test:iterate` exists to scope. Re-running the full integration suite for a one-line change in `lib/scheduled-kickoff.js` runs 48 unrelated test files.
3. **Run `bash scripts/check-test-budget.sh` mid-iteration.** Budget is a pre-push concern. Mid-iteration it just adds noise.
4. **Re-run a green suite to "verify".** Per `feature-do.md:85`: "Ship within 60 seconds of green tests — don't re-run validation 'to be sure'."
5. **Add a test for code that already has coverage.** Per `AGENTS.md` T3, the suite has a hard 2,500-LOC ceiling; before adding, check if coverage already exists.

---

## Where the rules live (single source of truth map)

| Rule | Authoritative location |
|---|---|
| The two-gate system, exact commands | `CLAUDE.md` hot rule #6 |
| Testing Discipline (T1/T2/T3 — gates, new-code rule, LOC ceiling) | `AGENTS.md` § Testing Discipline |
| Per-iteration agent behaviour | `templates/generic/commands/feature-do.md:43–85` |
| Code-review post-fix tests | `templates/generic/commands/feature-code-review.md` Step 3.5 |
| Code-revise post-change tests | `templates/generic/commands/feature-code-revise.md` Step 4.5 |
| Fleet-close adoption tests | `templates/generic/commands/feature-close.md:88–117` |
| Iterate gate implementation | `lib/test-loop/scoped.js`, `scripts/iterate-validate.js` |
| Parallel test runner | `scripts/run-tests-parallel.js` |
| LOC budget enforcement | `scripts/check-test-budget.sh` (default ceiling 2,500 LOC) |
| Per-feature extra validation | The `## Validation` block in each feature spec |
| **This summary doc** | `docs/testing.md` (you are here) |

If those sources disagree, the order of precedence is: `CLAUDE.md` > `AGENTS.md` > templates > this doc. This doc is a digest, not the canon.

---

## Adding new tests (T2 + T3, summarised)

Full rules in `AGENTS.md` § Testing Discipline. Summary:

- **New non-trivial code or bug fix → ships with a test in the same commit.** Exceptions: pure config, pure docs, pure template edits, system-integration code (launchd, signals, sockets). State the exception in the commit message.
- **Every test includes a `// REGRESSION:` comment** naming the specific bug or behaviour it pins. If you can't write that comment, the test isn't worth keeping.
- **2,500-LOC ceiling on `tests/`.** Before adding, check whether an older test can be deleted (integration subsumes unit; code rewritten; duplicated coverage). Forbidden patterns: snapshot tests, mock-heavy tests where setup > assertions, trivial-getter tests, private-implementation tests.
- **Hitting the ceiling**: ask the user for a one-time bump, or delete a less-valuable test. Never raise the default silently.

---

## Test directory layout

```
tests/
├── _helpers.js              Shared test() / report() helpers
├── commands/                CLI command-handler tests (run via integration glob)
├── integration/             Engine + filesystem + workflow integration (~49 files)
├── workflow-core/           XState machine core invariants
├── utils/                   Shared test utilities
└── dashboard-e2e/           Playwright UI + lifecycle (the slow tier)
    ├── playwright.config.js
    ├── setup.js / teardown.js
    ├── solo-lifecycle.spec.js
    ├── fleet-lifecycle.spec.js
    └── state-consistency.spec.js
```

`npm test` runs `lint → workflow-diagrams check → tests/integration → tests/workflow-core`, all parallelised. `npm run test:ui` runs `tests/dashboard-e2e/` via Playwright.

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

- **"Why is the iterate gate running Playwright?"** Your diff touched a dashboard file. The scoped runner auto-includes Playwright when `templates/dashboard/**` or `lib/(dashboard|server)*.js` change. If you didn't mean to touch them, check `git status`.
- **"Why does my feature spec say `npm test && npm run test:ui` in Validation?"** That's the pre-push gate copied into a per-feature block. If your feature is `lib/`-only and you don't need UI verification per-iteration, **drop `npm run test:ui` from the spec's `## Validation` block** — keep it for the pre-push gate only. The default Pre-authorised template now includes "May skip `npm run test:ui` when this feature touches no dashboard assets" so this is the default, not opt-in.
- **"Why is `npm test` taking 90s?"** It shouldn't anymore. F381 parallelised `tests/integration/` and `tests/workflow-core/` — `npm test` should be ~12s on a clean checkout. If it's slower, check whether someone re-introduced the serial `for f in ...; do node "$f"; done` pattern in `package.json` scripts.
- **"The pre-push gate failed but my changes are unrelated."** Don't bypass it. Run the failing test in isolation (`node tests/integration/foo.test.js` or `npx playwright test tests/dashboard-e2e/foo.spec.js`) and either fix the regression or, if it's a flake, file a feature to de-flake it.
