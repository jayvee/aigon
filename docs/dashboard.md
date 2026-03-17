# Dashboard & Radar Architecture

Quick reference for agents working on the Aigon dashboard.

## Overview

The dashboard is a single-page web app served by the **Radar** background service. Radar is a Node.js HTTP server (`runRadarServiceDaemon()` in `lib/utils.js`) that polls workflow state every 30 seconds, serves the dashboard HTML, exposes a JSON API, and sends macOS notifications when agent status changes.

## Starting & Stopping

| Command | What it does |
|---------|-------------|
| `aigon radar start` | Spawns daemon, registers with dev-proxy, reloads Caddy |
| `aigon radar stop` | Kills daemon, removes PID file |
| `aigon radar status` | Shows PID, URL, worktree instances, repo summary |
| `aigon radar open` | Opens `http://aigon.test` in browser |
| `aigon radar install` | Installs as launchd service (auto-start on login) |
| `aigon radar uninstall` | Removes launchd service |

**Note:** `aigon dashboard` is a deprecated alias that redirects to `aigon radar open`.

## Dev Proxy Stack

The dashboard is accessed via `http://aigon.test`, not `localhost:PORT`. This requires a local reverse proxy stack:

```
Browser ──► http://aigon.test ──► Caddy (port 80) ──► localhost:4100 (Radar)
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
| `~/.aigon/dev-proxy/servers.json` | Registry of all servers (radar + dev-servers) |
| `~/.aigon/radar.pid` | PID file for running radar daemon |
| `~/.aigon/radar.log` | Radar daemon log |

### Ports

| Service | Port | URL |
|---------|------|-----|
| Main radar | 4100 (default) | `http://aigon.test` |
| Worktree instances | Dynamic from 9000+ | `http://{agent}-{id}.aigon.test` |

**Do NOT hardcode port 3000 or 4322** — the actual port is 4100 and is registered in the dev-proxy.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `aigon.test` returns empty/404 | Radar not registered in dev-proxy | `aigon radar stop && aigon radar start` |
| `[WebSocket error]` in terminal panel | tmux session died before WebSocket connected (command failed) | Check `~/.aigon/radar.log` for details |
| Dead worktree instances in status | Old worktree radar instances not cleaned up | `aigon dev-server gc` |
| Stale PID in status | `~/.aigon/radar.pid` points to dead process | Delete PID file, then `aigon radar start` |
| `aigon.test` not resolving | dnsmasq or resolver not set up | Run `aigon proxy-setup` |

## Key Files (Source Code)

| File | Role |
|------|------|
| `lib/utils.js` | Server, API handlers, status collection, Caddyfile generation, proxy registration |
| `lib/dashboard.js` | Re-exports from `utils.js` (thin wrapper) |
| `templates/dashboard/index.html` | Entire SPA — HTML, CSS, and JS in one file |
| `lib/state-machine.js` | Defines action modes (`terminal`, `fire-and-forget`, `agent`) that control dashboard behavior |

### Key functions in `lib/utils.js`

| Function | Line | Purpose |
|----------|------|---------|
| `runRadarServiceDaemon(port)` | ~2188 | Main HTTP server + WebSocket handler |
| `generateCaddyfile(registry)` | ~818 | Builds Caddyfile from dev-proxy registry |
| `reloadCaddy(registry)` | ~841 | Writes Caddyfile and reloads Caddy |
| `registerRadarServer(serverId, entry)` | ~1145 | Adds to registry + reloads Caddy |
| `collectDashboardStatusData()` | varies | Scans specs, logs, worktrees, tmux for status |
| `inferDashboardNextActions()` | ~1215 | Computes action buttons from state machine |

## How It Works

```
┌─────────────┐  poll /api/status   ┌──────────────────┐  reads files   ┌─────────────────┐
│  Browser     │ ◄──── every 10s ──►│  Radar HTTP      │ ◄────────────► │  docs/specs/     │
│  (SPA)       │                    │  Server          │                │  (workflow state)│
│              │  POST /api/action  │                  │  spawns CLI    │                  │
│              │ ──────────────────►│                  │ ──────────────►│  aigon <command> │
│              │                    │                  │                │                  │
│              │  WS /ws/terminal   │                  │  tmux relay    │                  │
│              │ ◄═════════════════►│                  │ ◄════════════► │  tmux sessions   │
└─────────────┘                    └──────────────────┘                └─────────────────┘
```

**Server-side polling**: The server polls `collectDashboardStatusData()` every **30 seconds**, scanning spec files, log files, and worktree directories across all registered repos. It also detects tmux sessions for agent status.

**Client-side polling**: The browser fetches `GET /api/status` every **10 seconds** and re-renders the active view.

## Frontend Views (Tabs)

| Tab | Function | Renderer |
|-----|----------|----------|
| **Monitor** | Live agent status — shows in-progress and in-evaluation items with agent rows, status dots, and action buttons | `renderMonitor()` |
| **Pipeline** | Kanban board — drag-and-drop cards across columns (inbox → backlog → in-progress → evaluation → done) | `renderPipeline()` |
| **Sessions** | Tmux session management — list, start, stop, attach to agent sessions | `renderSessions()` |
| **Settings** | Repo registry management, auto-eval toggle, radar config | `renderSettings()` |

