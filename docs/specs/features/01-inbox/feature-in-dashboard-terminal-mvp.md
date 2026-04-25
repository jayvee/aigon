---
complexity: high
set: in-dashboard-terminal
---

# Feature: in-dashboard-terminal-mvp

## Summary
Replace the dashboard's Peek pane with a real PTY-backed terminal: **xterm.js** in the browser, **node-pty** on the server, attached to existing tmux sessions over a same-origin WebSocket. Ship the security envelope (loopback-only bind, Origin check, short-lived same-origin token) and a regression-test bundle (PTY resize, alt-screen apps, bracketed paste, large-output soak) in the same feature so the endpoint never exists without its guards or its tests.

This is the foundation feature from research 40. Without it, none of the follow-up work (cutover + polish) makes sense.

## User Stories
- [ ] As a user driving an agent from the dashboard, I can click into a tmux session and interact with it in-browser with the same fidelity as `iTerm + tmux attach` — arrow keys, modifiers, mouse, alt-screen apps (vim/htop), 24-bit colour, copy/paste, resize.
- [ ] As a user, I trust the in-browser terminal endpoint is unreachable from anything other than my local machine and same-origin dashboard tab.
- [ ] As an agent maintaining this feature, regressions in resize / alt-screen / paste / heavy-output throughput are caught by the test suite, not by users.

## Acceptance Criteria
- [ ] xterm.js renders an attached tmux session via WebSocket; keystrokes (including arrows, Ctrl/Alt/Meta combos, function keys, mouse) reach tmux unchanged.
- [ ] Server-side `node-pty` host is in the dashboard process — no sidecar server, no extra port, same auth boundary.
- [ ] Resize: client sends `{type:"resize",cols,rows}` → `pty.resize(...)`; tmux follows the new size.
- [ ] WebSocket upgrade refuses if the dashboard bind is not loopback. No env override, no `--unsafe`.
- [ ] WebSocket upgrade validates `Origin` and a short-lived same-origin token minted by the dashboard.
- [ ] Closing the WebSocket detaches but **does not kill** the underlying tmux session — lifecycle stays with `aigon sessions-close`.
- [ ] Regression tests cover: PTY resize round-trip, alt-screen entry/exit (vim or htop simulation), bracketed paste, and a heavy-output soak (e.g. `git diff` tail) without dropped frames or buffer corruption.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` all pass.
- [ ] Playwright screenshot of the new terminal panel.

## Validation
```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC for the regression-test bundle (resize / alt-screen / paste / soak) — these tests are the only durable gate against silent regressions in the new PTY pipeline.

## Technical Approach
- **Frontend**: xterm.js (MIT, WebGL renderer + `xterm-addon-fit`). Mount inside the existing `#terminal-container` element in `templates/dashboard/index.html`. Theme tokens and addon polish are explicitly **out of scope** for this feature (they live in `in-dashboard-terminal-cutover-and-polish`).
- **Backend**: new `GET /api/session/pty/:sessionName` (WebSocket upgrade) in `lib/dashboard-routes.js`. Handler:
  1. Loopback-bind assertion on the dashboard listener.
  2. Origin allow-list check.
  3. Short-lived same-origin token validation (reuse the existing dashboard session minting; do not invent a new auth surface).
  4. `node-pty.spawn('tmux', ['attach', '-t', sessionName])`; pipe bytes both ways as binary frames.
  5. Handle `{type:"resize"}` control frames.
  6. On socket close: detach only.
- **Session model**: attach to existing tmux sessions named under the current Aigon convention. Do **not** spawn-new-per-tab — that breaks `sessions-close`, shell-trap signals, and the heartbeat sidecar.
- **Transport**: WebSocket binary frames (not SSE, not long-poll).
- **Dashboard read-only rule**: this feature touches `lib/dashboard-routes.js` (allowed) but must not parse engine-state/spec/log files in the route handler. Session resolution goes through existing read-side modules.
- **Tests**: extend `tests/` with a focused PTY harness — fake PTY for unit tests, real `node-pty` smoke for integration. Each test gets a `// REGRESSION:` comment per T2.
- **No deletion in this feature**: the Peek pipe-pane plumbing stays intact and parallel; deletion is the next feature so we can ramp without a flag day.

## Dependencies
- Research 40 (terminal-in-dashboard) — done.

## Out of Scope
- Deleting Peek / `pipe-pane` / `peekActiveSessions` / `/api/session-peek*` / `/api/session-input` — handled in `in-dashboard-terminal-cutover-and-polish`.
- xterm.js polish addons (`webgl`, `unicode11`, `web-links`, `image`/sixel, `ligatures`), theme tokens, font picker — handled in the cutover-and-polish feature.
- Per-user "default click target" preference toggle — handled in the cutover-and-polish feature.
- `wterm` evaluation — explicitly deferred (research 40, suggestion #7).
- Hosted/remote dashboard scenarios.
- Replacing tmux itself.

## Open Questions
- Native module shipping: does `node-pty` prebuilt cover every Node version Aigon supports today, or do we need a Docker/Linux smoke check in CI for this feature? (Reference: `reference_docker_linux_testing`.)
- Token minting reuse: confirm which existing dashboard primitive provides a same-origin short-lived token; if none, the smallest possible addition is preferable to a new auth surface.

## Related
- Research: 40 — terminal-in-dashboard
- Set: in-dashboard-terminal
- Prior features in set: (none — this is the foundation)
