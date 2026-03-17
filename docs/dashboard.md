# Dashboard Architecture

Quick reference for agents working on the Aigon dashboard.

## Overview

The dashboard is a single-page web app served by a foreground HTTP server. It's a Node.js HTTP server (`runDashboardServer()` in `lib/utils.js`) that polls workflow state every 10 seconds, serves the dashboard HTML, exposes a JSON API, and sends macOS notifications when agent status changes.

## Starting & Stopping

| Command | What it does |
|---------|-------------|
| `aigon dashboard` | Starts the dashboard (foreground, port 4100) |
| `node aigon-cli.js dashboard` | Same, explicit invocation |

The dashboard runs as a **foreground process** — Ctrl+C or `aigon dev-server stop` to stop it. Each worktree gets its own port and, when Caddy is configured, a named URL (e.g. `http://cc-73.aigon.test`).

## Dev Proxy Stack

The dashboard is accessed via `http://aigon.test`, not `localhost:PORT`. This requires a local reverse proxy stack:

```
Browser ──► http://aigon.test ──► Caddy (port 80) ──► localhost:4100 (Dashboard)
                                      │
            http://cc-63.aigon.test ──┘──► localhost:4202 (worktree instance)
```

### Components

| Component | Role | Install |
|-----------|------|---------|
| **Caddy** | Reverse proxy on port 80 | `brew install caddy`, runs as root via `brew services` |
| **dnsmasq** | Resolves `*.test` → `127.0.0.1` | `brew install dnsmasq` |
| **macOS resolver** | `/etc/resolver/test` points to dnsmasq | Created by `aigon proxy-setup` |

### One-time setup

```bash
aigon proxy-setup
```

This installs Caddy + dnsmasq, creates the resolver file, generates the Caddyfile, and starts services.

### Key files

| File | Purpose |
|------|---------|
| `~/.aigon/dev-proxy/Caddyfile` | Auto-generated Caddy config (symlinked from `/opt/homebrew/etc/Caddyfile`) |
| `~/.aigon/dev-proxy/servers.json` | Registry of all servers (dashboard + dev-servers) |
| `~/.aigon/dashboard.log` | Dashboard log |

### Ports

| Service | Port | URL |
|---------|------|-----|
| Main dashboard | 4100 (default) | `http://aigon.test` |
| Worktree instances | 4101–4199 (dynamic) | `http://{agent}-{id}.aigon.test` |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aigon.test` returns empty/404 | Dashboard not registered in dev-proxy | Restart dashboard |
| Dead worktree instances in status | Old worktree dashboard instances not cleaned up | `aigon dev-server gc` |
| `aigon.test` not resolving | dnsmasq or resolver not set up | Run `aigon proxy-setup` |

## Key Files (Source Code)

| File | Role |
|------|------|
| `lib/utils.js` | Server, API handlers, status collection, Caddyfile generation, proxy registration |
| `lib/dashboard.js` | Re-exports from `utils.js` (thin wrapper) |
| `templates/dashboard/index.html` | Entire SPA — HTML, CSS, and JS in one file |
| `lib/state-machine.js` | Defines action modes (`terminal`, `fire-and-forget`, `agent`) that control dashboard behavior |

### Key functions in `lib/utils.js`

| Function | Purpose |
|----------|---------|
| `runDashboardServer(port)` | Main HTTP server |
| `generateCaddyfile(registry)` | Builds Caddyfile from dev-proxy registry |
| `reloadCaddy(registry)` | Writes Caddyfile and reloads Caddy |
| `registerDevServer(appId, serverId, ...)` | Adds to registry + reloads Caddy |
| `collectDashboardStatusData()` | Scans specs, logs, worktrees, tmux for status |
| `runDashboardInteractiveAction()` | Executes actions triggered from dashboard UI |

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
- An agent transitions to `waiting` status
- All agents on a feature submit (triggers auto-eval if enabled)
- All research agents submit (ready for synthesis)

## Auto-Eval

When enabled in global config, the server automatically spawns `aigon feature-eval <id>` in a detached tmux session when all fleet agents on a feature reach `submitted` status.
