# Research Findings: terminal in dashboard

**Agent:** Claude (cc)
**Research ID:** 40
**Date:** 2026-04-25

---

## Key Findings

### 1. What today's dashboard actually does (baseline)

The current "in-dashboard terminal" is two loosely coupled mechanisms; neither is a real terminal emulator:

- **Peek** (`lib/dashboard-routes.js` `/api/session-peek`, `/api/peek/:id/:agent`, and `peekActiveSessions` bookkeeping in `lib/dashboard-server.js`): runs `tmux capture-pane -p -S -200` for the initial snapshot, then `tmux pipe-pane` to a file in `os.tmpdir()`; the browser polls that file over HTTP. It's a **one-way text tail**, not a PTY.
- **Input** (`/api/session-input`, `/api/session/ask` in `lib/dashboard-routes.js`): `tmux send-keys -t <session> -l <text>` + `Enter`. It sends **literal strings**, not keystrokes — no arrow keys, no Ctrl/Alt/Meta combos, no mouse, no function keys, no bracketed paste.
- **The "real" interactive path is external**: `openTerminalAppWithCommand(...)` in `lib/dashboard-server.js:395/611/617/628` and `lib/dashboard-routes.js:174/721/725/1505/1898` launches iTerm2 / Warp / Terminal.app running `tmux attach -t <name>`. That is the codepath every real agent-driving click ultimately hits; the dashboard does not drive tmux interactively in-browser.

So "comparable to iTerm" isn't a tuning problem on the current stack — it's a missing component. The Peek viewer cannot become iTerm parity; it has to be replaced by a real PTY-backed terminal emulator.

### 2. Gap analysis — Peek vs. tmux-in-iTerm parity

| Capability | Peek today | iTerm+tmux | Notes |
|---|---|---|---|
| Render loop | HTTP poll of tail file | 60 fps GPU | Latency-dominant problem |
| 24-bit colour | Depends on tail renderer (none in current code) | Yes | Sequences arrive but no emulator parses them |
| Mouse reporting | No | Yes | Needed for Claude Code's scroll/click surfaces |
| Keystroke passthrough (Ctrl/Alt/Meta/Fn) | No — `send-keys -l` is literal | Yes | Biggest UX blocker |
| Alt-screen (vim/less/htop) | Partial (may scroll past) | Yes | Requires proper VT parser |
| Bracketed paste | No | Yes | Required for safe multi-line paste into agents |
| OSC 52 copy | No | Yes | Trivial once emulator exists |
| Unicode / emoji width | N/A | Yes | xterm.js `unicode11` addon, wterm has built-in |
| Scrollback | Bounded `-S -200`, not searchable | Full | Needs in-emulator buffer |
| Resize | None — attach keeps server size | Dynamic | Needs PTY SIGWINCH / `tmux refresh-client -C` |
| Copy/paste | Text via OS selection on poll-output | Native | Emulators fix this |

### 3. Candidate front-end terminals

- **xterm.js** — MIT, the incumbent (VS Code, Hyper, JupyterLab, Azure Cloud Shell, Replit, RStudio, Eclipse Che). Addons cover what's missing from Peek: `xterm-addon-fit`, `xterm-addon-webgl`, `xterm-addon-canvas`, `xterm-addon-unicode11`, `xterm-addon-web-links`, `xterm-addon-search`, `xterm-addon-serialize`, `xterm-addon-image` (sixel), `xterm-addon-ligatures`. Largest ecosystem; proven at scale; WebGL renderer is the fast path (the canvas path has historical GPU-specific slowdowns noted upstream).
- **wterm (vercel-labs/wterm)** — Apache-2.0, Zig→WASM core + **DOM renderer**, so native text selection, browser Find, and accessibility work without the custom selection code that xterm.js's canvas/WebGL renderer requires. Packages: `@wterm/core`, `@wterm/dom`, `@wterm/react`. Release build ~12 KB wasm; dirty-row re-render. Maturity: 2.4k stars, v0.1.9 (April 2026), 4 open issues — young and small ecosystem.
- **ttyd** — C + libwebsockets + xterm.js; standalone server, not a library. Great as an iframe drop-in (`--writable`, `--interface`, per-origin WS validation, basic auth), but it owns its own PTYs and server process; integrating with Aigon's existing tmux-session naming / `sessions-close` lifecycle means talking to ttyd out-of-band, not reusing its session model.
- **WeTTY** — Node + xterm.js + SSH/PTY. Fine as a standalone but redundant against `node-pty` in-process for a local-first dashboard.
- **GoTTY** — Go + xterm.js. Similar profile to ttyd; no advantage for an Electron-free Node dashboard.
- **SSH-over-WebSocket frontends** — Solving the wrong problem; Aigon is local-first (out of scope per the spec).
- **Warp's terminal component** — Not a public library; not viable.

