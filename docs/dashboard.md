# Dashboard & Radar Architecture

Quick reference for agents working on the Aigon dashboard.

## Overview

The dashboard is a single-page web app served by the **Radar** background service. Radar is a Node.js HTTP server (`runRadarServiceDaemon()` in `lib/utils.js`) that polls workflow state every 30 seconds, serves the dashboard HTML, exposes a JSON API, and sends macOS notifications when agent status changes.

Default port: **4322** (configurable). Bound to `127.0.0.1` only.

## Key Files

| File | Role |
|------|------|
| `lib/utils.js` | Server, API handlers, status collection, action inference |
| `lib/dashboard.js` | Re-exports from `utils.js` (thin wrapper) |
| `templates/dashboard/index.html` | Entire SPA — HTML, CSS, and JS in one file |

## How It Works

```
┌─────────────┐  poll /api/status   ┌──────────────────┐  reads files   ┌─────────────────┐
│  Browser     │ ◄──── every 10s ──►│  Radar HTTP      │ ◄────────────► │  docs/specs/     │
│  (SPA)       │                    │  Server          │                │  (workflow state)│
│              │  POST /api/action  │                  │  spawns CLI    │                  │
│              │ ──────────────────►│                  │ ──────────────►│  aigon <command> │
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
      "research": [ /* same shape, stage is always in-progress */ ],
      "feedback": [ /* same shape */ ]
    }
  ],
  "summary": { "implementing": 0, "waiting": 0, "submitted": 0, "error": 0 }
}
```

### Agent IDs

- Fleet agents: `cc` (Claude Code), `gg` (Gemini), `cu` (Cursor), `cx` (Codex)
- Solo agent: `solo` — a virtual ID meaning "single-agent, no fleet". Solo agents are filtered out of UI elements that don't apply (e.g. worktree-open buttons).

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
| POST | `/api/action` | Run a workflow action (e.g. feature-eval, feature-close) |
| POST | `/api/attach` | Attach to an existing tmux session |
| POST | `/api/worktree-open` | Open or create a worktree tmux session |
| GET | `/api/repos` | List registered repos |
| POST | `/api/repos/add` | Register a repo |
| POST | `/api/repos/remove` | Unregister a repo |
| POST | `/api/spec/create` | Create a new spec in inbox |
| GET | `/api/spec?path=...` | Read a spec file |
| PUT | `/api/spec` | Write/update a spec file |
| POST | `/api/open-in-editor` | Open file in default editor |
| POST | `/api/open-folder` | Open folder in Finder |
| GET | `/api/sessions` | List tmux sessions |
| POST | `/api/session/run` | Run a command in a session |
| POST | `/api/session/start` | Start a new session |
| POST | `/api/session/stop` | Stop a session |
| GET | `/api/session/status` | Get session status |

### Action Dispatch

`POST /api/action` accepts `{ action, args, repoPath }`. The action must be in the `RADAR_INTERACTIVE_ACTIONS` allowlist (e.g. `feature-eval`, `feature-close`, `feature-review`, `research-synthesize`). The server spawns `aigon <action> <args>` as a child process in the target repo directory.

## Next-Action Inference

`inferDashboardNextActions(featureId, agents, stage)` computes context-aware action buttons:

| Stage | Solo | Fleet |
|-------|------|-------|
| **in-progress**, all submitted | Close, Review, Evaluate | Evaluate, Close with {agent} |
| **in-progress**, has waiting | Focus terminal, Stop agent | Same |
| **in-progress**, implementing | Attach, Stop agent | Same |
| **in-evaluation** | Review, Close | Evaluate, Close |
| **backlog** | Start feature | Start feature, Start fleet |

## Notifications

The server sends macOS notifications (`osascript`) when:
- An agent transitions to `waiting` status
- All agents on a feature submit (triggers auto-eval if enabled)
- All research agents submit (ready for synthesis)

## Auto-Eval

When enabled in global config, the server automatically spawns `aigon feature-eval <id>` in a detached tmux session when all fleet agents on a feature reach `submitted` status.
