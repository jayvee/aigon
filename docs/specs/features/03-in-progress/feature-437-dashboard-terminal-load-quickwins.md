---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T08:40:52.710Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-terminal-load-quickwins

## Summary

Cut perceived latency when opening the dashboard terminal panel for tmux sessions, especially those with dense TUI content (Claude Code, kimi, opencode). Four small, independent edits to `lib/pty-session-handler.js` and `templates/dashboard/js/terminal.js` that together remove ~50% of the initial byte volume and at least one network round-trip — without any architectural change.

**Coordination with F436 (`dashboard-rip-out-wterm`):** if F436 lands first, the wterm code path is already gone and only the xterm path needs touching here. If this feature lands first, edits must preserve the wterm branch (which F436 will then delete cleanly). Either order works; do not block on F436.

## User Stories

- [ ] As a user clicking a Run/View button in the dashboard, I see content in the terminal panel noticeably faster than today, on sessions with substantial output.
- [ ] As a user opening a session in a TUI agent (Claude Code), I do not see the screen "flash" / repaint twice during the first second.

## Acceptance Criteria

- [ ] **A1 — drop the redundant +300ms repaint.** In `lib/pty-session-handler.js:112`, the unconditional `setTimeout(() => pty.resize(...), 300)` only runs when the cols/rows actually differ from the spawn dimensions, OR is replaced by an alt-screen-aware nudge that is cheaper than a full resize. Default code path for matching dimensions: no second repaint.
- [ ] **A2 — stop re-encoding PTY output.** `lib/pty-session-handler.js:99` no longer wraps node-pty's data in `Buffer.from(data, 'utf8')`. Pass the chunk through (using `ws.send(data, { binary: true })` or the buffer directly). Verify bytes still arrive intact and xterm still renders correctly.
- [ ] **A3 — eliminate the token round-trip on the hot path.** Either (a) cache the pty token in `window.__ptyToken` after first issue and reuse until it 401s, OR (b) issue the token on the same WebSocket via a first server-sent frame, OR (c) accept a same-origin cookie. In the steady state, `connectPtyStream` no longer awaits a separate `/api/pty-token` fetch before opening the WS.
- [ ] **C2 — coalesce PTY chunks.** Server-side `pty.onData` buffers output for 8–16ms (single timer per connection) before flushing as one `ws.send`. Implementation must guarantee no chunk is held longer than ~16ms, and the timer is cleared on `pty.onExit` / `ws` close so no stray send fires after teardown.
- [ ] All four edits are guarded by **the existing tests** continuing to pass; no new test infra required. If `lib/pty-session-handler.js` lacks coverage today, add minimal tests (token TTL, resize-then-spawn ordering, output flush behaviour) — the file is small and self-contained.
- [ ] Manual verification: open one Claude Code agent session and one shell session from the dashboard; both render their first frame in well under 1s on localhost; no visible double-repaint on the agent session. Record observed before/after timings in the implementation log.
- [ ] If F436 has not yet landed, the wterm path (`connectPtyStreamWterm`) still works after these edits — A1, A2, C2 are server-side and benefit it for free; A3 must work for both engines if both are still wired up.

## Validation

```bash
node -c lib/pty-session-handler.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate. *(Note: A3 touches `templates/dashboard/js/terminal.js`, so `test:ui` IS required at the pre-push gate per Hot rule #6.)*

## Technical Approach

Four targeted edits, each independently revertible:

1. **A1** — `lib/pty-session-handler.js:109-114`. Capture spawn `cols`/`rows`. Skip the forced resize if no client-driven resize has changed them. If a nudge for full-screen TUIs is still required, gate it on a session-name heuristic (agent sessions only) rather than firing for every connection.
2. **A2** — `lib/pty-session-handler.js:97-101`. node-pty's `onData` callback yields a string by default. Replace `ws.send(Buffer.from(data, 'utf8'))` with `ws.send(data, { binary: true })` (string overload) or pass a Buffer directly. Verify via one-line log that `typeof data` matches the pinned node-pty version.
3. **A3** — preferred: cache token in `window.__ptyToken`, retry once on 4001 close. Smallest diff. Token store already self-prunes (`pty-session-handler.js:9-12`), so client-side caching stays compatible.
4. **C2** — wrap `pty.onData` in a flush-coalescer (one `setTimeout(flush, 12)` per connection). Clear timer on `pty.onExit` and `ws` close.

### Files touched (estimate)

- `lib/pty-session-handler.js` (~30 LOC delta)
- `templates/dashboard/js/terminal.js` (~10 LOC delta for A3)
- Optional: minimal test additions if no current coverage

### Why low complexity

- All edits are local to the streaming hot path; no new abstractions, endpoints, or state.
- Behaviour change is additive (less work, same bytes).
- Reverting any one edit leaves the other three working.

## Dependencies

-

## Out of Scope

- Server-side ring buffer / replay (would be a separate, architectural feature — not currently spec'd).
- OffscreenCanvas / worker rendering for xterm.
- SSE-fallback path optimization. PTY is the default; SSE only triggers on `/api/pty-token` failure, which is a separate bug if observed.
- Throttling/coalescing windows larger than ~16ms — would start affecting keystroke echo.
- wterm removal — covered by F436.

## Open Questions

- Does the pinned node-pty version emit strings or Buffers from `onData`? Resolve at impl time.
- Is the +300ms repaint actually load-bearing for any TUI today? If yes, document which ones in a code comment so the next person doesn't re-remove it.

## Related

- F436 `dashboard-rip-out-wterm` — companion feature, independent ordering.