### 4. Backend architecture options

**Session model** — attach-to-existing-tmux is the right default. It preserves every invariant Aigon already relies on (`aigon sessions-close`, shell-trap signals via `buildAgentCommand`, heartbeat sidecar, reattach survival across dashboard restarts). Spawn-new-per-tab is a dead end: tmux sessions are Aigon's unit of agent identity.

**PTY host** — `node-pty` (npm, mature, MIT, used by VS Code) wrapping `tmux attach -t <sessionName>`. Advantages over shelling out to ttyd: same process as the dashboard server → same auth boundary, no extra port to firewall, trivial to resize, and the existing tmux session keyspace is reused verbatim. Disadvantages: native module (`node-gyp`) — but Aigon already ships a Node binary via `npm install`, so rebuild-on-install is acceptable; provide a Docker/Linux smoke test (see `reference_docker_linux_testing`).

**Transport** — WebSocket, binary frames. SSE can't carry input; long-poll can't hit latency budget. Binary framing avoids the base64/UTF-8 coercion costs that hurt throughput on heavy-output screens (e.g. a diff dump on code review).

**Resize** — client sends `{type: "resize", cols, rows}`; server calls `pty.resize(cols, rows)`. tmux follows the PTY size. No need for `tmux refresh-client -C` unless we discover a multi-client scaling issue.

**Multi-client reattach** — tmux's native behaviour. Multiple dashboard tabs attaching to the same tmux session already shares the screen, same as two iTerm windows; no extra code.

### 5. Security

Aigon's dashboard is local-first. Two controls that are sufficient and must be explicit:

- **Refuse to serve the PTY endpoint if the dashboard is not bound to loopback.** Add a hard check in the WS upgrade handler — no opt-in, no `--unsafe`. Hosted/remote is out of scope per the research doc and must stay out of this codepath.
- **Origin / CSRF** — validate `Origin` on the WS upgrade; require a short-lived, same-origin-fetched token in the handshake. The dashboard already mints per-session state; re-use that.

Dev-proxy interaction is already localhost-only. No new surface.

### 6. Performance expectations

- xterm.js WebGL is the VS Code renderer; Claude Code output (narrative + diffs) is well within its documented envelope.
- Heaviest real case is a `git diff --stat` tail or a long `feature-eval` dump. At ~2 MB/s PTY throughput, WebSocket binary + WebGL renderer is not the bottleneck — the bottleneck is the PTY producer (tmux capture), which is the same ceiling iTerm hits.
- Memory: xterm.js scrollback is configurable (default 1k lines); match iTerm (e.g. 10k) per session.
- Latency target: sub-30 ms keystroke-to-echo on loopback; WebSocket + node-pty hit that in every public ttyd/WeTTY benchmark.

### 7. Cross-platform reality check

- macOS / Linux (Docker per `reference_docker_linux_testing`) — both are first-class targets for `node-pty`; prebuilt binaries cover Node 20+.
- Browsers — Chromium-family and Safari both render xterm.js WebGL; wterm targets WASM (universal). Safari's stricter clipboard permissions are already handled by xterm.js's `onSelectionChange` + native `navigator.clipboard`.
- Inside Warp-as-browser-host: the dashboard already runs in a normal browser tab, so Warp doesn't participate; no special caveat.

### 8. Product framing

This should be framed as **"dashboard becomes a first-class terminal alongside iTerm"**, not **"remove iTerm entirely"** — at least in Phase 1. Rationale:

- Some users will still prefer iTerm profiles / keybindings / integrations.
- The `terminalApp` config (`lib/dashboard-server.js:648`) is a well-tested escape hatch; demoting it by default rather than removing it costs nothing.
- `feedback_iterm2_tabs_not_windows.md` constrains external UX but says nothing about an in-browser path — this research is the permission slip to relax that constraint by removing the need for iTerm at all, but we can keep the external path alive behind a toggle during the ramp.

MVP ships as an additive panel; default-switch is a later phase after parity is demonstrated.

### 9. Minimum viable first slice

1. Replace the Peek panel's content pane with an xterm.js terminal (keep the existing `#terminal-container` element in `templates/dashboard/index.html:444`).
2. Add `GET /api/session/pty/:sessionName` (WebSocket upgrade) in `lib/dashboard-routes.js`. Handler:
   - Validates loopback-only bind + Origin + token.
   - Spawns `node-pty` with `tmux attach -t <sessionName>`.
   - Pipes bytes both ways; handles a `{type:"resize"}` control frame.
   - On socket close, detaches (does **not** kill the tmux session — lifecycle stays with `sessions-close`).