Both Monitor and Pipeline have a type toggle to filter by: All, Features, Research, Feedback.

## Status Data Shape

`GET /api/status` returns:

```json
{
  "generatedAt": "ISO timestamp",
  "repos": [
    {
      "path": "/absolute/path",
      "displayPath": "~/src/repo",
      "features": [
        {
          "id": "42", "name": "feature-name", "stage": "in-progress|in-evaluation|...",
          "agents": [{ "id": "cc|gg|solo", "status": "implementing|waiting|submitted|error", "updatedAt": "..." }],
          "nextActions": [{ "command": "aigon ...", "label": "...", "reason": "...", "mode": "agent|fire-and-forget|terminal" }],
          "evalStatus": "evaluating|pick winner|null",
          "specPath": "/path/to/spec.md"
        }
      ],
      "research": [ ],
      "feedback": [ ]
    }
  ],
  "summary": { "implementing": 0, "waiting": 0, "submitted": 0, "error": 0 }
}
```

### Agent IDs

- Fleet agents: `cc` (Claude Code), `gg` (Gemini), `cu` (Cursor), `cx` (Codex)
- Solo agent: `solo` — a virtual ID meaning "single-agent, no fleet". Solo agents are filtered out of UI elements that don't apply (e.g. feature-open buttons).

### Status Collection

`collectDashboardStatusData()` builds the status object by:

1. Reading spec files from `docs/specs/features/{01-inbox..05-done}/` and `research-topics/` and `feedback/`
2. Scanning implementation log files (`docs/specs/features/logs/`) for agent status frontmatter
3. Checking worktree directories (`{repo}-worktrees/`) for fleet agent worktrees
4. Probing tmux sessions to detect running agents
5. Calling `inferDashboardNextActions()` to compute available actions per feature

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Current status data (cached from last poll) |
| POST | `/api/refresh` | Force re-poll and return fresh status |
| POST | `/api/action` | Run a workflow action synchronously (e.g. feature-close, feature-stop) |
| POST | `/api/session/start` | Create detached tmux session, return `sessionName` for WebSocket |
| POST | `/api/session/run` | Run command synchronously, return stdout/stderr (fire-and-forget) |
| POST | `/api/session/stop` | Stop a tmux session |
| GET | `/api/sessions` | List tmux sessions |
| GET | `/api/session/status` | Get session status |
| POST | `/api/attach` | Attach to an existing tmux session |
| POST | `/api/feature-open` | Open or create a worktree tmux session |
| POST | `/api/feature-open` | Open a feature worktree in terminal |
| GET | `/api/repos` | List registered repos |
| POST | `/api/repos/add` | Register a repo |
| POST | `/api/repos/remove` | Unregister a repo |
| POST | `/api/spec/create` | Create a new spec in inbox |
| GET | `/api/spec?path=...` | Read a spec file |
| PUT | `/api/spec` | Write/update a spec file |
| POST | `/api/open-in-editor` | Open file in default editor |
| POST | `/api/open-folder` | Open folder in Finder |
| WS | `/ws/terminal?session=NAME` | WebSocket terminal relay to tmux session |

### Action Dispatch & Modes

Dashboard actions use different endpoints based on the state machine's `mode` field:

| Mode | Endpoint | Behavior |
|------|----------|----------|
| `fire-and-forget` | `POST /api/session/run` | Synchronous execution, returns stdout/stderr immediately. No WebSocket. |
| `terminal` | `POST /api/session/start` | Creates tmux session, returns `sessionName`. Dashboard opens WebSocket for live streaming. |
| `agent` | `POST /api/session/start` | Same as terminal — creates tmux session with WebSocket. Used for long-running agent tasks (eval, review). |

`POST /api/action` is used for state machine actions dispatched from button clicks. It accepts `{ action, args, repoPath }` and spawns `aigon <action> <args>` synchronously.

## Next-Action Inference

`inferDashboardNextActions(featureId, agents, stage)` delegates to the state machine (`getRecommendedActions()`) and converts results to dashboard action buttons with commands, labels, and modes.

| Stage | Solo | Fleet |
|-------|------|-------|
| **in-progress**, all submitted | Close, Review | Evaluate, Close with {agent} |
| **in-progress**, implementing | Attach, Stop | Same |
| **in-evaluation** | Review, Close | Evaluate, Close |
| **backlog** | Setup | Setup |

**Important:** Solo features should never reach `in-evaluation`. The state machine blocks the `in-progress → in-evaluation` transition for non-fleet features.

## Notifications

The server sends macOS notifications (`osascript`) when:
- An agent transitions to `waiting` status
- All agents on a feature submit (triggers auto-eval if enabled)
- All research agents submit (ready for synthesis)

## Auto-Eval

When enabled in global config, the server automatically spawns `aigon feature-eval <id>` in a detached tmux session when all fleet agents on a feature reach `submitted` status.
