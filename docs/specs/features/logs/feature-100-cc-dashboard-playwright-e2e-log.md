---
status: submitted
updated: 2026-03-18T21:06:17.176Z
startedAt: 2026-03-18T12:54:02.980Z
completedAt: 2026-03-18T21:06:17.176Z
events:
  - { ts: "2026-03-18T12:54:02.980Z", status: implementing }
  - { ts: "2026-03-18T13:05:49.182Z", status: implementing }
  - { ts: "2026-03-18T13:15:54.831Z", status: submitted }
  - { ts: "2026-03-18T20:57:29.704Z", status: submitted }
---

# Implementation Log: Feature 100 - dashboard-playwright-e2e
Agent: cc

## Summary

Implemented `tests/dashboard-e2e/` — a Playwright e2e suite that drives the
Aigon dashboard through complete feature lifecycles using real server + MockAgent.

## Approach

The key design decision was using a real `aigon dashboard` process (not a static
mock server) so state transitions are tested end-to-end. The test infrastructure:

- `globalSetup` starts a temp dashboard on port 4119 with `HOME` pointing to a
  temp `.aigon/config.json` so the server sees the fixture repo, not the user's real repos.
- `mock-bin/tmux` (already in codebase) is prepended to `PATH` so `feature-setup`
  creates git worktrees but doesn't try to open real terminal sessions.
- `GEMINI_CLI=1` is set on the AIGON server process so `feature-eval` runs in
  eval-setup mode without launching a real Gemini CLI.
- Tests use `page.evaluate(() => fetch('/api/refresh', ...))` to force immediate
  status updates rather than waiting for the 10s poll cycle.
- `page.route('**/api/session/**', ...)` mocks terminal-open calls.

## Files created

- `tests/dashboard-e2e/setup.js` — globalSetup: fixture, temp HOME, dashboard spawn
- `tests/dashboard-e2e/teardown.js` — globalTeardown: kill dashboard, rm -rf temps
- `tests/dashboard-e2e/playwright.config.js` — workers:1 serial, 120s timeout
- `tests/dashboard-e2e/solo-lifecycle.spec.js` — full solo worktree happy path
- `tests/dashboard-e2e/fleet-lifecycle.spec.js` — fleet cc+gg with eval and winner close
- `tests/dashboard-e2e/state-consistency.spec.js` — API vs UI consistency checks
- `package.json` — added `test:dashboard:e2e` script

## Decisions

**Why separate teardown.js**: Playwright expects `globalTeardown` as a module
export; keeping setup and teardown in separate files avoids dual-export issues.

**Why workers:1 serial**: Tests share one fixture repo and one dashboard instance.
Parallel tests would race on the same kanban state.

**Why force refresh instead of polling**: The dashboard polls every 10s. Waiting
for organic polls would add 10-60s to test runtime with no benefit.

**MOCK_DELAY=fast / CI**: Fast mode uses 600ms/300ms MockAgent delays vs 15s/5s
default — same test logic, much shorter wall time in CI.

**Pre-existing test failures**: `tests/dashboard/` has 2 pre-existing failures
(agent badge + monitor dots) that are unrelated to this feature.

## Bugs found and fixed during testing

**Wrong selector for in-progress agent cards**: The tests initially used
`.agent-badge` to find agent status indicators. However, in-progress cards use
`buildAgentSectionHtml` which renders `.kcard-agent.agent-cc` divs with
`.kcard-agent-status.status-submitted` spans — not `.agent-badge`. The
`.agent-badge` selector only applies to the legacy layout used for inbox/backlog/done
cards. Fixed by switching to `.kcard-agent.agent-cc` and `.kcard-agent-status.status-*`.

**Race condition: waitForPath on directory not log file**: `waitForPath(worktreePath)`
resolved as soon as `git worktree add` created the directory — but `setupWorktreeEnvironment`
writes the log file *after* `install-agent` runs (later in the sequence). MockAgent's
`updateLogFrontmatterInPlace` silently returns `false` if the log file doesn't exist,
leaving status at `implementing`. Fixed by waiting for the log file path specifically
(`waitForPath(ccLogPath)`) rather than the worktree directory.