3. Delete `pipe-pane` tail plumbing (`peekActiveSessions`, `/api/session-peek/*`, `aigon-peek-*.log` files) once the PTY stream is the default; that is a net LOC reduction.
4. Keep `openTerminalAppWithCommand` and the `terminalApp` config. Surface a "Open in external terminal" button in the same drawer for users who prefer iTerm.
5. No changes to Fleet, worktrees, or `aigon sessions-close`.

### 10. Staged rollout

- **Phase 1 (MVP)** — xterm.js + WebGL addon + node-pty attach. Read + write + resize + 24-bit colour + copy/paste. Peek deleted. External-terminal button preserved.
- **Phase 2 (Parity)** — `xterm-addon-unicode11`, `xterm-addon-web-links`, `xterm-addon-image` (sixel), OSC 52 copy, bracketed paste, ligatures, theme tokens tied to dashboard theme, font picker.
- **Phase 3 (Default)** — in-dashboard terminal becomes the default click target; `terminalApp` becomes a fallback config. Per-user preference setting.
- **Phase 4 (Spike)** — behind a flag, swap the xterm.js renderer for `@wterm/core` in one route; measure selection fidelity, accessibility, latency, memory. Keep xterm.js as the supported default; promote wterm only if the numbers clearly win.

## Sources

- [vercel-labs/wterm](https://github.com/vercel-labs/wterm) — Zig/WASM core, DOM renderer, Apache-2.0, v0.1.9 (April 2026)
- [wterm DeepWiki](https://deepwiki.com/vercel-labs/wterm)
- [xterm.js](https://xtermjs.org/) — MIT, used by VS Code, Hyper, JupyterLab, Azure Cloud Shell, Replit
- [xterm.js issue #807 — Virtual DOM rendering](https://github.com/xtermjs/xterm.js/issues/807)
- [tsl0922/ttyd](https://github.com/tsl0922/ttyd) — libwebsockets + xterm.js, MIT, `--interface`, `--writable`, per-origin WS validation
- [Sabuj Kundu — Best Open Source Web Terminals](https://sabujkundu.com/best-open-source-web-terminals-for-embedding-in-your-browser/) — ttyd/WeTTY/GoTTY all wrap xterm.js
- Aigon codebase: `lib/dashboard-routes.js` (`/api/session-peek`, `/api/session-input`, `/api/session/ask`, `/api/open-terminal`), `lib/dashboard-server.js` (`openTerminalAppWithCommand`, `terminalApp` config key, `peekActiveSessions`), `templates/dashboard/index.html` (`#terminal-container`), `templates/dashboard/js/terminal.js`

## Recommendation

Build the MVP on **xterm.js + `node-pty`**, attaching to existing tmux sessions over a same-origin WebSocket, loopback-only, with Origin+token validation. Replace the Peek pipe-pane pipeline with this live PTY stream. Keep the external-terminal path as a fallback behind a per-user preference, and defer the wterm swap to a Phase-4 spike once parity is demonstrated.

Reasoning in one line: xterm.js is the lowest-risk path to true parity (VS Code-proven, largest ecosystem, MIT, best addon story), and the entire Peek mechanism is a half-solution that should be deleted rather than tuned. wterm is genuinely interesting — DOM-native selection and accessibility are real wins — but at v0.1.9 with a small ecosystem, it is a Phase-4 evaluation, not the foundation.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| in-dashboard-terminal-mvp | Replace Peek with xterm.js + node-pty WebSocket attached to existing tmux session; read/write + 24-bit colour + copy/paste | high | none |
| terminal-pty-resize-and-altscreen | PTY resize control frame wired to node-pty; regression tests for alt-screen apps (vim/htop), bracketed paste, and large-output soak (diff tail) | high | in-dashboard-terminal-mvp |
| terminal-websocket-security | Loopback-bind assertion, Origin check, short-lived same-origin token; refuse endpoint when dashboard is bound non-locally | high | in-dashboard-terminal-mvp |
| retire-pipe-pane-peek | Delete peekActiveSessions, /api/session-peek*, aigon-peek tmp files, /api/session-input once PTY stream is the default | medium | in-dashboard-terminal-mvp |
| terminal-addons-and-theming | Wire xterm-addon-webgl / unicode11 / web-links / image (sixel); theme tokens tied to dashboard theme; font picker | medium | in-dashboard-terminal-mvp |
| external-terminal-fallback-toggle | Per-user preference for click-to-attach default (dashboard vs iTerm); preserve openTerminalAppWithCommand as fallback | medium | in-dashboard-terminal-mvp |
| wterm-evaluation-spike | Behind a flag, prototype swapping xterm.js for @wterm/core on one session route; measure latency/memory/selection/accessibility; decide go/no-go | low | in-dashboard-terminal-mvp |
