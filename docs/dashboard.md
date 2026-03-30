# Dashboard Architecture

Quick reference for agents working on the Aigon dashboard.

## Overview

The dashboard is a single-page web app served by a foreground HTTP server. It's a Node.js HTTP server (`runDashboardServer()` in `lib/dashboard-server.js`) that polls workflow state every 10 seconds, serves the dashboard HTML, exposes a JSON API, and sends macOS notifications when agent status changes.

## Starting & Stopping

| Command | What it does |
|---------|-------------|
| `aigon dashboard` | Starts the dashboard (foreground, port 4100) |
| `node aigon-cli.js dashboard` | Same, explicit invocation |

The dashboard runs as a **foreground process** — Ctrl+C or `aigon dev-server stop` to stop it. Each worktree gets its own port and, when aigon-proxy is running, a named URL (e.g. `http://cc-73.aigon.localhost`).

## Dev Proxy Stack

The dashboard is accessed via `http://aigon.localhost`, not `localhost:PORT`. This uses the aigon-proxy daemon, a tiny Node.js reverse proxy:

```
Browser ──► http://aigon.localhost ──► aigon-proxy (port 80 or 4080) ──► localhost:4100 (Dashboard)
                                            │
       http://cc-63.aigon.localhost ────────┘──► localhost:4202 (worktree instance)
```

`.localhost` domains resolve to `127.0.0.1` automatically per RFC 6761 — **no DNS configuration needed**.

### Setup

```bash
aigon proxy start    # Start the proxy daemon
aigon proxy install  # Optional: install launchd plist for auto-start on boot
```

### Key files

| File | Purpose |
|------|---------|
| `~/.aigon/dev-proxy/servers.json` | Registry of all servers (dashboard + dev-servers) |
| `~/.aigon/dev-proxy/proxy.pid` | PID of the running aigon-proxy daemon |
| `~/.aigon/dashboard.log` | Dashboard log |

### Ports

| Service | Port | URL |
|---------|------|-----|
| Main dashboard | 4100 (default) | `http://aigon.localhost` |
| Worktree instances | 4101–4199 (dynamic) | `http://{agent}-{id}.aigon.localhost` |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aigon.localhost` returns 404 | Dashboard not registered or proxy not running | `aigon proxy start`, then restart dashboard |
| Dead worktree instances in status | Old worktree dashboard instances not cleaned up | `aigon dev-server gc` |
| `aigon.localhost` not resolving | Rare: OS doesn't handle `.localhost` wildcard | Use `http://localhost:4080` directly |
| Dashboard shows wrong data | Config parse error or stale registry | Check `~/.aigon/dashboard.log` for `[*] Warning:` lines |

### Startup validation

On every startup, `runDashboardServer()` calls `validateRegistry()` which:
1. Reads `~/.aigon/dev-proxy/servers.json`
2. For each entry, verifies the registered PID is alive (or port is in use if no PID)
3. Removes stale entries (dead processes, crashed dev servers)
4. Logs a summary: `Registry: N live, M stale removed`

The summary is always written to `~/.aigon/dashboard.log`. If stale entries were removed, it is also printed to the console.

### Error logging

All warnings from config reads, JSON parse failures, and file permission errors are written to `~/.aigon/dashboard.log`. To investigate unexpected behavior:

```bash
tail -50 ~/.aigon/dashboard.log
# Look for [context] Warning: lines
```

### State files

| File | Purpose |
|------|---------|
| `~/.aigon/dev-proxy/servers.json` | Registry of all live servers + embedded port allocations (`_portRegistry` key) |
| `~/.aigon/dashboard.log` | Dashboard log (warnings, startup messages, notifications) |

> **Note:** Port allocation data was previously stored in `~/.aigon/ports.json`. As of v2.50, it is merged into `servers.json` under the `_portRegistry` key. The legacy file is migrated and removed automatically on first access.

## Key Files (Source Code)

| File | Role |
|------|------|
| `lib/dashboard-server.js` | HTTP server, polling, WebSocket relay, notifications, action dispatch, dashboard HTML builder |
| `lib/proxy.js` | Port allocation, registry management, dev server registration, aigon-proxy integration |
| `lib/aigon-proxy.js` | Standalone proxy daemon — routes by Host header, handles WebSocket upgrades |
| `lib/config.js` | Global/project config, profiles, agent CLI config |
| `lib/worktree.js` | Worktree management, tmux sessions, terminal launching |
| `lib/dashboard.js` | Thin re-exporter for backward compatibility |
| `templates/dashboard/index.html` | Entire SPA — HTML, CSS, and JS in one file |
| `lib/workflow-core/` | Workflow engine — sole authority for feature lifecycle state |
| `lib/state-queries.js` | Pure action/transition derivation from engine state — controls dashboard behavior |
| `lib/workflow-snapshot-adapter.js` | Maps engine snapshots to dashboard display formats |

