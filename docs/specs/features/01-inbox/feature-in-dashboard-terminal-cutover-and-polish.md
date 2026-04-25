---
complexity: medium
set: in-dashboard-terminal
---

# Feature: in-dashboard-terminal-cutover-and-polish

## Summary
Once the in-dashboard PTY terminal MVP is live, complete the cutover: **delete** the Peek pipe-pane plumbing, wire **xterm.js polish addons + dashboard theming**, and add a **per-user preference** for the click-to-attach default (in-browser vs. external terminal). Net result: one terminal pipeline in the dashboard, parity with iTerm+tmux for daily agent driving, and a clean fallback to `openTerminalAppWithCommand` for users who prefer iTerm.

This is the second half of the research-40 plan. It only makes sense after `in-dashboard-terminal-mvp` is in main.

## User Stories
- [ ] As a user, the dashboard terminal looks and feels native to the dashboard theme — typography, colour palette, focus styling — and supports the unicode/emoji width, URL detection, and (where applicable) image rendering I expect from a modern terminal.
- [ ] As a user, I can choose whether clicking into a session opens the in-browser terminal or my external terminal (`openTerminalAppWithCommand` / `terminalApp` config), and the choice is remembered.
- [ ] As a maintainer, the codebase has **one** terminal pipeline. The Peek tail-file pipeline (`pipe-pane`, `peekActiveSessions`, `/api/session-peek*`, `aigon-peek-*.log`, the literal-string `/api/session-input`) is gone — net LOC reduction.

## Acceptance Criteria
- [ ] Peek deletion: `peekActiveSessions`, `/api/session-peek*`, `/api/session-input`, and the `aigon-peek-*.log` writer are removed; no callers remain. Net LOC change is negative.
- [ ] No frontend code paths still reference the deleted endpoints.
- [ ] `xterm-addon-webgl`, `xterm-addon-unicode11`, `xterm-addon-web-links`, and `xterm-addon-image` (sixel) are wired and exercised in at least one screenshot test.
- [ ] Terminal theme tokens (background, foreground, cursor, selection, ANSI palette) are driven from the dashboard theme — light and dark.
- [ ] Font picker in dashboard preferences; default is a sensible monospace stack, persisted in user prefs.
- [ ] New per-user preference `terminalClickTarget: "dashboard" | "external"`; default is `"dashboard"` once this feature ships. When set to `"external"`, click-to-attach calls `openTerminalAppWithCommand` exactly as today.
- [ ] `terminalApp` config is preserved as the fallback target for `"external"`.
- [ ] Playwright screenshots: themed terminal (light + dark), unicode/emoji rendering, URL hover.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` all pass.

## Validation
```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised
- May delete tests that exclusively cover the Peek pipe-pane pipeline once the implementation code is removed — replacement coverage already lives in `in-dashboard-terminal-mvp`'s regression bundle.

## Technical Approach
- **Deletion (write-path-contract aware)**: before deleting `peekActiveSessions` / `/api/session-peek*` / `/api/session-input`, grep every caller (frontend + CLI + tests). Prefer one PR-shaped commit that removes producer + consumers + tail-file writer + tests together. Cite the AGENTS.md write-path-contract reasoning in the commit message — this is a deletion that pays a debt the research called out explicitly.
- **Addons**: import + register via xterm.js's standard addon API. Keep them tree-shakeable; do not bundle unused addons.
- **Theming**: pull from the existing dashboard theme tokens; do not invent new colour variables. If a token is missing for a terminal-only need (e.g. ANSI bright), add it to the theme module rather than hard-coding.
- **Preference**: store `terminalClickTarget` in the existing user-pref surface (whatever the dashboard already uses for theme + font preferences). Frontend reads it on click; backend never branches on it because the click path is purely frontend (in-browser PTY WebSocket vs. server-side `openTerminalAppWithCommand`).
- **Migration**: users on the old config keep working. If `terminalClickTarget` is unset, default to `"dashboard"` for new installs; existing installs may continue to default to `"external"` for one minor version to avoid surprise — decide during implementation based on telemetry or simply ship the new default with release notes.
- **Fallback contract**: `"external"` mode must call the unchanged `openTerminalAppWithCommand` codepath; do not refactor that surface in this feature.

## Dependencies
- depends_on: in-dashboard-terminal-mvp

## Out of Scope
- Any change to PTY transport, security envelope, or session model — those are owned by `in-dashboard-terminal-mvp`.
- Mobile/tablet terminal UX.
- `wterm` evaluation (research 40, suggestion #7) — explicitly deferred.

## Open Questions
- Migration default for `terminalClickTarget` on existing installs: flip to `"dashboard"` immediately, or keep `"external"` for one version and flip in the following release? Resolve during spec review.
- Sixel/`xterm-addon-image` is genuinely useful for diff-image tools but adds bundle size. Confirm during implementation whether it earns its keep or moves to a follow-up.

## Related
- Research: 40 — terminal-in-dashboard
- Set: in-dashboard-terminal
- Prior features in set: in-dashboard-terminal-mvp
