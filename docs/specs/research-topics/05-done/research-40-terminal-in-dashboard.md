---
complexity: high
transitions:
  - { from: "in-evaluation", to: "done", at: "2026-04-25T09:21:33.302Z", actor: "cli/research-close" }
  - { from: "inbox", to: "backlog", at: "2026-04-25T00:07:02.424Z", actor: "cli/research-prioritise" }
---

# Research: terminal-in-dashboard

## Context

Today the dashboard can attach to a running tmux session and show its contents, but the interaction model is weak — it is not comparable to running Claude Code (or any other interactive CLI agent) inside a real terminal emulator like iTerm2. Keystrokes, paste, scrollback, resize, colour, and mouse behaviour all fall short of what a user gets from tmux-in-iTerm.

The user wants to investigate whether Aigon can ship a **browser-native terminal** that runs tmux inside the dashboard itself, removing the need for iTerm (or any external terminal) for day-to-day agent driving. The trigger for this research is [vercel-labs/wterm](https://github.com/vercel-labs/wterm), which appears to be a web terminal implementation that might be a suitable foundation — but the scope is broader than wterm specifically: any library, pattern, or architecture that achieves parity is in scope.

The end-state to aim for: a user can open the Aigon dashboard, click into an agent session, and interact with tmux/Claude Code there with **exactly the same fidelity** as iTerm+tmux — input latency, rendering, scrollback, copy/paste, resize, 24-bit colour, mouse reporting, and reliability across long-running sessions.

## Questions to Answer

- [ ] What is [wterm](https://github.com/vercel-labs/wterm)? How does it work (architecture, transport, rendering), what is its maturity, licence, and maintenance status, and is it production-ready for our use case?
- [ ] What are the credible alternatives (xterm.js + a PTY bridge, ttyd, wetty, gotty, Warp's terminal component, SSH-over-WebSocket front-ends, others)? For each: architecture, maturity, licence, footprint, and fit for embedding in Aigon's dashboard.
- [ ] What is the gap between today's dashboard-attach view and true tmux-in-iTerm parity? Enumerate the specific missing capabilities (input handling, 24-bit colour, mouse, resize, scrollback, bracketed paste, OSC 52 copy, unicode/emoji width, keybinding passthrough including Cmd/Opt, alternate screen buffer behaviour, latency under load).
- [ ] What is the right backend architecture to run tmux per user session for the browser terminal? Options include: attach-to-existing tmux sessions (current worktree model) vs. spawn-new-per-tab; PTY host process; WebSocket vs. SSE vs. long-poll transport; auth model; multi-tab/multi-client reattach semantics.
- [ ] How does the solution integrate with Aigon's existing session model (worktrees, Fleet, agent lifecycle, `aigon sessions-close`)? Does it replace the tmux attach panel, supplement it, or only apply to new-style sessions?
- [ ] What are the security implications of serving a browser terminal that can spawn/attach to local shells? Local-only bind, CSRF/WebSocket-origin checks, process isolation, auth tokens, risk of sharing the dashboard URL.
- [ ] Performance: what input latency, render throughput, and memory profile should we expect for a long-running Claude Code session with heavy output (e.g. code review diffs)? What are the limits of the candidate libraries?
- [ ] Cross-platform reality check: does the chosen approach work equally on macOS, Linux (Docker), and inside Warp/other browsers? Any Safari/Chromium-specific caveats?
- [ ] What is the minimum viable first slice? (e.g. one read/write terminal panel in the dashboard, backed by a single tmux attach, no multiplexing UI changes.) What does a staged rollout look like from MVP → iTerm parity → iTerm replacement?
- [ ] Is this a "remove iTerm entirely" play or a "dashboard becomes a first-class option alongside iTerm" play? What does the user flow look like in each case, and which is the right product bet?

## Scope

### In Scope
- Evaluating wterm and comparable browser-terminal libraries (xterm.js-based and otherwise).
- Backend architectures for bridging a browser terminal to host tmux sessions (PTY host, transport, auth).
- Feature-parity analysis vs. tmux-in-iTerm.
- Integration surface with existing Aigon session/worktree/Fleet model.
- Security model for a local-dev dashboard terminal.
- Recommending a concrete first-slice feature (or set of features) and a path to parity.

### Out of Scope
- Actually implementing the terminal (that is a follow-up feature).
- Replacing tmux itself — tmux remains the multiplexer; this is only about the frontend terminal.
- Remote/hosted-dashboard scenarios (Aigon is local-first; revisit if/when we ship hosted).
- Rewriting the existing tmux attach panel unless the research explicitly recommends it.
- Mobile/tablet terminal UX.

## Inspiration / Starting Points
- [vercel-labs/wterm](https://github.com/vercel-labs/wterm) — user-supplied starting reference.
- xterm.js (the underlying renderer most web terminals use).
- Memory: `feedback_iterm2_tabs_not_windows.md` — prior constraint was tabs over cmux/tmux -CC; this research may relax that by removing iTerm from the loop entirely.
- Memory: `project_dashboard_always_on.md` — dashboard is the daily command center, so a terminal there is aligned with product direction.

## Findings

Only **cc** produced findings; **gg** and **op** submitted empty templates. Synthesis below is therefore single-source — flagged where it matters.

### Today's baseline (from cc, verified against code paths)
The dashboard "terminal" today is two unrelated mechanisms, neither a real emulator:
- **Peek**: `tmux capture-pane` snapshot + `tmux pipe-pane` to a tmpfile, browser HTTP-polls the tail. One-way text tail.
- **Input**: `tmux send-keys -l <text>` — literal strings only. No arrow keys, modifiers, mouse, function keys, or bracketed paste.
- **Real interactive path is external**: `openTerminalAppWithCommand(...)` launches iTerm/Warp running `tmux attach`. Every "drive an agent" click ultimately exits the browser.

iTerm parity is therefore not a tuning problem on the current stack — Peek must be **replaced** by a PTY-backed terminal emulator.

### Library landscape
- **xterm.js** (MIT) — incumbent. VS Code, Hyper, JupyterLab, Replit, Azure Cloud Shell. WebGL renderer, full addon ecosystem (`fit`, `webgl`, `unicode11`, `web-links`, `search`, `image`/sixel, `ligatures`). Lowest-risk default.
- **wterm** (vercel-labs, Apache-2.0) — Zig→WASM core + **DOM renderer**, so native browser selection / Find / a11y work without xterm.js's custom selection layer. Young: v0.1.9, ~2.4k stars, small ecosystem. Promising but premature as the foundation.
- **ttyd / WeTTY / GoTTY** — all wrap xterm.js but ship their own server + PTY model. Embedding any of them means running a sidecar process and talking to its session keyspace out-of-band; that breaks Aigon's tmux-session-as-identity model (`sessions-close`, shell-trap signals, heartbeat sidecars).
- **SSH-over-WebSocket / Warp's component** — out of scope (remote / not public).

### Backend architecture
- **Session model**: attach-to-existing tmux. Spawn-new-per-tab breaks `aigon sessions-close`, `buildAgentCommand` shell-trap signals, and the heartbeat sidecar. Tmux session names are Aigon's unit of agent identity.
- **PTY host**: `node-pty` (MIT, used by VS Code) wrapping `tmux attach -t <sessionName>` in-process. Same auth boundary as the dashboard server, no extra port. Native module, but Aigon already requires Node install; covered by the existing Docker/Linux smoke path (`reference_docker_linux_testing`).
- **Transport**: WebSocket, binary frames. SSE can't carry input; long-poll can't hit latency.
- **Resize**: control frame `{type:"resize",cols,rows}` → `pty.resize`; tmux follows the PTY size.
- **Multi-client**: tmux's native shared-attach behaviour — no extra code.

### Security (must be explicit, not opt-in)
- **Loopback-only assertion** at WS upgrade. Refuse the endpoint if the dashboard bind is non-loopback. No `--unsafe`, no env override. Hosted is out of scope per the brief.
- **Origin check + short-lived same-origin token** in the upgrade handshake. Reuse the existing dashboard session minting.

### Performance & cross-platform
- WebGL renderer + WS binary handles the heaviest Aigon case (eval/diff dump) under ~30 ms keystroke-to-echo on loopback in published ttyd/WeTTY benchmarks.
- macOS + Linux (Docker) covered by `node-pty` prebuilds. Chromium + Safari both render xterm.js WebGL fine.

### Product framing
**"Dashboard becomes a first-class terminal alongside iTerm,"** not "remove iTerm". The `terminalApp` config is a tested escape hatch; demote it later. `feedback_iterm2_tabs_not_windows.md` is about external-terminal UX and does not block an in-browser path. Default-switch is a later phase after parity is demonstrated.

### Gap-analysis confidence
Single-agent synthesis (gg + op produced no content). The gap table (mouse, modifiers, alt-screen, bracketed paste, OSC 52, unicode width, scrollback, resize) is consistent with the public xterm.js/wterm capability matrices and Aigon's actual code paths, but it has not been independently corroborated.

## Recommendation

Build the MVP on **xterm.js + node-pty**, attaching to existing tmux sessions over a same-origin WebSocket bound to loopback with Origin + short-lived token validation. Replace the Peek pipe-pane pipeline (delete it; net LOC reduction). Keep `openTerminalAppWithCommand` and `terminalApp` config as a per-user fallback. Defer wterm to a Phase-4 spike once xterm.js parity is in place.

Rationale: xterm.js is the lowest-risk path to true iTerm parity (VS Code-proven, MIT, largest addon ecosystem). Peek is a half-solution that should be deleted rather than tuned. wterm's DOM-renderer wins (native selection / a11y) are real but at v0.1.9 it is an evaluation target, not a foundation.

### Suggested features (priority order)

| # | Feature name | Why now | Depends on |
|---|--------------|---------|------------|
| 1 | `in-dashboard-terminal-mvp` | Replaces Peek with xterm.js + node-pty WS attached to existing tmux. Read/write + 24-bit colour + copy/paste + resize. The whole proposal stands or falls on this slice. | none |
| 2 | `terminal-websocket-security` | Loopback-bind assertion, Origin check, short-lived token. Must ship with #1, not after — opening a PTY endpoint without these is the only real risk. | #1 |
| 3 | `retire-pipe-pane-peek` | Delete `peekActiveSessions`, `/api/session-peek*`, `/api/session-input`, `aigon-peek-*.log`. Keeping both paths is the bug factory. | #1 |
| 4 | `terminal-pty-resize-and-altscreen-tests` | Regression tests for vim/htop alt-screen, bracketed paste, large-output soak (diff tail). The features that broke Peek silently. | #1 |
| 5 | `terminal-addons-and-theming` | `xterm-addon-webgl` / `unicode11` / `web-links` / `image` (sixel), theme tokens tied to dashboard theme, font picker. | #1 |
| 6 | `external-terminal-fallback-toggle` | Per-user preference: click-to-attach defaults to dashboard or iTerm. Preserves `openTerminalAppWithCommand`. | #1 |
| 7 | `wterm-evaluation-spike` | Behind a flag, swap xterm.js for `@wterm/core` on one route; measure latency/memory/selection/a11y; decide go/no-go. | #1 |

## Output
- [x] Feature: in-dashboard-terminal-mvp (bundles MVP + WS security + alt-screen/resize/paste/soak regression tests — research-40 suggestions 1+2+4)
- [x] Feature: in-dashboard-terminal-cutover-and-polish (bundles Peek deletion + xterm.js addons & theming + per-user click-target preference — research-40 suggestions 3+5+6)
- Deferred (not filed): wterm-evaluation-spike (research-40 suggestion 7) — revisit after MVP is live
