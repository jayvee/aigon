# Dashboard On The AIGON Server

Quick reference for agents working on the Aigon dashboard UI and the AIGON server that serves it.

## Overview

The dashboard is a single-page web app. It is served by the AIGON server, a foreground Node.js process whose HTTP/UI module lives in `lib/dashboard-server.js`. The dashboard is the interface; the AIGON server is the process that serves the HTML, exposes the JSON API, polls workflow state every 10 seconds, and runs the runtime concerns around it.

## Starting & Stopping

| Command | What it does |
|---------|-------------|
| `aigon server start` | Start the AIGON server (serves dashboard UI + API) |
| `aigon server stop` | Stop the server |
| `aigon server restart` | Restart the server |
| `aigon server status` | Show server health and uptime |

The AIGON server runs as a foreground process with a fixed identity and URL: `http://aigon.localhost` (or `http://localhost:4100` when proxy is unavailable), regardless of the current working directory.

## Dev Proxy Stack

The dashboard is accessed via `http://aigon.localhost`, not `localhost:PORT`. This uses **Caddy** as a reverse proxy:

```
Browser ──► http://aigon.localhost ──► Caddy (port 80 or 4080) ──► localhost:4100 (Dashboard)
                                           │
       http://cc-63.brewboard.localhost ───┘──► localhost:4202 (worktree dev server)
```

`.localhost` domains resolve to `127.0.0.1` automatically per RFC 6761 — **no DNS configuration needed**.

### Setup

```bash
brew install caddy       # Install Caddy (one-time)
aigon proxy install      # Install Caddy as a system daemon on port 80 (requires sudo)
```

Without `aigon proxy install`, run `aigon proxy start` for a session-local Caddy on port 4080 — URLs will include the port (e.g. `http://aigon.localhost:4080`).

### Key files

| File | Purpose |
|------|---------|
| `~/.aigon/dev-proxy/Caddyfile` | Caddy config — routes for dashboard and all dev servers |
| `~/.aigon/ports.json` | Port allocation registry (project name → base port) |
| `~/.aigon/dashboard.log` | AIGON server log for dashboard/UI traffic |
| `/Library/LaunchDaemons/com.aigon.caddy.plist` | System daemon plist (created by `aigon proxy install`) |

### Ports

| Service | Port | URL |
|---------|------|-----|
| Main AIGON server instance | 4100 (default) | `http://aigon.localhost` |
| Preview dashboard instances (`aigon server start --preview`) | 4101–4199 (dynamic) | `http://{agent}-{id}.aigon-preview.localhost` |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aigon.localhost` returns connection refused | Caddy not running | `aigon proxy start` or `aigon proxy install` |
| `aigon.localhost` requires a port (`:4080`) | Caddy running without system daemon | Run `aigon proxy install` to bind port 80 |
| Dead worktree instances in status | Old AIGON server worktree instances not cleaned up | `aigon dev-server gc` |
| `aigon.localhost` not resolving | Rare: OS doesn't handle `.localhost` wildcard | Use `http://localhost:4100` directly |
| Dashboard shows wrong data | Config parse error or stale registry | Check `~/.aigon/dashboard.log` for `[*] Warning:` lines |

### Error logging

All warnings from config reads, JSON parse failures, and file permission errors are written to `~/.aigon/dashboard.log`. To investigate unexpected behavior:

```bash
tail -50 ~/.aigon/dashboard.log
# Look for [context] Warning: lines
```

### State files

| File | Purpose |
|------|---------|
| `~/.aigon/dev-proxy/Caddyfile` | Caddy route config — dashboard + all dev servers |
| `~/.aigon/ports.json` | Port allocation registry (project name → base port) |
| `~/.aigon/dashboard.log` | AIGON server log (warnings, startup messages, notifications) |

## Key Files (Source Code)

