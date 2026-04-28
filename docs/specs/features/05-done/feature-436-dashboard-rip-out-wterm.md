---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T08:36:39.813Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-rip-out-wterm

## Summary

Delete the experimental wterm (Vercel Labs DOM-rendered terminal) integration from the dashboard. xterm.js becomes the only engine. Removes a CDN dependency on every dashboard page load (`@wterm/dom`, `@wterm/core` WASM via `esm.sh`/`jsdelivr`), ~150 LOC of dual-engine branching across `templates/dashboard/index.html`, `templates/dashboard/js/terminal.js`, and `templates/dashboard/js/settings.js`, and the engine-toggle UI in Settings → Terminal. wterm was an 11-day-old spike for native selection + Cmd+F; not in real use, and the dual-engine branching is a tax on every future terminal-panel change.

## User Stories

- [ ] As the maintainer, I open the dashboard and the page loads without making outbound CDN calls to `esm.sh` or `jsdelivr.com` for wterm assets.
- [ ] As the maintainer, when I read `templates/dashboard/js/terminal.js` I see one rendering path, not two — every future optimization in this file becomes simpler.
- [ ] As any user who previously toggled wterm on, the dashboard silently falls back to xterm with no error and no lost session state.

## Acceptance Criteria

- [ ] `templates/dashboard/index.html` no longer references `@wterm/dom`, `@wterm/core`, `window.WTerm`, `window.__WTERM_WASM_URL`, or the `wterm:ready` custom event. Specifically: the `<link rel="stylesheet" href="...wterm...">` tag and the inline `<script type="module">` block at lines ~545–554 are deleted.
- [ ] `templates/dashboard/js/terminal.js` no longer contains `createWtermInstance`, `connectPtyStreamWterm`, `getTerminalEngine`, `setTerminalEngine`, the `wterm` / `wtermResizeObserver` fields on `termState`, or any branch that selects between engines. The `if (getTerminalEngine() === 'wterm')` branch in `openTerminalPanel` is removed; the xterm path becomes unconditional when `staticContent` is absent and a session is provided.
- [ ] `destroyXterm()` no longer touches `termState.wterm` or `termState.wtermResizeObserver`. Function may be renamed if it still makes sense, but no behaviour change beyond dropping wterm cleanup.
- [ ] `templates/dashboard/js/settings.js` no longer exposes a Terminal-engine toggle (xterm vs wterm). The settings row + helper hint text + button wiring at lines ~1248–1272 are deleted. Verify no other consumer reads `terminalEngine` from localStorage.
- [ ] Silent migration: on dashboard load, any previously stored `localStorage` key matching the wterm-engine pref is removed (one-line cleanup). No toast, no warning — the user just gets xterm. This keeps existing browsers from carrying dead state forever.
- [ ] No new dependencies added to `package.json`. xterm.js + addons stay as-is.
- [ ] No references to `wterm` (case-insensitive) remain anywhere in `templates/dashboard/`, `lib/`, `docs/agents/`, or `AGENTS.md`. (Allowed: historical references in `docs/specs/features/05-done/` and `docs/specs/features/logs/` — those are immutable history.)
- [ ] Manual smoke test: load dashboard, open one tmux session in the terminal panel, type a few keys, resize the panel, close it. xterm renders correctly throughout, no console errors, no broken Settings → Terminal section.
- [ ] Pre-push gate passes: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`. Playwright is required because dashboard assets are touched.

## Validation

```bash
node -c lib/dashboard-server.js
npm run test:iterate
# Spot-check the user-visible removal worked:
! grep -rIn 'wterm\|WTerm\|WTERM' templates/dashboard lib AGENTS.md 2>/dev/null
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. **For this feature, every iteration touches dashboard assets**, so `test:ui` must run on every iterate. Pre-push gate is unchanged (full Playwright + budget).

## Technical Approach

Pure deletion + one tiny migration shim. No new abstractions.

### Steps

1. **`templates/dashboard/index.html` (~10 LOC removed)** — delete the wterm CDN `<link>` and the inline `<script type="module">` that does the dynamic import.
2. **`templates/dashboard/js/terminal.js` (~80 LOC removed)** — delete `createWtermInstance`, `connectPtyStreamWterm`, `getTerminalEngine`, `setTerminalEngine`, the wterm fields on `termState`, the wterm cleanup in `destroyXterm`, and the engine branch in `openTerminalPanel`. The `if (getTerminalEngine() === 'wterm')` branch goes; the xterm path becomes the only path.
3. **`templates/dashboard/js/settings.js` (~25 LOC removed)** — delete the engine-toggle row + buttons + helper hint. Confirm nothing else reads the engine value from localStorage.
4. **One-line silent migration** — wherever the dashboard's init code first runs (likely `init.js` or near the top of `terminal.js`), add `localStorage.removeItem(lsKey('terminalEngine'))` so users who toggled it on previously don't carry a useless key forever. No UI; this is bookkeeping only.
5. **Search-and-destroy stragglers** — `grep -rIn 'wterm\|WTerm\|WTERM'` across the live tree (excluding done specs/logs). Delete every hit.

### Rollback

Reverting the commit restores the prior behaviour. No data migration to undo (the silent localStorage removal is a no-op the second time around).

### Why low complexity

- 100% deletion + one migration line. No new code paths.
- Touches only dashboard frontend; no engine, no CLI, no write-path-contract concerns.
- xterm path is already the default and well-exercised; flipping it to "only" is a no-op for current users.

## Dependencies

-

## Out of Scope

- PTY pipeline performance work (separate concern; wterm removal does not address the slow-tmux-load report directly).
- Default `terminalClickTarget` change (e.g., default to iTerm2 instead of `'dashboard'`). Discuss separately if desired.
- Adding xterm search addon for Cmd+F parity. Worth doing later if anyone misses the wterm Cmd+F feature; tracked as a follow-up if requested.
- Changes to the external-terminal (iTerm2) attach path. Untouched.

## Open Questions

- Are there any dashboard tests (Playwright) that explicitly cover the wterm toggle? If so, delete or rewrite them; do not skip them. Resolve at impl time via `grep -rIn wterm test/`.
- Should the engine toggle row in Settings be replaced with a stub explanation ("xterm.js — the only supported engine") or simply removed? Default: simply removed; less noise.

## Related

- Prior: `feature-355-in-dashboard-terminal-cutover-and-polish` and `feature-356-in-dashboard-terminal-mvp` (both in `05-done/`) introduced the in-dashboard terminal and the wterm engine experiment respectively. Their logs document what wterm was meant to solve.
