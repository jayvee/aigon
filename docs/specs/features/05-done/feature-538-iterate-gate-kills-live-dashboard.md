---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-27T09:48:43.327Z", actor: "cli/feature-prioritise" }
---

# Feature: iterate-gate-kills-live-dashboard

## Summary

Running `npm run test:iterate` (or any path that triggers `test:browser:smoke`) takes over the user's running dashboard server: it stops the live server on port 4100 and runs a fixture dashboard on port 4119 for ~30s–2min, then releases. During that window, the user's browser tab keeps polling and any clicks hit a closed socket with `TypeError: Failed to fetch`. After the test completes the original server comes back, but inflight failures linger in UI op-state. The iterate gate is supposed to be fast, scoped, *safe to run while coding* — it currently isn't, because it hijacks shared infrastructure the user is actively using.

## User Stories
- [ ] As the maintainer, I can run `npm run test:iterate` while my dashboard tab is open and continue clicking actions in it without seeing "Failed to fetch" errors.
- [ ] As the maintainer, if I do click an action during a test run, the action either queues until the server is back, or the test uses a fully-isolated fixture that doesn't touch port 4100.

## Acceptance Criteria
- [ ] `npm run test:iterate` (and `test:browser:smoke` directly) does **not** stop the dashboard server that's serving the user's main repo on port 4100. Verified by snapshot of `~/.aigon/dashboard-runtime.json` `pid` and `startedAt` before and after — both unchanged.
- [ ] The browser-smoke fixture spawns its dashboard on a pre-allocated free port unrelated to 4100 (e.g. `ports.find-free(4200..4299)`) and writes its runtime file to a fixture-scoped `HOME` (already happens — see `tests/dashboard-e2e/playwright.config.js` `AIGON_HOME` override). The bug is that the takeover logic still kills the user's PID even when the test sets a different `HOME`.
- [ ] Investigate and remove the "Taking over from existing server (PID …)" path triggered by `aigon dashboard` startup when `AIGON_HOME` is set to a temp dir. It should only stop a dashboard recorded in *its own* `dashboard-runtime.json` — never one recorded in the real user `~/.aigon/`.
- [ ] Test E2E: run `npm run test:iterate` with a foreground dashboard on port 4100; assert the foreground server's PID is identical before and after. Capture and assert in `tests/integration/test-iterate-preserves-dashboard.test.js`.

## Validation
```bash
npm run test:iterate
```

## Technical Approach

The bug is in `lib/dashboard-server.js`'s "take over existing server" logic. Today it reads `dashboard-runtime.json` to find a running PID and kills it — but the path it reads is keyed off `os.homedir()`, not the effective `AIGON_HOME`. When the test sets `AIGON_HOME=/tmp/aigon-e2e-home-…`, the *runtime file* read in the test process is the fixture's, but the takeover logic appears to read the user's real `~/.aigon/dashboard-runtime.json` first.

Steps:
1. Grep for `Taking over from existing server`, `dashboard-runtime.json`, and the takeover/kill code path in `lib/dashboard-server.js`.
2. Confirm whether the takeover read path respects `process.env.AIGON_HOME` or hard-codes `os.homedir()`. (`reference_radar_dashboard_architecture.md` memory says runtime file is at `os.homedir() + '/.aigon/dashboard-runtime.json'` — likely the culprit.)
3. Reroute the takeover read/write through a `getDashboardRuntimePath()` helper that respects `AIGON_HOME`.
4. Update `tests/dashboard-e2e/playwright.config.js` to set `AIGON_HOME` and `AIGON_DASHBOARD_PORT_RANGE` (or equivalent) so the fixture is fully isolated.
5. Add regression test: spin up a fake `dashboard-runtime.json` for HOME=A, then start a server with HOME=B, assert PID-A is untouched.

Secondary improvement (out of scope unless trivial): when polling fails N consecutive times, the pill should mark itself "disconnected" with a *Retry* button instead of leaving stale per-row "Failed to fetch" labels. This is the linger issue I noted alongside this bug.

## Dependencies
-

## Out of Scope
- Reworking how `aigon dashboard` discovers free ports.
- Auto-clearing per-row op messages when a poll succeeds (file separately if it stings).
- Making the test fixture share more state with the live dashboard — they should remain isolated.

## Open Questions
- Does `aigon server restart` (used by F535's restart path) suffer from the same takeover logic, or is its target inferred from a different file? If the same code path, fixing this also fixes mid-restart sync failures.

## Related
- Discovered while validating F535 (`split-dev-and-user-pill-modes`, 2026-05-22). The iterate gate killed the dashboard mid-session and made the user think the new Sync button was broken — it wasn't.
- See `~/.aigon/dashboard.log` lines `Taking over from existing server (PID 26669)` / `Stopped server (PID 26669)` from 2026-05-22T01:14:41.
