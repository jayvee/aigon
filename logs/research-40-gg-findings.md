# Research Findings: Terminal in Dashboard (Gemini)

## 1. Web Terminal Candidates

### [vercel-labs/wterm](https://github.com/vercel-labs/wterm)
- **Architecture:** Unlike most web terminals that use Canvas/WebGL, `wterm` renders directly to the DOM. The terminal parsing logic is written in Zig and compiled to a small (~12KB) WebAssembly blob.
- **Maturity/Licence:** It is a newer, more experimental project from Vercel. MIT licensed.
- **Fit for Aigon:** Excellent for accessibility and native browser features (Find, copy/paste without overriding browser shortcuts), but it lacks the decade of battle-testing that alternatives have for complex interactive CLI apps.

### xterm.js
- **Architecture:** The industry-standard frontend terminal component (used by VS Code, Hyper). It handles rendering (WebGL/Canvas) and ANSI escape sequences but requires a custom backend (like `node-pty`) and transport layer.
- **Maturity:** Extremely mature, production-ready.
- **Fit for Aigon:** The safest and most robust choice for achieving true iTerm-parity, as it supports everything from 24-bit color to mouse reporting and bracketed paste.

### ttyd & wetty
- **ttyd:** A standalone C-based binary that bridges a PTY to xterm.js via WebSockets. Extremely fast, but distributing a C binary across OSes adds packaging overhead for Aigon.
- **wetty:** A Node.js-based bridge using `node-pty` and `xterm.js`. Closer to Aigon's stack, but we likely only need the architectural pattern (`node-pty` + WebSockets), not the entire `wetty` application.

## 2. The Gap: Current Dashboard vs. True Parity
Aigon's current dashboard terminal view likely relies on polling or tailing text (e.g., `tmux capture-pane`), which results in a read-only or low-fidelity experience. The gap includes:
- **Input Handling:** No passthrough of keystrokes, signals (Ctrl+C/Ctrl+D), or special keybindings (Cmd/Opt).
- **Rendering:** Missing full ANSI parsing, 24-bit true color, and proper unicode/emoji width calculations.
- **Dynamic Resize:** The current dashboard does not send `SIGWINCH` to the PTY when the browser window resizes, breaking CLI layouts.
- **Interactivity:** No mouse reporting or alternate screen buffer support (needed for tools like `vim` or `less`).

## 3. Backend Architecture
The optimal architecture to bridge the browser terminal to host sessions:
- **Backend:** Integrate `node-pty` into Aigon's `lib/dashboard-server.js`.
- **Integration:** When a user opens an agent session, the backend spawns a PTY process running `tmux attach -t <session-id>`. This seamlessly integrates with Aigon's existing worktree/Fleet model without disrupting the underlying `workflow-core` engine.
- **Transport:** Use a dedicated WebSocket connection between the dashboard UI and the `dashboard-server`.

## 4. Security Implications
Because a web terminal grants arbitrary shell execution:
- **Bind Address:** The WebSocket server must bind strictly to `localhost` (`127.0.0.1`).
- **Origin Validation:** Strict WebSocket Origin checks are mandatory to prevent Cross-Site WebSocket Hijacking (CSWSH) from malicious public websites.
- **Authentication:** The dashboard server should generate a short-lived, unguessable token on startup. The frontend must pass this token during the WebSocket handshake to prevent other local users/processes from attaching to the terminal.

## 5. Performance Expectations
- **xterm.js + WebGL:** Can render tens of thousands of lines per second with minimal CPU overhead.
- **node-pty:** Negligible overhead for spawning processes.
- **Latency:** Over local WebSockets, input latency will be functionally indistinguishable from a native local terminal (often <5ms).

## 6. Staged Rollout (MVP)
The goal is a "dashboard becomes a first-class option" play.
- **MVP First Slice:** A single read/write terminal panel built with `xterm.js` and `node-pty`, connecting via WebSocket to a single `tmux attach` session. No multiplexing UI changes; just replacing the current read-only view with a fully interactive terminal for an existing session.

## Recommendation
**Implement a custom bridge using `xterm.js` and `node-pty` within Aigon's Node.js dashboard server.**

While `wterm` is an interesting DOM-based alternative, `xterm.js` guarantees the compatibility required for complex CLI tools like Claude Code and tmux. Embed `node-pty` in `lib/dashboard-server.js` to spawn `tmux attach` processes and pipe them over a secure, authenticated local WebSocket.

## Suggested Features
| Feature Name | Description | Priority | Depends On |
| :--- | :--- | :--- | :--- |
| `dashboard-websocket-pty` | Add secure WebSocket server and `node-pty` integration to `dashboard-server.js` | high | none |
| `dashboard-xterm-ui` | Integrate `xterm.js` into the dashboard frontend to render the interactive terminal | high | `dashboard-websocket-pty` |
| `dashboard-tmux-attach` | Route agent session views to spawn `tmux attach` inside the PTY backend | high | `dashboard-websocket-pty` |