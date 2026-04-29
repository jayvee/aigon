---
complexity: medium
planning_context: ~/.claude/plans/crispy-riding-knuth.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T12:52:05.015Z", actor: "cli/feature-prioritise" }
---

# Feature: xterm-render-lag-fix

## Summary

The dashboard's in-panel terminal (xterm.js) is laggy: takes seconds to fill, then jumps; mid-transition `fit()` runs ~15× per panel slide-in; large agent output frames sit in `pendingOutput` for 12 ms before flushing. Five concrete fixes: pin a coherent xterm core/addon ecosystem (currently `xterm@5.3.0` mixed with `@xterm/addon-*@0.x` — a silent version mismatch), debounce ResizeObserver behind rAF + transition-aware gate, drop the unused `ImageAddon`, set `lineHeight: 1.0` (WebGL needs integer cell height) + drop `allowProposedApi` + make `cursorBlink` opt-in, and add a 32 KB high-water-mark flush in `pty-session-handler.js` so big chunks don't wait for the timer.

## User Stories

- [ ] As John, when I attach to a long-running agent session in the dashboard, the terminal renders smoothly — no torn rows, no perceptible delay between agent output and my screen.
- [ ] As John, when I slide the terminal panel open, the contents settle in one or two reflows, not a visible jumpy ramp-up.
- [ ] As John, when an agent emits a large frame (e.g. Cursor's "Composing 13.54k tokens"), it renders within one animation frame, not after a 12 ms timer wait.

## Acceptance Criteria

- [ ] xterm core and all addons are on a single coherent version line — either `@xterm/xterm@5.5.0` with the scoped `@xterm/addon-*` set, or unscoped `xterm@5.3.0` with unscoped `xterm-addon-*`. Plan recommends the scoped line.
- [ ] `fit()` is called ≤ 2× per panel slide-in (verified via temporary `console.count('fit')` probe; probe removed before merge).
- [ ] xterm globals check in `tests/dashboard-e2e/review-badges.spec.js` passes with the updated five-addon list (no `ImageAddon`).
- [ ] Cursor "Composing 13.54k tokens" frame (or any agent payload ≥ 32 KB) renders within one animation frame of arrival on the WebSocket.
- [ ] No JS console errors on terminal open/close cycle, verified via `mcp__playwright__browser_console_messages`.
- [ ] Cold-load page bundle drops by approximately the size of `addon-image@0.9.0` (~30 KB).
- [ ] `tests/integration/pty-terminal.test.js` passes unchanged.

## Validation

```bash
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

Five file-scoped changes, ordered. Plan detail in `~/.claude/plans/crispy-riding-knuth.md`.

1. **`templates/dashboard/index.html:539-545` — pin one xterm ecosystem.** Bump core to `https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/{css/xterm.css,lib/xterm.js}`. Keep all addons on their existing scoped versions (`@xterm/addon-fit@0.10.0`, `@xterm/addon-webgl@0.18.0`, `@xterm/addon-unicode11@0.8.0`, `@xterm/addon-web-links@0.11.0`). DELETE the `@xterm/addon-image@0.9.0` script tag. Both ecosystems expose the same global names (`Terminal`, `FitAddon`, etc.) so the existing Playwright globals assertion still passes after the `ImageAddon` removal. After this edit, take an MCP `browser_snapshot` per CLAUDE.md hot rule.

2. **`templates/dashboard/js/terminal.js:82` — terminal options.** In `createXtermInstance`:
   - `lineHeight: 1.0` (drop 1.4 — WebGL renderer needs integer cell height to avoid sub-pixel rounding artifacts on Retina).
   - Delete `allowProposedApi: true` (line 92) — no addon currently used requires it.
   - Change `cursorBlink: true` to `cursorBlink: localStorage.getItem('aigon.term.cursorBlink') === '1'` (default off — keeps a redraw timer alive even with no output otherwise).
   - Delete the `ImageAddon` block (lines 124-127).

3. **`templates/dashboard/js/terminal.js:378` — debounce ResizeObserver.** Replace the current observer body. Track `lastSize = { w: 0, h: 0 }`, one `rafHandle`, and a `panelTransitioning` flag. On observe: read `entry.contentRect`; if `Math.abs(w - lastSize.w) < 4 && Math.abs(h - lastSize.h) < 4` return; cancel any pending `rafHandle`; if `panelTransitioning`, skip rAF scheduling entirely. Otherwise schedule `rafHandle = requestAnimationFrame(() => { lastSize = {w,h}; try { fitAddon.fit(); } catch (_) {} })`. Wire `transitionrun` (sets flag true) and `transitionend`/`transitioncancel` (sets flag false; runs one final `fit()`) listeners on `#terminal-panel`.

4. **`tests/dashboard-e2e/review-badges.spec.js:31` — drop `ImageAddon` from the globals assertion.** Update to `[Terminal, FitAddon, WebglAddon, Unicode11Addon, WebLinksAddon].every(...)`.

5. **`lib/pty-session-handler.js:116` — 32 KB high-water-mark flush.** In `pty.onData`, after `pendingOutput += data`, add: `if (pendingOutput.length >= 32_768) { clearFlushTimer(); flushOutput(); return; }`. Keep the 12 ms timer for the small-chunk path. Reasoning: 32 KB is roughly one full terminal repaint (200×60); flushing earlier doesn't help paint smoothness, flushing later costs visible lag on big console writes.

### Restart rule

After any `lib/*.js` edit (item 5), run `aigon server restart`. After any `templates/dashboard/index.html` edit (item 1), take an MCP `browser_snapshot` per CLAUDE.md hot rule.

### Verification path

- `npm run test:iterate` per iteration.
- Pre-push: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.
- Manual MCP browser: navigate to the dashboard, open the in-panel terminal on a long-running session, run `seq 1 50000` inside, then trigger several panel slide-in/slide-out animations. `browser_take_screenshot` mid-transition; expect no torn rows or stale glyphs.
- Smoke: load dashboard cold, attach to a session, run `cat /usr/share/dict/words`. Smooth incremental paint, not stutter blocks.

## Dependencies

-

<!-- No hard dependency. Can run in parallel with `dashboard-eventloop-stalls-and-modal-parallelise`:
     no file overlap, and xterm tuning is measurable on its own (version-mismatch fix,
     ResizeObserver debounce, 32KB pty flush) regardless of server event-loop state. -->

## Out of Scope

- Replacing xterm.js with a third-party iframe (ttyd/wetty/gotty) — explicitly rejected. Every web tmux viewer uses xterm.js under the hood; the lag is not in the wrapper code.
- Deleting the SSE fallback path in `connectSessionStream` — dead-ish but out of scope.
- Adding any new visual polish to the terminal panel chrome.
- Adding a settings UI for `cursorBlink` — purely a `localStorage` toggle for now; can be promoted to settings later if asked.

## Open Questions

- Should `lineHeight` be a localStorage pref (some users prefer 1.2 for readability)? Default: hardcode 1.0. Promote to a pref only if requested.
- After bumping to `@xterm/xterm@5.5.0`, does the WebGL renderer behave any differently on headless Chromium in CI? If `review-badges.spec.js` flakes on the WebglAddon global, fall back to the canvas renderer in CI via env detection.

## Related

- Research: <!-- N/A -->
- Set: <!-- standalone -->
- Prior features in set: <!-- F355 introduced the current xterm.js setup; this feature tightens it. -->
