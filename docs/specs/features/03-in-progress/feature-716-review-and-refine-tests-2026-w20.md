---
aigon_id: F716
recurring_slug: review-and-refine-tests
complexity: medium
recurring_week: 2026-W20
recurring_template: review-and-refine-tests.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T20:59:14.766Z", actor: "recurring/feature-prioritise" }
---

# review-and-refine-tests-2026-W20

## Summary

Audit the test suite, then refine and refactor in place to keep signal high and growth controlled. **Do not produce audit documents, TESTING.md, or any other artefacts** — make the changes directly. Log the run outcome in this spec's feature log section before closing.

## Acceptance Criteria

- [ ] Survey: identify test framework(s), conventions, CI config, runtime; record baseline (count, duration, coverage if available); note any flaky/skipped tests
- [ ] Triage every test file mentally into KEEP / MERGE / REWRITE / DELETE / MISSING (no doc output)
- [ ] Apply changes as separate commits in this order: (1) grouping/tooling, (2) deletions, (3) merges & rewrites, (4) missing-coverage additions
- [ ] Critical-path coverage (auth, payments, data integrity, permission boundaries) is not reduced — rewrite rather than delete when in doubt
- [ ] If proposing to delete >20% of any one file's tests, stop and surface that list for human review instead of acting
- [ ] Pre-push gates pass: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`
- [ ] Append a run-outcome entry to the `## Run Log` section of this spec (see template below)
- [ ] Close the feature (no eval step needed — see Pre-authorised)

## Triage Rubric

A good test:
- Asserts on user-observable behaviour, not implementation detail
- One concept; clear Arrange / Act / Assert
- Deterministic — no real network, clock, filesystem, or randomness in unit tests
- Unit tests < 50ms; slower tests are tagged integration or e2e
- Test name reads as a specification of intent

Default to DELETE (justify in the run log if not):
- Verifies only that a mock was called with what the test itself set up
- Trivial getter/setter, framework code, or library-wrapper coverage
- Large-object snapshot with no narrated intent
- Still passes when the implementation under test is removed
- Asserts on log/console output without a behavioural reason
- Couples to private internals that change every refactor

## Grouping (Phase 1 of changes)

Pick **one** native mechanism for the stack — vitest projects, jest projects, pytest markers, or a `*.unit.test.ts` / `*.integration.test.ts` file convention. Do not mix.

Each group must be runnable in isolation (e.g. `npm run test:cli`, `npm run test:dashboard`). Add a `test:related` entrypoint using the runner's built-in change-impact selector:
- `vitest related <files>`
- `jest --findRelatedTests <files>`
- `pytest --picked` or `pytest-testmon`

If a grouping scheme is already in place from a prior run, validate it still maps cleanly to the current code layout and adjust; do not re-do the work.

## Constraints

- Run args verbatim; never add agents/flags from context
- Templates source of truth is `templates/generic/commands/`; never edit `.claude/commands/`
- After any `lib/*.js` edit during this work, run `aigon server restart`
- Never move spec files manually — use `aigon` CLI commands
- Every commit must keep CI green

## Run Log

### 2026-W20 — 2026-07-25
- Baseline: 99 core tests (44 unit + 53 integration + 2 workflow), ~13s `npm test`; 126 test files; 18261 LOC; no coverage metrics; no flaky/skipped in core suite (live-agent E2E opt-in only)
- After:    99 core tests, ~15s `npm test`; 18014 LOC (-247)
- Deltas:   0 net test files; -10 individual test cases (insights 11→3, backup 9→7); -247 LOC; grouping validated (unit/integration/workflow/browser + `test:related` intact)
- Deleted:  insights.test.js — 8 fragmented micro-assertions merged into 3 behavioural tests; backup.test.js — DEFAULT_RETENTION constant check and dropAfterDays=null duplicate of compressAfterDays=0 disable path
- Merged:   insights AADE frontmatter reads into one collectAadeFeatures behavioural test; backup retention disable paths consolidated
- Rewritten: insights, backup, onboarding-state, scheduled-kickoff, onboarding-wizard, portable-spec-paths, feature-ui-contract — migrated bespoke harnesses to `_helpers` with REGRESSION comments
- Added:    nil — no missing-coverage gaps identified this run
- Tooling:  removed stale `spec-layout-migration.test.js` exclude from integration fast/heavy splits
- Deferred for human: none (no file exceeded 20% deletion threshold)
- Commits:  3272a4fc b7adb27a 9613e3c4

<!-- Append a new entry here at the top of this section before closing the feature. -->
<!-- Format:
### 2026-W20 — <ISO date>
- Baseline: <N tests, Ts duration> (coverage: <X%> if available)
- After:    <N tests, Ts duration> (coverage: <X%> if available)
- Deltas:   <±tests, ±duration, ±coverage>
- Deleted:  <one line per file/group>
- Merged:   <one line per file/group>
- Rewritten: <one line per file/group>
- Added:    <one line per missing-coverage gap filled>
- Deferred for human: <items above the 20% threshold or unclear judgment calls>
- Commits:  <short SHAs in order>
-->

## Pre-authorised

- Skip eval step: this is a recurring hygiene task. The work is reviewed via the per-commit diffs and the run-log entry, not a separate eval pass.
- Author may delete or rewrite individual tests without further approval, **except** when the >20% threshold trips — in that case stop and surface for human review.
