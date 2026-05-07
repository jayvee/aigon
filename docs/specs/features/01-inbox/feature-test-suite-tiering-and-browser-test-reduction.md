---
complexity: high
---

# Feature: test suite tiering and browser test reduction

## Summary

The test suite has become too expensive for the agent lifecycle. Implementors and reviewers are repeatedly tempted to run broad validation even though the repo already has an intended iterate/pre-push split. This feature makes that split enforceable: reviewers do not run tests, implementors run scoped validation, and the slow browser tier runs only at deploy/pre-push. It also reduces the current load by speeding up the slowest integration test, demoting overlapping Playwright lifecycle coverage, and updating stale docs that still describe obsolete test commands and LOC budgets.

## Background

Current measurements from the local repo on 2026-05-07:

- `npm run test:integration` ran 77 files in about 16s with concurrency 9, but failed in `tests/integration/dashboard-commits-route.test.js`.
- `npm run test:workflow` took about 0.24s.
- `MOCK_DELAY=fast npm run test:ui` took about 2m10s, failed 7 tests, and is the clear slow/noisy tier.
- `bash scripts/check-test-budget.sh` reported `10544 / 10550 LOC`, leaving only 6 LOC before the ceiling.
- The slowest isolated integration file was `tests/integration/pty-terminal.test.js` at about 10s. Its async PTY tests set 5s/10s timeout guards but do not clear those timers after success, so the process stays alive until the longest timer expires.
- `tests/dashboard-e2e/playwright.config.js` currently uses `workers: 1` and `screenshot: 'on'`, making every Playwright run serial and artifact-heavy.

Browser automation research conclusion:

- Keep Playwright as the deterministic E2E browser test runner. It remains the strongest fit for this repo: auto-waiting, web-first assertions, trace/debug tooling, sharding/filtering, Chromium/Firefox/WebKit support, and official agent-facing tooling.
- Do not migrate the suite to Cypress for this problem. Cypress has useful ergonomics but its own docs call out permanent trade-offs around not being a general-purpose automation tool, test code running inside the browser, and not driving two browsers at once. Those are poor fits for Aigon's dashboard/session/tmux workflows.
- Do not migrate to Selenium/WebdriverIO/TestCafe for speed. They are useful for standards, grids, device farms, or special enterprise constraints, but they are unlikely to reduce this repo's local agent-loop cost.
- Consider Vitest Browser Mode only for future small browser-native component/rendering tests. It still needs a Playwright or WebdriverIO provider for headless browser runs, so it is not an E2E replacement.
- Consider Stagehand/Browserbase only for exploratory agent browser tasks, not deterministic regression. It is built for AI browser automation and can interleave with Playwright, but it adds model/cloud variability and does not solve the local regression-suite problem.

## User Stories

- [ ] As an implementor agent, I run fast scoped validation while coding and am not forced into a 2-minute browser suite unless I am at the deploy gate.
- [ ] As a reviewer agent, I review diffs and make minimal fixes without spending time on validation that belongs to the implementor or deploy gate.
- [ ] As the project owner, I can push or deploy with one explicit command that runs the expensive safety net once.
- [ ] As a maintainer, I can see which tests are smoke, core, browser, and deploy-only without reverse-engineering package scripts.

## Acceptance Criteria

- [ ] `package.json` exposes clear stages:
  - `test:quick` for the existing scoped iterate gate.
  - `test:core` for lint, workflow diagram check, integration tests, and workflow-core tests.
  - `test:browser` for the Playwright dashboard E2E suite with fast mocks.
  - `test:deploy` for `test:core`, `test:browser`, and `scripts/check-test-budget.sh`.
- [ ] Existing scripts keep backwards compatibility where practical:
  - `npm test` remains the non-browser core suite unless there is a strong reason to change it.
  - `npm run test:all` maps to the full deploy-grade suite.
- [ ] `.github/workflows/test.yml` is updated so PR checks run the core suite without Playwright, while push-to-main/deploy-grade checks run the browser/deploy tier. Avoid multiplying the 2-minute browser suite across every Node version.
- [ ] Reviewer command templates explicitly say reviewers do not run tests:
  - Update `templates/generic/commands/feature-code-review.md`.
  - Update `templates/generic/commands/feature-code-revise.md` only if it currently assigns reviewer-owned validation in a review/revise path.
  - The review log should record `Validation not run by reviewer per policy` when the reviewer made code changes.
