---
status: submitted
updated: 2026-03-16T10:46:55.954Z
---

# Research Findings: radar dashboard radical simplification

**Agent:** Gemini (gg)
**Research ID:** 11
**Date:** 2026-03-16

---

## Key Findings

1. **Core Value is Control, Not Emulation:** The dashboard's essential value is as a control surface (launching agents, moving features, setting up worktrees) and high-level status monitor. The complex WebSocket terminal relay (`pipe-pane`, `capture-pane`) is the source of much fragility and only provides a subpar web terminal.
2. **Native Terminals are Superior:** The Aigon CLI already implements robust native terminal attachment (`openTerminalAppWithCommand` supporting Terminal.app/iTerm2). The dashboard can trigger native terminal attachment via a simple POST request to an API, completely eliminating the need for WebSocket streaming, complex resizing logic, and long-running stateful browser connections.
3. **Caddy & dnsmasq are Overkill:** Relying on `*.test` local domains introduces heavy system-level constraints (root/sudo for Caddy daemon, modifying `/etc/resolver/test`). Serving the dashboard directly on `http://localhost:4100` (for main) and `http://localhost:4101` (for dev) removes all "Caddy is broken" failure modes and makes setup truly zero-config.
4. **Stateless API Model vs Heavy Daemon:** The AIGON server doesn't need to hold long-running state. It can function as a lightweight HTTP API that reads `docs/specs/` and `.aigon/config.json` on request, and executes CLI commands (like `aigon worktree-open`) as subprocesses. State conflicts between production and dev instances disappear if they simply read from their respective Git working trees and bind to different ports.
5. **Maintenance Burden of Companions:** The menubar and VS Code extensions duplicate the dashboard's functionality but require maintaining integration with separate ecosystems (SwiftBar/xbar and VS Code extension API). Retiring them consolidates development focus purely on making the single web dashboard highly reliable.

## Sources

- `lib/utils.js`: `openTerminalAppWithCommand` implementation
- `lib/dashboard.js`: Current WebSocket implementation (`// ── WebSocket terminal relay`)
- `lib/utils.js`: Current Caddy/dnsmasq logic (`generateCaddyfile`, `reloadCaddy`)
- Current Radar UI: `templates/dashboard/index.html` (3666 lines)

## Recommendation

I recommend combining **Hypothesis A** and **Hypothesis B**. We should pivot to a minimal Node.js HTTP API server running on `localhost:4100` (or a dynamically allocated port for worktrees). 

We should completely remove Caddy, dnsmasq, and the WebSocket terminal relay. The dashboard UI should be a static application that polls the API for status and POSTs actions. Terminal viewing should be outsourced to the user's native terminal application via `tmux attach`. Finally, the menubar and VS Code extensions should be officially retired to streamline the control surface strategy.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `radar-minimal-api` | Replace complex stateful daemon with a lightweight HTTP API serving JSON from the filesystem and executing CLI actions. | high | none |
| `radar-native-terminals` | Remove WebSocket relay and replace with "Open in Terminal" API actions using `openTerminalAppWithCommand`. | high | `radar-minimal-api` |
| `radar-drop-proxy` | Remove Caddy, dnsmasq, and `.test` domain routing. Serve directly on `localhost` with dynamic port allocation for dev worktrees. | high | `radar-minimal-api` |
| `radar-retire-companions` | Deprecate and completely remove the VS Code extension and menubar plugin commands and code. | medium | none |