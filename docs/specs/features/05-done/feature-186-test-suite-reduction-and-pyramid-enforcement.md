# Feature: Test Suite Reduction and Pyramid Enforcement

## Summary

Tests are 14,026 lines — 46% of the 30,408-line production codebase. Feature 173 rationalised the structure into a pyramid but the suites have since grown with duplicate coverage, tests for deleted code paths, and heavyweight API/E2E suites that don't run in the normal workflow. This feature cuts test lines by at least 30% while keeping the pyramid healthy: fast unit tests at the base, focused integration tests in the middle, and minimal E2E at the top.

## Prior Art

Feature 173 (Rationalise Test Suites, done) established the pyramid:
- Layer 1: Unit tests (`npm test`) — 18 suites, all pass
- Layer 2: Integration tests (`npm run test:integration`) — lifecycle flows
- Layer 3: API tests (`npm run test:api`) — server HTTP
- Layer 4: UI tests (`npm run test:ui`) — Playwright

The structure is good. The problem is volume and staleness.

## Current Test Inventory

| File | Lines | Layer | Status |
|------|-------|-------|--------|
| `tests/unit/aigon-cli.test.js` | 2,012 | Unit | Passes but bloated — tests config, git, tmux, security, state-queries in one file |
| `tests/integration/e2e.test.js` | 1,058 | Integration | Runs against seed repos, slow |
| `tests/integration/setup-fixture.js` | 838 | Fixture | Generates brewboard/trailhead repos — not a test |
| `tests/unit/workflow-core.test.js` | 755 | Unit | Tests readEvents/projectContext directly — internal API |
| `tests/api/dashboard-e2e-agents.test.js` | 724 | API | Makes real LLM API calls — never runs in CI |
| `tests/unit/workflow-signals.test.js` | 697 | Unit | Passes |
| `tests/unit/workflow-snapshot-adapter.test.js` | 528 | Unit | Passes |
| `tests/api/dashboard-e2e.test.js` | 515 | API | Unverified |
| `tests/unit/security.test.js` | 415 | Unit | Passes |
| `tests/integration/e2e-mock-fleet.test.js` | 405 | Integration | References old patterns |
| `tests/unit/proxy.test.js` | 402 | Unit | Passes |
| `tests/unit/telemetry.test.js` | 365 | Unit | Passes |
| `tests/unit/dashboard-server.test.js` | 352 | Unit | Passes |
| `tests/integration/lifecycle.test.js` | 313 | Integration | Good — tests engine lifecycle |
| `tests/api/dashboard-e2e-research.test.js` | 307 | API | Unverified |
| Other files | ~3,340 | Mixed | Playwright specs, helpers, fixtures |
| **Total** | **14,026** | | |

## User Stories

- [ ] As a developer, I want `npm test` to run in under 5 seconds so I use it on every change
- [ ] As a developer, I want test failures to tell me what's broken, not test internal APIs that changed
- [ ] As a developer, I want fewer test files to understand and maintain

## Acceptance Criteria

### Delete stale and unreachable tests
- [ ] `tests/api/dashboard-e2e-agents.test.js` (724 lines) deleted — makes real LLM calls, never runs, can't run in CI
- [ ] `tests/api/dashboard-e2e.test.js` (515 lines) deleted or reduced — unverified since cutover, duplicates API status tests
- [ ] `tests/api/dashboard-e2e-research.test.js` (307 lines) deleted or reduced — same
- [ ] `tests/integration/setup-fixture.js` (838 lines) moved out of tests/ — it's a script, not a test. Move to `scripts/setup-fixture.js`
- [ ] Tests referencing `readEvents`/`projectContext` as public API updated to test through `showFeature`/`showResearch` instead (tests should use the same API as production code)

