# Feature: better-tmux-ux-from-dashboard

## Summary
Improve tmux session interaction from the dashboard. Currently clicking Attach just shows "Session opened in your terminal" without reliably bringing the session to the foreground. This feature adds three levels of tmux interaction: (a) fix the attach to actually bring the correct iTerm2 tab/window to the foreground, (b) add a "peek" mode showing the last few lines of scrollback in the dashboard, and (c) add an embedded terminal viewer in the browser for full session viewing.

## User Stories
- [ ] As a user, when I click Attach on a session, the correct iTerm2 tab/window comes to the foreground — not just the app
- [ ] As a user, I can peek at recent output from any tmux session without leaving the dashboard
- [ ] As a user, I can view a live tmux session in an embedded terminal in the dashboard browser UI

## Acceptance Criteria

### (a) Fix attach and unify terminology — "View" everywhere
- [ ] Rename "Attach" to "View" in the Sessions tab — consistent with Pipeline tab's existing "View" button
- [ ] Both Sessions and Pipeline use the same label ("View") and the same behavior: bring the iTerm2 tab/window to the foreground
- [ ] Clicking View on an already-attached session brings the correct iTerm2 tab/window to the foreground (not just `activate`)
- [ ] Bug fix: `openTerminalAppWithCommand()` in `lib/worktree.js:390-392` — the early return for already-attached sessions skips the window-focus AppleScript; it should run the focus logic (lines 398-421) before returning
- [ ] Consider unifying the two API paths: Sessions uses `/api/attach`, Pipeline uses `/api/feature-open` — ideally both should use the same endpoint or at least share the same focus logic

### (b) Peek mode — recent scrollback in dashboard
- [ ] Sessions panel shows a "Peek" button (or auto-shows on hover/click) that displays the last ~20 lines of tmux scrollback
- [ ] Uses `tmux capture-pane -t <session> -p -S -20` to grab recent output
- [ ] Updates on a reasonable interval (e.g., every 3-5 seconds while the peek panel is open)
- [ ] Rendered in a monospace pre-formatted block in the right panel

### ~~(c) Embedded terminal viewer~~ — DESCOPED
Historically caused complexity issues. (a) + (b) cover the use case without introducing xterm.js, PTY management, or WebSocket terminal streaming.

## Validation
```bash
node -c lib/worktree.js
node -c lib/dashboard-server.js
npm test
```

## Technical Approach

### (a) Attach fix
Minimal change in `openTerminalAppWithCommand()`: when `isTmuxSessionAttached(title)` is true, run the window-focus AppleScript (lines 398-421) instead of just `activate`. Fall through to `activate` only if the focus script returns "not found".

### (b) Peek mode
- New dashboard API endpoint: `GET /api/session-peek?name=<session>` that runs `tmux capture-pane -t <session> -p -S -20` and returns the output
- Dashboard frontend polls this endpoint while peek panel is visible
- Render output in `<pre>` block with ANSI color stripping (or basic ANSI-to-HTML conversion)

### ~~(c) Embedded terminal~~ — DESCOPED
Too complex, historically caused issues. Not worth the xterm.js/PTY/WebSocket overhead when peek covers the read-only use case.

## Dependencies
- None (works with current dashboard infrastructure)

## Out of Scope
- Terminal emulator for non-tmux processes
- Remote/SSH terminal access
- Multi-user terminal sharing

## Open Questions
- Should peek auto-update or require manual refresh? (Leaning auto-update every 3-5s while panel is open)

## Related
- Bug: `lib/worktree.js:390-392` — early return skips window focus for attached sessions
- Pipeline "View" works: uses `/api/feature-open` → `requestFeatureOpen()` in `templates/dashboard/js/api.js:74`
- Sessions "Attach" broken: uses `/api/attach` → `requestAttach()` in `templates/dashboard/js/api.js:3` → hits the buggy early-return path in `openTerminalAppWithCommand()`
- Dashboard sessions tab: `templates/dashboard/index.html`, `lib/dashboard-server.js`
