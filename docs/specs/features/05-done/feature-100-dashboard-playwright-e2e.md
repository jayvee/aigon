# Feature: dashboard-playwright-e2e

## Summary
Add Playwright e2e tests that drive the dashboard through complete feature lifecycles using mock agents. Unlike the existing static dashboard tests (which mock API responses and verify rendering), these tests run a **real AIGON server** backed by a seed repo with real specs, and use `MockAgent` to simulate agent work with realistic timing. This catches the integration bugs and state desync issues that have made the dashboard flaky.

## User Stories
- [ ] As a developer, I can run `npm run test:dashboard:e2e` and verify the full solo worktree lifecycle works through the dashboard UI (~60s)
- [ ] As a developer, I can run the same suite for fleet mode and verify eval/close works through the dashboard (~90s)
- [ ] As a developer, I can trust that dashboard changes don't break the action flow before shipping

## Acceptance Criteria

### Test Infrastructure
- [ ] New Playwright config: `tests/dashboard-e2e/playwright.config.js` — starts a real AIGON server on a test port (e.g., 4119) backed by a temp fixture repo
- [ ] Server setup: starts `aigon dashboard` pointed at the fixture repo (not a static server — real `lib/dashboard-server.js`)
- [ ] Fixture setup: copies a seed repo to temp dir, initializes with `aigon init`, pre-seeds a feature in inbox
- [ ] `MockAgent` integration: imports from `test/mock-agent.js` to simulate agent work in worktrees
- [ ] Teardown: kills dashboard, removes temp dirs and worktrees
- [ ] `MOCK_DELAY=fast` support for CI (~10s vs ~60s)

### Test: Solo Worktree via Dashboard (`solo-lifecycle.spec.js`)
- [ ] Navigate to Pipeline tab, verify feature appears in Inbox column
- [ ] Click Prioritise action → feature moves to Backlog column
- [ ] Click "Start feature" → agent picker opens, select `cc`, submit
- [ ] Feature moves to In-Progress column, shows agent `cc` with status `implementing`
- [ ] MockAgent runs in background, updates log to `submitted`
- [ ] Dashboard poll picks up submitted status (within poll interval)
- [ ] Verify NO "ready for eval" notification appears (solo mode)
- [ ] Click Close action → feature moves to Done column
- [ ] Console tab shows `feature-close` command output
- [ ] Feature no longer appears in active columns

### Test: Fleet Mode via Dashboard (`fleet-lifecycle.spec.js`)
- [ ] Create and prioritise a feature via dashboard actions
- [ ] Click "Start feature" → agent picker, select `cc` AND `gg`, submit
- [ ] Feature in In-Progress, shows both agents with `implementing` status
- [ ] Two MockAgents run with staggered delays
- [ ] After first agent submits: dashboard shows one `submitted`, one `implementing`
- [ ] After both submit: dashboard shows both `submitted`
- [ ] "All submitted" notification appears (fleet mode, 2+ agents)
- [ ] Run eval via dashboard action → feature moves to In-Evaluation
- [ ] Simulate eval result (write winner to eval file)
- [ ] Close with winner via dashboard → feature moves to Done
- [ ] Console tab shows successful close output

### Test: Dashboard State Consistency
- [ ] After each action, verify `/api/status` response matches what the UI shows
- [ ] Verify valid actions on feature cards match expected state machine output for that stage
- [ ] Verify no actions appear that contradict the state machine (e.g., no eval button on solo features)

### No Regressions
- [ ] Existing static dashboard tests still pass: `npm run test:dashboard`
- [ ] Existing CLI e2e tests still pass: `npm run test:e2e`

## Validation
```bash
npx playwright test --config tests/dashboard-e2e/playwright.config.js --reporter=list
```

## Technical Approach

### Real AIGON Server (not static)
The existing tests in `tests/dashboard/` use a minimal static server that serves the HTML and mocks all API calls via `page.route()`. That's good for UI rendering tests but doesn't catch integration bugs.

These new tests start a **real AIGON server** (`lib/dashboard-server.js`) pointed at a fixture repo. The dashboard reads real specs, worktrees, and log files — so state transitions are tested end-to-end.

```js
// tests/dashboard-e2e/setup.js
const { execSync, spawn } = require('child_process');

function startDashboard(fixtureDir, port) {
  // Start real dashboard on test port, pointed at fixture repo
  const proc = spawn('node', ['aigon-cli.js', 'dashboard'], {
    env: { ...process.env, PORT: port, AIGON_REPOS: fixtureDir },
    cwd: fixtureDir
  });
  return proc;
}
```

### MockAgent in Playwright Context
Playwright tests can't directly import and run MockAgent (it runs in Node, not the browser). Instead:
1. Playwright test spawns MockAgent as a child process or runs it in a `test.step()`
2. MockAgent writes to the fixture repo's worktree log files
3. Dashboard's poll cycle picks up the changes
4. Playwright verifies the UI updates

### Test File Structure
```
tests/
  dashboard/                      # Existing static UI tests (keep as-is)
    server.js
    pipeline.spec.js
    monitor.spec.js
    ...
  dashboard-e2e/                  # New lifecycle tests
    playwright.config.js          # Real AIGON server, fixture setup
    setup.js                      # Fixture + dashboard lifecycle helpers
    solo-lifecycle.spec.js        # Solo worktree happy path
    fleet-lifecycle.spec.js       # Fleet with eval happy path
    state-consistency.spec.js     # State machine compliance checks
```

### Timing
- Dashboard poll interval: 10s (default) — tests may need to wait or force a refresh
- MockAgent delays: configurable via `MOCK_DELAY=fast` (1s) or default (15-20s)
- Total test time: ~30s fast, ~120s default

## Dependencies
- `test/mock-agent.js` — MockAgent class (from feature 98)
- `tests/dashboard/` — existing Playwright setup (patterns to follow)
- `@playwright/test` — already in devDependencies
- Real AIGON server (`lib/dashboard-server.js`)
- Fixture repos from `test/setup-fixture.js`

## Out of Scope
- Testing the dashboard's CSS/visual regression (use existing static tests for that)
- Testing with real AI agents (future scenario)
- Autopilot mode testing via dashboard
- Multi-repo dashboard testing
- Mobile/responsive layout testing

## Open Questions
- Should the dashboard be configured with a shorter poll interval (e.g., 2s) during tests to reduce wait times?
- Should tests use `page.evaluate()` to call `requestRefresh()` directly instead of waiting for the poll cycle?

## Related
- `tests/dashboard/` — existing static Playwright tests (patterns to follow)
- `test/mock-agent.js` — MockAgent class
- `test/e2e-mock-solo.test.js` — CLI-level solo lifecycle (same flow, dashboard-driven)
- `test/e2e-mock-fleet.test.js` — CLI-level fleet lifecycle
- Feature 97 — enforce state machine everywhere (state consistency checks depend on this)
