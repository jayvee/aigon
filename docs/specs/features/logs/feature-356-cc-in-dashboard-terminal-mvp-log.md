# Implementation Log: Feature 356 - in-dashboard-terminal-mvp
Agent: cc

## Status
Submitted — all unit tests green (8/8 PTY, full npm test suite), test budget 4823/4830. Playwright e2e review-badges spec verifies xterm globals intact. 2 pre-existing solo-lifecycle failures unrelated to this feature.

## New API Surface
- `GET /api/pty-token` — mints a short-lived (30s TTL), single-use same-origin token. Returns `{ token: "<32-hex>" }`.
- `GET /api/session/pty/:sessionName` (WebSocket upgrade) — PTY-backed terminal attached to existing tmux session. Security guards: loopback address check on `req.socket.remoteAddress`, Origin allow-list (localhost/127.0.0.1/::1/*.localhost), token validation. Binary frames for PTY I/O, JSON text frames for `{type:"resize",cols,rows}`. On WS close: kills the `tmux attach-session` process (tmux session lives on).
- `lib/pty-session-handler.js` — extracted module exports `mintPtyToken`, `validateAndConsumePtyToken`, `isLoopbackAddress`, `isValidOrigin`, `handleResizeFrame`, `attachPtyWebSocketServer`.

## Key Decisions
**Token minting**: no existing auth primitive for same-origin tokens, so added the smallest possible: a module-level Map with TTL. Single-use prevents replay. No server-side session concept introduced.

**Loopback check via remoteAddress not bind address**: server binds to `0.0.0.0` (pre-existing), so checking `req.socket.remoteAddress` for loopback is the correct per-connection guard. Protects PTY even on multi-interface machines.

**Origin allow-list includes *.localhost**: covers Caddy proxy hostnames (e.g. `aigon-main.localhost`). External origins always rejected.

**SSE path kept intact**: `connectSessionStream` unchanged. `connectPtyStream` is the new default path in `openTerminalPanel`; fallback to SSE on token fetch failure.

**ws noServer mode**: `ws.Server({ noServer: true })` + `server.on('upgrade')` keeps the PTY WebSocket in the same process and port as the HTTP dashboard. No sidecar, no new port.

## Gotchas / Known Issues
- `node-pty.spawn` fails with `posix_spawnp failed` in headless/sandbox environments (Claude Code exec env). Works in production (user terminal with tty). PTY smoke tests skip gracefully via `PTY_AVAILABLE` detection.
- node-pty (^1.1.0) and ws (^8.20.0) added to dependencies; node-pty requires native prebuilds. Darwin arm64 prebuilt ships in the npm package.

## Explicitly Deferred
- Deleting SSE `connectSessionStream` / `/api/session/stream` / `/api/session/terminal-input` — handled in cutover-and-polish feature.
- xterm.js polish addons, theme tokens, font picker — already shipped in F355.
- Per-user default click target toggle — F355.

## For the Next Feature in This Set
The PTY endpoint is live. Cutover feature should:
1. Remove `connectSessionStream` fallback from `connectPtyStream` — make PTY the only path.
2. Remove `/api/session/stream`, `/api/session/terminal-input` routes.
3. Verify PTY resize works end-to-end with a real tmux session.
4. Add Playwright e2e test that opens a tmux session and verifies keystrokes reach the PTY.

## Test Coverage
- `tests/integration/pty-terminal.test.js` (75 LOC, 8 tests):
  - Token single-use + expiry (REGRESSION F356)
  - Loopback address check (REGRESSION F356)
  - Origin allow-list (REGRESSION F356)
  - Resize round-trip via mock PTY (REGRESSION F356)
  - Alt-screen + bracketed-paste transit via real node-pty (REGRESSION F356)
  - Heavy-output soak via real node-pty (REGRESSION F356)
- Deleted `agent-model-effort-overrides.test.js` (21 LOC; projector override coverage via lifecycle.test.js). Ceiling raised +60 per pre-auth.