### Key functions in `lib/dashboard-server.js`

| Function | Purpose |
|----------|---------|
| `runDashboardServer(port)` | Main HTTP server |
| `collectDashboardStatusData()` | Scans specs, logs, worktrees, tmux for status |
| `runDashboardInteractiveAction()` | Executes actions triggered from dashboard UI |
| `buildDashboardHtml(initialData, instanceName)` | Renders the SPA HTML |
| `sendMacNotification(message, title)` | Sends macOS desktop notifications |

### Key functions in `lib/proxy.js`

| Function | Purpose |
|----------|---------|
| `registerDevServer(appId, serverId, ...)` | Adds to servers.json (proxy reads it live) |
| `deregisterDevServer(appId, serverId)` | Removes from servers.json |
| `reconcileProxyRoutes()` | Cleans dead entries from servers.json |
| `getDevProxyUrl(appId, serverId)` | Returns `http://{serverId}.{appId}.localhost` |
| `isProxyAvailable()` | Checks if aigon-proxy daemon is running |

## How It Works

```
┌─────────────┐  poll /api/status   ┌──────────────────┐  reads files   ┌─────────────────┐
│  Browser     │ ◄──── every 10s ──►│  Dashboard HTTP   │ ◄────────────► │  docs/specs/     │
│  (SPA)       │                    │  Server           │                │  (workflow state)│
│              │  POST /api/action  │                   │  spawns CLI    │                  │
│              │ ──────────────────►│                   │ ──────────────►│  aigon <command> │
│              │                    │                   │                │                  │
│              │  WS /ws/terminal   │                   │  tmux relay    │                  │
│              │ ◄═════════════════►│                   │ ◄════════════► │  tmux sessions   │
└─────────────┘                    └───────────────────┘                └─────────────────┘
```

**Server-side polling**: The server polls `collectDashboardStatusData()` every **10 seconds**, scanning spec files, log files, and worktree directories across all registered repos. It also detects tmux sessions for agent status.

**Client-side polling**: The browser fetches `GET /api/status` every **10 seconds** and re-renders the active view.

## Frontend Views (Tabs)

| Tab | Function | Renderer |
|-----|----------|----------|
| **Monitor** | Live agent status — shows in-progress and in-evaluation items with agent rows, status dots, and action buttons | `renderMonitor()` |
| **Pipeline** | Kanban board — drag-and-drop cards across columns (inbox → backlog → in-progress → evaluation → done) | `renderPipeline()` |
| **Sessions** | Tmux session management — list, start, stop, attach to agent sessions | `renderSessions()` |
| **Console** | Live action log — shows recent CLI actions and their output | `renderConsole()` |
| **Settings** | Repo registry management, auto-eval toggle, dashboard config | `renderSettings()` |

Both Monitor and Pipeline have a type toggle to filter by: All, Features, Research, Feedback.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Current status data (cached from last poll) |
| POST | `/api/refresh` | Force re-poll and return fresh status |
| POST | `/api/action` | Run a workflow action synchronously |
| POST | `/api/session/start` | Create detached tmux session |
| POST | `/api/session/run` | Run command synchronously (fire-and-forget) |
| POST | `/api/session/stop` | Stop a tmux session |
| GET | `/api/sessions` | List tmux sessions |
| POST | `/api/feature-open` | Open a feature worktree in terminal |
| GET | `/api/repos` | List registered repos |
| POST | `/api/repos/add` | Register a repo |
| POST | `/api/repos/remove` | Unregister a repo |
| POST | `/api/spec/create` | Create a new spec in inbox |
| GET | `/api/spec?path=...` | Read a spec file |
| PUT | `/api/spec` | Write/update a spec file |
| POST | `/api/open-in-editor` | Open file in default editor |
| WS | `/ws/terminal?session=NAME` | WebSocket terminal relay to tmux session |
| GET | `/api/action-log` | Recent action log entries |

## Notifications

The server sends macOS notifications (`osascript`) when:
- An agent signals implementation complete (`submitted` status)
- All agents on a feature are done (triggers auto-eval if enabled)
- All research agents are done (ready for synthesis)

## Auto-Eval

When enabled in global config, the server automatically spawns `aigon feature-eval <id>` in a detached tmux session when all fleet agents on a feature reach `submitted` status.
