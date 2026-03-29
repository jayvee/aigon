# Implementation Log: Feature 106 - better-tmux-ux-from-dashboard
Agent: cc

## Plan
Three acceptance criteria: (a) fix attach/View rename + window-focus bug, (b) implement peek mode with streaming output and input, (c) embedded terminal — descoped.

## Progress
- Read spec, explored existing code paths for Sessions and Pipeline tabs
- Fixed window-focus bug in `openTerminalAppWithCommand()` (worktree.js:390-392)
- Renamed "Attach" → "View" in Sessions tab, updated toast messages
- Added `/api/session/view` endpoint for direct session focus by name
- Added `/api/session-peek` (GET), `/api/session-peek/stop` (POST), `/api/session-input` (POST) endpoints
- Created `peek.js` frontend with polling, ANSI stripping, auto-scroll, input box
- Added peek panel HTML to index.html
- All tests pass (187 unit + 26 manifest + 30 Playwright)

## Decisions
- **New `/api/session/view` endpoint**: Sessions tab doesn't have featureId/agentId context like Pipeline does, so created a simpler endpoint that takes just `sessionName`. It reuses `openTerminalAppWithCommand()` which now correctly focuses the specific iTerm2 window.
- **pipe-pane over capture-pane**: Used `tmux pipe-pane` as primary streaming mechanism with `capture-pane -S -50` as fallback. pipe-pane gives continuous output without polling the pane buffer repeatedly.
- **Incremental reads with byte offset**: The peek API returns a byte offset so the client only requests new data each poll cycle (1.5s interval).
- **ANSI stripping in frontend**: Strips escape sequences client-side for clean display. Considered ANSI-to-HTML but kept it simple — stripping is sufficient for monitoring.
- **Input sanitization**: Strips control characters (0x00-0x08, 0x0e-0x1f) from send-keys input to prevent tmux escape sequence injection.
- **Auto-cleanup**: peek pipe-pane and temp files cleaned up on panel close, session kill, and peek stop.
- **Output trimming**: Peek output DOM is trimmed to ~200KB to prevent memory issues in long-running sessions.
