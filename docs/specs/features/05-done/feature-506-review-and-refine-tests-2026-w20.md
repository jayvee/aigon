---
recurring_slug: review-and-refine-tests
complexity: medium
recurring_week: 2026-W20
recurring_template: review-and-refine-tests.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T20:59:13.837Z", actor: "recurring/feature-prioritise" }
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

### 2026-W20 — 2026-05-11
- Baseline: 86 files (85 integration + 1 workflow), ~19.5s; no coverage metrics
- After:    89 files (88 integration + 1 workflow), ~22s
- Deltas:   +3 test files, +~2.5s; 9 files rewritten to standard helpers; 1 file split; 4 infra bugs fixed
- Deleted:  none
- Merged:   misc-command-wrapper.test.js → split: budget-parser tests moved to budget-poller.test.js
- Rewritten: spec-recommendation, stats-aggregate, plan-flag-draft, rank-agents-for-operation, benchmark-judge, feature-close-restart, feature-close-scan-target, agent-session-id-capture, feature-do-resume (all converted from bare-assert to test()/report() pattern)
- Added:    probe-ttl-cache.test.js (7 tests), spec-review-state.test.js (16 tests), budget-poller.test.js (8 tests, split from misc-command-wrapper)
- Infra bugs fixed: merge conflict in lib/commands/misc.js (bench ignoreStaleness), merge conflict in lib/perf-bench.js (probe stdio), setup.js docs-manifest recording bug (F502 lockstep), install-manifest.json regenerated, 4 site conflict resolutions, lint errors in quota-classifier
- Tooling: fixed dead smoke file ref (recurring-instance → action-scope), added npm run test:related
- Deferred for human: none (no test exceeded 20% deletion threshold)
- Commits:  976a85dd f9fd7f4a 9d32e0eb 86ba24d3

## Pre-authorised

- Skip eval step: this is a recurring hygiene task. The work is reviewed via the per-commit diffs and the run-log entry, not a separate eval pass.
- Author may delete or rewrite individual tests without further approval, **except** when the >20% threshold trips — in that case stop and surface for human review.
