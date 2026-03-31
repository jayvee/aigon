# Implementation Log: Feature 186 - test-suite-reduction-and-pyramid-enforcement
Agent: cc

## Plan

Aggressive test suite reduction. Three phases: delete stale/unreachable tests, move scripts out of tests/, deduplicate internal API tests. User directed maximum deletion over careful deduplication.

## Progress

- Deleted 3 API e2e tests (1,546 lines) — made real LLM calls, never ran in CI
- Deleted old `tests/dashboard/` Playwright specs (762 lines) — superseded by `tests/dashboard-e2e/`
- Moved `setup-fixture.js` and `reset-fixture.js` to `scripts/` (1,008 lines out of tests/)
- Deleted `e2e-mock-fleet.test.js` (405 lines) — old patterns, slow
- Deleted `e2e.test.js`, `e2e-mock-solo.test.js`, `mock-agent.js` (1,427 lines) — slow seed-repo tests
- Deleted `workflow-signals.test.js`, `workflow-snapshot-adapter.test.js` (1,225 lines) — covered by lifecycle.test.js
- Reduced `workflow-core.test.js` from 755 to 391 lines — kept guards, actions, research, signal dedup
- Deleted `aigon-cli.test.js` (2,012 lines) — mega-file, all domains have dedicated test files
- Deleted `security.test.js`, `telemetry.test.js`, `supervisor.test.js`, `proxy.test.js`, `dashboard-server.test.js`, `shell-trap.test.js`, `worktree.test.js`, `entity.test.js`, `action-scope.test.js`, `engine-driven-actions.test.js` — not preventing real bugs

## Decisions

- User directed aggressive deletion over careful deduplication — tests were providing false security while real bugs went undetected
- Kept: config, git, templates, feature-spec-resolver, workflow-core (guards/actions/research/signals), lifecycle, status-actions API test, dashboard-e2e Playwright specs
- Result: 14,026 → 2,423 lines (83% reduction), 42 → 14 files
- `npm test` passes with all remaining suites
