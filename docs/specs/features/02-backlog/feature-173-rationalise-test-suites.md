# Feature: rationalise-test-suites

## Summary

Aigon has accumulated 10+ test files across 3 different directories with overlapping coverage, broken imports (deleted modules), and no clear pyramid. Fix the existing tests, consolidate into a clear structure, document what each layer tests, and wire them into the development workflow so they run at the right time.

## Current State (the mess)

| File | Status | Problem |
|------|--------|---------|
| `aigon-cli.test.js` | 190/197 pass | 7 failures from cutover — references deleted modules |
| `lib/workflow-core/workflow-core.test.js` | 49/50 pass | 1 failure from machine changes |
| `lib/workflow-signals.test.js` | 39/39 pass | OK |
| `lib/shell-trap.test.js` | 24/24 pass | OK |
| `lib/workflow-snapshot-adapter.test.js` | 27/33 pass | 6 failures — stale action format expectations |
| `lib/supervisor.test.js` | 15/15 pass | OK |
| `test/e2e-mock-solo.test.js` | Broken | MODULE_NOT_FOUND — imports deleted state-machine.js |
| `test/e2e-mock-fleet.test.js` | Broken | Same |
| `test/dashboard-e2e.test.js` | Unknown | Not verified post-cutover |
| `test/dashboard-e2e-agents.test.js` | Unknown | Not verified post-cutover |
| `tests/dashboard/*.spec.js` | Unknown | Playwright — not verified post-cutover |
| `tests/dashboard-e2e/*.spec.js` | Unknown | Playwright lifecycle tests — not verified post-cutover |

**Total: 13+ known failures, 2 broken suites, 4+ unverified suites.**

## Target Structure (test pyramid)

```
Layer 1: Unit tests (fast, no I/O)
  npm test
  └── Tests pure logic: parsing, config, workflow engine, projector, actions, guards

Layer 2: Integration tests (filesystem + engine, no server)
  npm run test:integration
  └── Tests CLI commands end-to-end with mock repos: start → submit → eval → close
      Uses temp directories, real engine, no tmux/agents

Layer 3: Server API tests (running server, no browser)
  npm run test:api
  └── Tests dashboard HTTP API: /api/status, /api/action, /api/spec
      Starts server, makes HTTP requests, verifies JSON responses

Layer 4: UI tests (Playwright, running server + browser)
  npm run test:ui
  └── Tests dashboard UI: buttons render, actions fire, cards move between columns
      Only run manually or in CI — slow
```

## Acceptance Criteria

- [ ] All unit tests pass (0 failures in `npm test`)
- [ ] All broken test files fixed or deleted (no MODULE_NOT_FOUND)
- [ ] Test files consolidated into clear directories matching the pyramid
- [ ] `npm test` runs layers 1-2 (fast, < 10 seconds)
- [ ] `npm run test:api` runs layer 3 (starts server, < 30 seconds)
- [ ] `npm run test:ui` runs layer 4 (Playwright, < 60 seconds)
- [ ] `npm run test:all` runs everything
- [ ] Integration tests cover: solo start → close, fleet start → eval → close, pause → resume, review flow
- [ ] API tests cover: /api/status returns correct validActions for each feature state
- [ ] A `docs/testing.md` document describes the pyramid, how to run each layer, and when to add tests
- [ ] `feature-do` template includes "run `npm test` before submitting" in its validation step

## Validation

```bash
npm test
npm run test:api
```

## Technical Approach

### Step 1: Fix failures

Update the 13 failing tests to work with the post-cutover codebase. Delete tests for deleted modules (state-machine, manifest, bridges). Update snapshot adapter tests for new action format.

### Step 2: Consolidate files

```
Before (scattered):
  aigon-cli.test.js
  lib/*.test.js (7 files)
  test/*.test.js (5 files)
  tests/dashboard/*.spec.js (4 files)
  tests/dashboard-e2e/*.spec.js (3 files)

After (pyramid):
  tests/unit/          ← layer 1: pure logic
  tests/integration/   ← layer 2: CLI + engine + filesystem
  tests/api/           ← layer 3: server HTTP API
  tests/ui/            ← layer 4: Playwright
```

### Step 3: Write missing integration tests

The critical gap: no test exercises the full path from `aigon feature-start` through engine state to dashboard `validActions`. Write integration tests that:
1. Create a temp repo
2. Run `feature-start` → verify engine state
3. Write agent status → verify `signal.agent_ready` emitted
4. Run `feature-eval` → verify transition
5. Run `feature-close` → verify cleanup
6. For each step, verify `snapshotToDashboardActions()` returns the correct buttons

### Step 4: Document and wire into workflow

Create `docs/testing.md`. Update `feature-do` template to include `npm test` in validation.

## Dependencies

- None — this should run immediately

## Out of Scope

- Writing new features or fixing workflow bugs (this is test infrastructure only)
- Performance benchmarking
- CI/CD pipeline setup

## Related

- Feature 171 (cutover) — caused the test breakage
- Feature 172 (aigon server) — added supervisor tests
- `docs/architecture.md` § "Testing"