| File | Role |
|------|------|
| `lib/dashboard-server.js` | AIGON server HTTP/UI module: polling, WebSocket relay, notifications, action dispatch, dashboard HTML builder |
| `lib/proxy.js` | Caddy management — Caddyfile read/write/reload, port allocation, dev server routing |
| `lib/config.js` | Global/project config, profiles, agent CLI config |
| `lib/worktree.js` | Worktree management, tmux sessions, terminal launching |
| `templates/dashboard/index.html` | Entire SPA — HTML, CSS, and JS in one file |
| `lib/workflow-core/` | Workflow engine — sole authority for feature lifecycle state |
| `lib/state-queries.js` | Pure action/transition derivation for feedback entities — used by the AIGON server for feedback dashboard behavior. Feature/research actions come from workflow-core exclusively |
| `lib/workflow-snapshot-adapter.js` | Maps engine snapshots to dashboard display formats served by the AIGON server |

### Key functions in `lib/dashboard-server.js`

| Function | Purpose |
|----------|---------|
| `runDashboardServer(port)` | Start the AIGON server HTTP/UI module |
| `collectDashboardStatusData()` | Scans specs, logs, worktrees, tmux for status |
| `runDashboardInteractiveAction()` | Executes actions triggered from dashboard UI |
| `buildDashboardHtml(initialData, instanceName)` | Renders the SPA HTML |
| `sendMacNotification(message, title)` | Sends macOS desktop notifications |

### Key functions in `lib/proxy.js`

| Function | Purpose |
|----------|---------|
| `addCaddyRoute(hostname, port)` | Adds a reverse_proxy route to Caddyfile and reloads Caddy |
| `removeCaddyRoute(hostname)` | Removes a route from Caddyfile and reloads Caddy |
| `parseCaddyRoutes()` | Reads current routes from Caddyfile |
| `writeCaddyfile(routes)` | Writes a new Caddyfile from a route list |
| `getDevProxyUrl(appId, serverId)` | Returns `http://{serverId}.{appId}.localhost` |
| `isProxyAvailable()` | Checks if Caddy admin API is reachable (port 2019) |

## How It Works

```
┌─────────────┐  poll /api/status   ┌──────────────────┐  reads files   ┌─────────────────┐
│  Browser     │ ◄──── every 10s ──►│  AIGON server     │ ◄────────────► │  docs/specs/     │
│  (SPA)       │                    │  Server           │                │  (workflow state)│
│              │  POST /api/action  │                   │  spawns CLI    │                  │
│              │ ──────────────────►│                   │ ──────────────►│  aigon <command> │
│              │                    │                   │                │                  │
│              │  WS /ws/terminal   │                   │  tmux relay    │                  │
│              │ ◄═════════════════►│                   │ ◄════════════► │  tmux sessions   │
└─────────────┘                    └───────────────────┘                └─────────────────┘
```

**Server-side polling**: The AIGON server polls `collectDashboardStatusData()` every **10 seconds**, scanning spec files, log files, and worktree directories across all registered repos. It also detects tmux sessions for agent status.

**Client-side polling**: The browser fetches `GET /api/status` every **10 seconds** and re-renders the active view.

## Frontend Views (Tabs)

| Tab | Function | Renderer |
|-----|----------|----------|
| **Monitor** | Live agent status — shows in-progress and in-evaluation items with agent rows, status dots, and action buttons | `renderMonitor()` |
| **Pipeline** | Kanban board — drag-and-drop cards across columns (inbox → backlog → in-progress → evaluation → done) | `renderPipeline()` |
| **Sessions** | Tmux session management — list, start, stop, attach to agent sessions | `renderSessions()` |
| **Logs** | Live action log — shows recent CLI actions and their output | `renderLogs()` |
| **Settings** | Unified settings screen for repositories, notifications, models, and defaults/overrides | `renderSettings()` |

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
| POST | `/api/open-in-editor` | Open file in default editor |
| WS | `/ws/terminal?session=NAME` | WebSocket terminal relay to tmux session |
| GET | `/api/action-log` | Recent action log entries |

## Notifications

The AIGON server sends macOS notifications (`osascript`) when:
- An agent signals implementation complete (`ready` status)
- All agents on a feature are done (triggers auto-eval if enabled)
- All research agents are done (ready for synthesis)

## Auto-Eval

When enabled in global config, the AIGON server automatically spawns `aigon feature-eval <id>` in a detached tmux session when all fleet agents on a feature reach `ready` status.
