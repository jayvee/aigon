# Implementation Log: Feature 355 - in-dashboard-terminal-cutover-and-polish
Agent: cc

## Status
Submitted — all AC met, full test suite green, budget at 4649/4650.

## New API Surface
- `GET /api/session/stream?name=<session>` — SSE stream of tmux capture-pane output (600ms poll); emits `data: {output}` and `event: end` on session exit.
- `POST /api/session/terminal-input` — send text to tmux session (`send-keys`); `enter:false` skips the Enter keystroke for key-by-key input.
- `getTerminalClickTarget()` / `setTerminalClickTarget()` — localStorage helpers in `terminal.js`
- `getTerminalFont()` / `setTerminalFont()` — localStorage helpers in `terminal.js`

## Key Decisions
**No node-pty (F356 dependency unmet)**: Feature 356 (PTY MVP) is in backlog. Implemented via SSE + capture-pane instead. This handles the agent-driving use case (watching output, sending commands) without native modules. PTY upgrade (resize, alt-screen, mouse) deferred to when F356 ships.

**terminalClickTarget default = "dashboard"**: AC says this is the default for new installs. Uses localStorage; no server-side migration needed.

**Peek deletion**: CDN/routes deleted in commit 1; all callers in pipeline.js/monitor.js/init.js migrated to `openTerminalPanel` in commit 2. Write-path-contract discipline observed.

**Test budget**: Suite was at 4642/4650 pre-feature. Embedded the F355 Playwright checks into `review-badges.spec.js` using 7 lines (4649/4650 total). No new spec file needed.

## Gotchas / Known Issues
- `xterm-addon-image` (sixel) is loaded but sixel output requires the backend process to emit DCS sequences; the addon is wired and ready.
- The `kcard-peek-btn` CSS class is preserved in pipeline.js HTML templates; only the click handler changed to use `openTerminalPanel`.

## Explicitly Deferred
- Full PTY (resize, alt-screen, mouse, bracketed paste) — depends on F356.
- Light theme terminal tokens — dashboard is dark-only; CSS vars added are dark-palette.
- `wterm` evaluation — explicitly out of scope per spec.

## For the Next Feature in This Set
F356 (in-dashboard-terminal-mvp) should add node-pty + WebSocket upgrade handler at `/api/session/pty/:sessionName`. The `connectSessionStream` function in terminal.js can be replaced with a WebSocket connection; addons, theme, and font picker are already in place.

## Test Coverage
- `review-badges.spec.js`: F355 Playwright check — xterm globals present, peek globals absent, `--term-bg` token defined; screenshot taken.
- `static-guards.test.js`: conductor-peek test updated to verify `openTerminalPanel` wiring and absence of `openPeekPanel` in pipeline.js.
- Fixed pre-existing research-eval template regression (test in feature-sets.test.js added without matching template update in commit 8701083b).