- [ ] Implementor templates are updated only to match the new staged command names and policy:
  - `templates/generic/commands/feature-do.md` continues to require the quick/iterate gate before submission.
  - It must explicitly tell implementors not to run `test:browser`, `test:deploy`, or the full Playwright suite during normal feature work.
  - It should point implementors to the deploy gate as the later safety net, not as their mid-work responsibility.
- [ ] `docs/testing.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/architecture.md` no longer contradict the current scripts, current LOC ceiling, or reviewer policy.
- [ ] `tests/integration/pty-terminal.test.js` no longer waits for stale timeout guards after successful PTY exits. Its isolated runtime should drop materially, ideally under 2s on a normal local machine.
- [ ] Playwright artifacts are reduced:
  - Change screenshots from always-on to failure-only unless a specific screenshot regression test needs an explicit screenshot.
  - Keep enough failure artifacts for diagnosis, such as trace or screenshot on failure.
- [ ] Browser tests are grouped into fast smoke and deploy-only tiers using Playwright-native filtering, tags, separate scripts, or file-level grouping.
- [ ] The default dashboard-touch iterate behavior runs only a small browser smoke subset, not the whole 2-minute lifecycle suite.
- [ ] At least one duplicated or low-value browser lifecycle path is removed, merged, or demoted to an integration/read-model test. Candidate overlaps: `solo-lifecycle`, `fleet-lifecycle`, `workflow-e2e`, and `failure-modes`.
- [ ] The test LOC ceiling is not raised for this feature. Net test LOC must stay at or below the current budget, preferably with a reduction.
- [ ] The currently failing `dashboard-commits-route.test.js` is either fixed if it is in scope of touched test infrastructure or filed as a separate feature if unrelated.

## Validation

```bash
npm run test:quick
npm run test:core
npm run test:browser -- --grep @smoke
bash scripts/check-test-budget.sh
```

If this feature changes the deploy gate, also run:

