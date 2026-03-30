---
status: submitted
updated: 2026-03-16T12:35:32.771Z
startedAt: 2026-03-16T10:59:47.186Z
completedAt: 2026-03-16T12:35:32.771Z
events:
  - { ts: "2026-03-16T10:59:47.186Z", status: implementing }
  - { ts: "2026-03-16T12:25:34.120Z", status: submitted }
---

# Implementation Log: Feature 70 - dashboard-infrastructure-rebuild
Agent: cc

## Plan

Replace the AIGON server+proxy+relay stack with a simple foreground HTTP server. The plan followed 6 ordered steps (each leaving the system runnable):

1. Rename radar→dashboard constants and functions in `lib/utils.js`
2. Add port-per-instance (deterministic hash 4101–4199) and discovery files (`~/.aigon/instances/`)
3. Convert to foreground server: 5-min idle timeout, browser auto-open on start, no daemon/PID/launchd
4. Remove proxy: Caddy, dnsmasq, `registerRadarServer`/`deregisterRadarServer`/`resolveRadarUrl`
5. Remove WebSocket terminal relay: xterm.js CDN scripts, ws upgrade handler, `/api/session/start`
6. Retire companions: delete `vscode-extension/`, remove menubar/conductor subcommands, make `radar` a deprecated alias

An additional step was added after reading `lib/state-machine.js`: update `/api/feature-open` to call `getSessionAction()` (attach vs create-and-start vs send-keys) and add a `/api/open-terminal` endpoint for generic `mode=terminal` CLI commands.

## Progress

### `lib/utils.js`
- Replaced `RADAR_*` constants with `DASHBOARD_*` (default port 4100, dynamic range 4101–4199)
- Added `hashBranchToPort(branchName)` for deterministic worktree port assignment
- Added `writeDashboardInstance`, `removeDashboardInstance`, `listDashboardInstances` for discovery files at `~/.aigon/instances/`
- Added `detectDashboardContext()` returning `{ isWorktree, instanceName, worktreePath }`
- Renamed `runRadarServiceDaemon` → `runDashboardServer(port, instanceName)`:
  - 5-minute idle timer; resets on every incoming request
  - Writes discovery file on `server.listen`, removes on shutdown
  - Opens browser via `openInBrowser` after listen
  - Removed WebSocket upgrade handler (~200 lines)
  - Removed `/api/session/start` endpoint
- Updated `/api/feature-open` to call `stateMachine.getSessionAction()` using cached agent status from `latestStatus`, handling `attach`, `send-keys` (tmux send-keys to restart agent in existing session), and `create-and-start`
- Added `/api/open-terminal` endpoint: accepts `{ command, cwd }`, calls `openTerminalAppWithCommand`
- Removed: `readRadarMeta`, `writeRadarMeta`, `removeRadarMeta`, `isRadarAlive`, `requestRadarJson`, `renderRadarMenubarFromStatus`, `writeRadarLaunchdPlist`, `registerRadarServer`, `deregisterRadarServer`, `resolveRadarUrl`
- Updated `buildDashboardHtml` to inject `${INSTANCE_NAME}` placeholder
- Updated COMMAND_REGISTRY and exports

### `lib/commands/shared.js`
- Replaced ~510-line `radar` command handler with a 2-line deprecated alias forwarding to `dashboard`
- Replaced `dashboard` stub with full foreground server command: no-subcommand starts server, `list`, `open`, `add`, `remove`, `status` subcommands
- Removed `proxy-setup` command (~150 lines)
- Removed menubar/vscode/launchd subcommands from `conductor`

### `lib/devserver.js`
- Removed re-exports of deleted functions (`detectRadarContext`, `registerRadarServer`, `deregisterRadarServer`, `resolveRadarUrl`)
- Added `detectDashboardContext` re-export

### `templates/dashboard/index.html`
- Removed 4 xterm.js CDN script tags
- Injected `const INSTANCE_NAME = ${INSTANCE_NAME}` and `lsKey()` helper for namespaced localStorage keys
- Updated all `localStorage.getItem/setItem('aigon.dashboard.*')` calls to use `lsKey()`
- Simplified `termState`: removed `ws`, `fitAddon`, `resizeObserver`, `term` fields
- Rewrote `openTerminalPanel`: no xterm init, no WebSocket, shows `<pre>` for staticContent or "Session opened in your terminal" otherwise
- Updated `closeTerminalPanel`/`toggleTerminalFullscreen`: removed ws/fitAddon/resizeObserver cleanup
- Updated `executeNextAction` for `mode=terminal`: POST `/api/open-terminal` → panel shows "Session opened in your terminal"
- Updated `executeNextAction` for `mode=agent`: POST `/api/session/run` (synchronous) → show output in panel
- Updated `launchAiSession`: POST `/api/session/run` for now (known limitation — see feature-71)
- Fixed `avgAutonomy` ReferenceError in `renderStatistics` that froze the Statistics tab

### `vscode-extension/`
- Deleted entirely

### `aigon-cli.test.js`
- Updated imports to use new constant/function names (`DASHBOARD_*`, `detectDashboardContext`)
- Replaced radar-specific tests with dashboard equivalents
- Removed tests for deleted functions (`registerRadarServer`, `deregisterRadarServer`, `resolveRadarUrl`)

### Testing
- All syntax checks pass: `node -c` on all JS files
- 145/147 tests pass (2 pre-existing failures unrelated to this feature)
- Manual: dashboard starts on port 4159 (worktree hash), instance file written/cleaned up, API responds correctly, Statistics tab renders, Sessions tab loads

## Decisions

**Discovery files over PID files**: Single JSON per instance in `~/.aigon/instances/` carries port, pid, worktreePath, name and startedAt. This lets `dashboard list` show all instances across worktrees without a central registry.

**Deterministic port hashing**: djb2-style hash of branch name → range 4101–4199. Avoids port conflicts across worktrees without coordination. Fallback to `allocatePort` if preferred port is in use.

**`getSessionAction()` in `/api/feature-open`**: Rather than reimplementing the attach/create/send-keys decision tree, the endpoint reads `latestStatus` (cached from last poll) to get the agent's current status and feeds it to the state machine's `getSessionAction()`. The `send-keys` case uses `tmux send-keys` to restart the agent in the existing session.

**`mode=terminal` in executeNextAction**: Recommended-next-action buttons with `mode=terminal` (e.g. `aigon feature-do 70 cc`) now POST to `/api/open-terminal` and show "Session opened in your terminal" in the panel overlay. No WebSocket, no synchronous run.

**`launchAiSession` left as known limitation**: The "Use AI" button in the spec drawer uses `/api/session/run` synchronously. This works for short commands but hangs for interactive agents. Captured as feature-71 to fix with `/api/open-terminal`.

**avgAutonomy bug**: The `renderStatistics` function referenced `avgAutonomy` before computing it, causing a silent ReferenceError that left the Statistics tab frozen at "Loading statistics…". Fixed by computing it from `filteredFeatures.autonomyRatio` alongside the other metric calculations.