### Consolidate unit test files
- [ ] `tests/unit/aigon-cli.test.js` (2,012 lines) split by domain: keep only tests for functions that are actually exported and used. Delete tests for internal helpers that are tested implicitly through higher-level tests.
- [ ] Remove duplicate coverage — if `lifecycle.test.js` already tests the engine lifecycle, `workflow-core.test.js` doesn't need to test the same transitions

### Enforce pyramid shape
- [ ] Unit tests (Layer 1): < 5,000 lines total — test pure functions, no I/O
- [ ] Integration tests (Layer 2): < 2,000 lines total — test CLI commands with mock repos
- [ ] API tests (Layer 3): < 500 lines total — test server endpoints
- [ ] UI tests (Layer 4): keep as-is (Playwright, only manual)
- [ ] Total test lines: < 10,000 (down from 14,026 — at least 30% reduction)

### All remaining tests pass
- [ ] `npm test` passes with 0 failures
- [ ] `npm run test:integration` passes (lifecycle tests)
- [ ] No MODULE_NOT_FOUND errors in any test file

### Net reduction
- [ ] Total test lines after this feature is lower than 10,000
- [ ] Count of test files reduced (target: < 25, down from 33)

## Validation

```bash
# All tests pass
npm test

# No stale imports
! grep -rn 'MODULE_NOT_FOUND\|Cannot find module' tests/ 2>/dev/null | grep -v node_modules

# Line count check
total=$(find tests -name '*.js' -not -path '*/node_modules/*' -exec cat {} \; | wc -l)
echo "Test lines: $total (target: < 10000)"
if [ "$total" -gt 10000 ]; then echo "FAIL: too many test lines"; exit 1; fi

# File count check
count=$(find tests -name '*.js' -not -path '*/node_modules/*' | wc -l)
echo "Test files: $count (target: < 25)"
```

## Technical Approach

### Phase 1: Delete (target: -3,000 lines)

1. Delete `tests/api/dashboard-e2e-agents.test.js` (724 lines) — real LLM calls, unusable
2. Delete `tests/api/dashboard-e2e.test.js` (515 lines) — unverified, duplicates status tests
3. Delete `tests/api/dashboard-e2e-research.test.js` (307 lines) — same
4. Move `tests/integration/setup-fixture.js` (838 lines) to `scripts/` — it's a generator script, not a test
5. Delete any Playwright specs in `tests/dashboard/` that are unverified and duplicate `tests/dashboard-e2e/`

### Phase 2: Deduplicate (target: -1,000 lines)

1. `workflow-core.test.js` tests `readEvents`, `appendEvent`, `projectContext` as standalone functions. These are internal APIs — the engine wraps them. Keep only the tests that verify behaviour not covered by `lifecycle.test.js`. Delete the rest.
2. `aigon-cli.test.js` at 2,012 lines tests everything from config parsing to tmux naming to git signals. Extract the distinct test groups into focused files only if the file is too large to scan. Otherwise, just delete tests for functions that no longer exist or are tested elsewhere.
3. `workflow-signals.test.js` (697 lines) — verify it doesn't duplicate what `lifecycle.test.js` covers

### Phase 3: Update stale references

1. Any test calling `getAvailableActions('feature', ...)` — update or delete (engine handles this now)
2. Any test importing from deleted modules — fix or delete
3. Any test asserting old action formats — update to match engine output

### What NOT to do

- Don't write new tests — this is a reduction feature
- Don't refactor production code — tests only
- Don't change the pyramid structure (layers 1-4) — it's correct
- Don't touch Playwright specs in `tests/dashboard-e2e/` — they're the maintained set

## Dependencies

- None

## Out of Scope

- Writing new test coverage
- Production code changes
- CI/CD pipeline
- Test performance optimisation (speed is fine, volume is the problem)

## Related

- Feature 173: Rationalise Test Suites (done — established the pyramid)
- Feature 178: Unified Workflow Engine (changed what tests should verify)
- Feature 182: Engine Cleanup (removed code paths some tests still reference)