```bash
npm run test:deploy
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the deploy/pre-push gate.
- May delete, merge, or demote tests when the coverage is duplicated by a lower-cost test or by another E2E path.
- May update `.github/workflows/test.yml` to split PR core checks from push/deploy browser checks.
- May change reviewer templates so reviewers do not run any test command, even after making review fixes.
- May change Playwright screenshot policy from always-on to failure-only.
- May add or rename npm scripts for test staging, but preserve a clear full-suite command.
- Must not raise `scripts/check-test-budget.sh` ceiling.
- Must not replace Playwright with another browser test framework in this feature.

## Technical Approach

1. Fix the immediate integration-test runtime waste.
   - Open `tests/integration/pty-terminal.test.js`.
   - In each async PTY test that sets a timeout guard, store the timer id.
   - Clear the timer in the `onExit` success path before resolving.
   - Ensure failure paths still reject on timeout.

2. Add explicit package scripts.
   - Update `package.json` with staged commands:
     - `test:quick`: `npm run test:iterate`
     - `test:core`: existing `npm test` body or equivalent core sequence
     - `test:browser`: Playwright dashboard E2E with `MOCK_DELAY=fast`
     - `test:browser:smoke`: fast Playwright smoke subset
     - `test:deploy`: core + browser + budget
   - Keep `npm test` as the core non-browser suite to avoid breaking existing agent assumptions.
   - Point `test:all` at `test:deploy`.

3. Split Playwright into smoke vs deploy.
   - Prefer Playwright tags because they are native and grep-able.
   - Tag lightweight rendering/API consistency checks as `@smoke`.
   - Tag full lifecycle/failure-mode specs as `@deploy` or leave them in the default deploy run and exclude them from smoke.
   - Candidate smoke tests:
     - `close-failure-event.spec.js`
     - `review-badges.spec.js`
     - `set-agent-picker-reviewer.spec.js`
     - selected `state-consistency.spec.js` tests
   - Candidate deploy-only tests:
     - `failure-modes.spec.js`
     - `fleet-lifecycle.spec.js`
     - `solo-lifecycle.spec.js`
     - `workflow-e2e.spec.js`
   - Change `lib/test-loop/scoped.js` dashboard branch from running `npm run test:ui` to running the smoke browser script.

4. Reduce duplicated browser lifecycle coverage.
   - Compare these files for overlapping assertions:
     - `tests/dashboard-e2e/solo-lifecycle.spec.js`
     - `tests/dashboard-e2e/fleet-lifecycle.spec.js`
     - `tests/dashboard-e2e/workflow-e2e.spec.js`
     - `tests/dashboard-e2e/failure-modes.spec.js`
   - Keep one deploy-grade full happy path.
   - Move state projection/action eligibility assertions into integration tests where possible.
   - Delete or collapse browser tests that only prove behavior already covered by API/read-model tests.
   - Update screenshots/golden artifacts only when the remaining tests explicitly need them.

5. Update CI.
   - PRs should run one fast core path first.
   - Push-to-main should run the deploy/browser tier, but avoid running browser tests four times across Node 18/20/22/24.
   - A practical split:
     - Matrix job: syntax + `npm run test:core` across supported Node versions.
     - Single Node job: `npm run test:deploy` or `npm run test:browser && bash scripts/check-test-budget.sh` on push to main only.
   - If GitHub Actions cannot detect deploy intent beyond push-to-main, use push-to-main as the deploy-grade trigger for now.

6. Update reviewer and implementor instructions.
   - In `templates/generic/commands/feature-code-review.md`, replace Step 3.5 with a strict no-tests policy:
     - If no code fixes: no tests.
     - If code fixes: no tests; document validation as not run by reviewer per policy.
     - Implementor/reviser owns scoped validation after revision; deploy gate owns full validation.
   - Keep `feature-do` implementor instructions centered on `npm run test:iterate` / `npm run test:quick`.
   - Do not materially change the `feature-do` workflow: implementors still code, commit, run the quick gate, then signal completion. The change is wording and command naming, not a new implementor-owned full-suite responsibility.
   - Add an explicit warning in `feature-do` that `test:browser` and `test:deploy` are not run during ordinary feature work; they belong to dashboard-smoke selection, push/deploy, or feature-close/CI.
   - Check `lib/profile-placeholders.js` minimal testing text. It currently says minimal mode should run `npm test`; change that to `npm run test:iterate` or no broad test command for Aigon-style Node repos.

7. Reconcile docs and project rules.
   - `docs/testing.md` should be the digest for the new stage names and lifecycle responsibilities.
   - `AGENTS.md` currently says the ceiling is 2,500 LOC even though the script default is 10,550. Fix the number or phrase it as "the ceiling in scripts/check-test-budget.sh".
   - `docs/architecture.md` has stale descriptions of old test files and commands. Replace with the current `tests/integration`, `tests/workflow-core`, and `tests/dashboard-e2e` layout.
   - `CLAUDE.md` hot rule #6 should name the new quick/core/deploy commands.

8. Handle current failures.
   - Re-run `node tests/integration/dashboard-commits-route.test.js`.
   - If the failure is caused by test infrastructure changes in this feature, fix it here.
   - If it is an unrelated product regression, create a separate feature and mention that this feature did not mask or bypass it.

## Dependencies

- None.

## Out of Scope

- Replacing Playwright with Cypress, Selenium, WebdriverIO, TestCafe, Stagehand, or Browserbase.
- Building a new browser-agent framework.
- Raising the test LOC ceiling.
- Fixing unrelated product regressions beyond what is needed to keep the staged validation commands honest.
- Adding new broad E2E coverage.

## Open Questions

- Should `test:deploy` run automatically in a local `pre-push` hook, or should it remain an explicit command plus CI responsibility?
- Should push-to-main be treated as the deploy-grade trigger, or is there a separate release/deploy workflow that should own browser tests?
- Which one full dashboard lifecycle path is the most valuable to keep as deploy-grade E2E: solo branch, solo worktree, fleet, or workflow create/start/close?

## Related

- Docs to update: `docs/testing.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`.
- Key files: `package.json`, `.github/workflows/test.yml`, `lib/test-loop/scoped.js`, `lib/profile-placeholders.js`, `templates/generic/commands/feature-code-review.md`, `tests/dashboard-e2e/playwright.config.js`, `tests/integration/pty-terminal.test.js`.
- External research references:
  - Playwright docs: auto-waiting, web-first assertions, parallelism/sharding, tags/grep, CLI, MCP/agent support.
  - Cypress docs: trade-offs, parallelization, cross-browser strategy.
  - Vitest Browser Mode docs: browser mode still uses Playwright or WebdriverIO providers for headless runs.
  - Puppeteer docs: WebDriver BiDi support is improving, but Puppeteer is lower-level than Playwright Test for this use case.
  - Browserbase/Stagehand docs: useful for AI browser workflows, not a deterministic local regression replacement.
