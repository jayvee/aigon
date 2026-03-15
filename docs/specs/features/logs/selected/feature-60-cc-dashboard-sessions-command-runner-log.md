---
status: submitted
updated: 2026-03-15T12:00:00.000Z
---

# Implementation Log: Feature 60 - dashboard-sessions-command-runner
Agent: cc

## Plan

The feature adds a unified session layer to the Aigon dashboard, enabling users to run commands and launch AI agent sessions directly from the browser instead of copying to a terminal. The implementation spans two files: `lib/utils.js` (server-side API + WebSocket relay) and `templates/dashboard/index.html` (frontend UI).

Approach taken:
- Extend `inferDashboardNextCommand()` with a new `inferDashboardNextActions()` that returns an ordered array of `{command, label, reason, mode}` objects
- Add five new HTTP endpoints for session management
- Implement a WebSocket terminal relay using tmux `pipe-pane` + polling (Option B from spec) to avoid `node-pty` native dependency
- Replace the "Copy next" button with a split button (primary action + dropdown)
- Add an embedded xterm.js terminal panel that reuses the spec drawer's slide-out pattern
- Add a Sessions tab to surface all running tmux sessions

## Progress

### Server (`lib/utils.js`)

**`inferDashboardNextActions(featureId, agents, stage)`** — replaces `inferDashboardNextCommand()`. Returns ordered array of actions with `mode: fire-and-forget | terminal | agent`. Fleet detection uses `realAgents.filter(a => a.id !== 'solo').length > 1` (critical bug fix — original `agents.some(a => a.id !== 'solo')` treated any single non-solo agent as fleet mode, causing solo/drive features to show "Evaluate" instead of "Close feature").

**API endpoints added:**
- `GET /api/sessions` — lists all tmux sessions with name, createdAt, attached status
- `POST /api/session/run` — synchronous spawnSync execution, returns `{ok, stdout, stderr, exitCode}`
- `POST /api/session/start` — creates detached tmux session via `createDetachedTmuxSession`
- `POST /api/session/stop` — kills tmux session
- `GET /api/session/status` — checks if session is running

**WebSocket relay (`/ws/terminal`):**
Manual RFC 6455 implementation (no `ws` package) using SHA1 handshake via Node.js `crypto`. Output streaming via `tmux pipe-pane -O -t <session> 'cat >> <file>'` polled every 50ms. Input via `tmux send-keys -t <session> -l <text>`. Snapshot deferred until after first resize message so tmux pane dimensions match xterm dimensions before capture.

**Terminal resize protocol:** JSON control messages disambiguated by `text.startsWith('{')`. `{"type":"resize","cols":N,"rows":N}` triggers `tmux resize-pane`. `{"type":"input","data":"..."}` routes to send-keys. Raw text falls through as before.

**Snapshot fix:** Original code used `capture-pane -e` (escape sequences) sent immediately on connect, causing severe staircase/diagonal formatting when attached sessions had different terminal dimensions. Fixed by: (1) deferring snapshot until after first resize, (2) dropping `-e` flag to get plain text, (3) converting `\n` → `\r\n` so xterm doesn't staircase.

### Frontend (`templates/dashboard/index.html`)

**Run next split button:** Replaces "Copy next". Builds from `feature.nextActions` array. Primary button executes top action; chevron opens dropdown with all options. Dropdown items show label, monospace command, and reason. Fire-and-forget hits `/api/session/run` with spinner + toast. Terminal/agent modes hit `/api/session/start` then open terminal panel.

**Terminal panel:** Slides in from right (reuses spec drawer positioning). xterm.js 5 from CDN with FitAddon + ResizeObserver for auto-resize. Manual WebSocket handling (not AttachAddon) so `term.onResize` can send resize JSON. Panel header: status dot (running/error), session label, View Spec, fullscreen, Stop, Detach buttons.

**Split-view layout:** When terminal panel and spec drawer are both open, `body.split-view` class repositions terminal to `left:0; right:min(55vw,720px)` so both headers are fully accessible. Triggered automatically when either panel opens and the other is already open. `← Dashboard` button appears in terminal header in split-view to close both panels at once. ESC in split-view also closes both.

**Stale file indicator:** Polls `/api/spec?path=...` every 3s when terminal has a spec context and spec drawer is open. Compares content hash (length + last 200 chars). When changed, adds `stale` class to `↺ Refresh` button — pulsing amber animation. Cleared on refresh click.

**Inline stop confirmation:** Replaced browser `confirm()` with pre-rendered `#panel-actions-confirm` div toggled show/hide. Shows "Kill session-name? [Cancel] [Kill]" in the panel header.

**Sessions tab:** New tab showing all tmux sessions grouped as "Dashboard Sessions" (`aigon-dash-*`) and "Agent Sessions". Each row: name, age, attached badge, Attach (opens in terminal panel via WebSocket) and Kill buttons.

**Use AI:** Button on create modal and spec drawer header. Shows agent picker modal (cc/gg/cx/cu) with localStorage persistence (`aigon.dashboard.lastAgent`). Builds agent CLI command, starts tmux session, opens terminal panel in fullscreen mode.

**Settings tab bug fix:** After visiting Sessions tab, `repos` element was left `display:none`, making Settings content invisible. Fixed by explicitly resetting `repos.style.display = ''` in the settings branch of `render()`.

**Modal z-index fix:** AI picker modal backdrop was z-index 100, behind spec drawer at 201. Fixed to 400.

## Decisions

**Option B for WebSocket (tmux pipe-pane, no node-pty):** Avoids native addon compilation. Trades real-time PTY streaming for 50ms polling latency — acceptable for this use case.

**JSON control protocol over raw WebSocket:** Chose to check `text.startsWith('{')` and parse JSON for resize/control messages, falling through to raw send-keys for normal input. Simpler than a binary framing protocol, works well in practice since terminal input rarely starts with `{`.

**Deferred snapshot:** Rather than sending the snapshot immediately on connect (which races with terminal sizing), we wait for the first `resize` message, run `tmux resize-pane` to match, then send the snapshot. This ensures the captured content matches the xterm dimensions.

**Split-view via body class:** CSS class on `<body>` drives the side-by-side layout. This lets both panels manage their own open/close state independently while the layout adjusts automatically.

**Inline stop confirmation:** Browser `confirm()` is visually jarring and not theme-aware. Pre-rendered hidden `div` toggled with show/hide is simpler than innerHTML replacement (which requires rewiring event handlers).

**Sessions tab:** User reported losing track of tmux sessions after refreshing the browser. The Sessions tab surfaces all 20+ running sessions with Attach (reconnect to existing session via WebSocket) and Kill actions. Dashboard sessions (`aigon-dash-*`) are visually distinguished from other agent sessions.
