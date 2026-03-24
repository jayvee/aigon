# Feature: web terminal viewer in dashboard

## Summary
Embed a web-based terminal in the dashboard so "View" buttons attach to tmux sessions in the browser — no local terminal app required. Uses ttyd or xterm.js to expose tmux sessions as web terminals. Enables cross-machine viewing (Docker, SSH, remote servers) and makes the dashboard fully self-contained.

## User Stories
- [ ] As a user running aigon in Docker, I can click "View" on an agent and see the live terminal in my browser
- [ ] As a user on a remote Linux server, I can view agent sessions from any machine with a browser
- [ ] As a user on macOS, I can choose between native terminal or in-browser viewing

## Acceptance Criteria
- [ ] Dashboard "View" button opens a web terminal panel attached to the tmux session
- [ ] Web terminal supports ANSI colors, cursor movement, and interactive input
- [ ] Works for both feature and research agent sessions
- [ ] Falls back to native terminal (iTerm2/Warp) when configured
- [ ] Multiple concurrent web terminal sessions supported
- [ ] Session auto-closes when the tmux session ends

## Technical Approach

### Option A: ttyd (lightweight)
- Spawn `ttyd --port <dynamic> tmux attach -t <session>` per session
- "View" opens in iframe or new tab

### Option B: xterm.js + node-pty (embedded, best UX)
- Bundle xterm.js in dashboard frontend
- Relay pty I/O over existing dashboard WebSocket
- No extra ports, fully integrated

## Dependencies
- Research: ttyd vs xterm.js+node-pty

## Out of Scope
- SSH tunneling or remote machine discovery
- Auth for web terminals
- Session recording/playback

## Open Questions
- Inline panel or new tab?
- Does node-pty work reliably in Docker?

## Related
- Feature 141: linux terminal support
- Dashboard peek view (current tmux capture-pane approach)
