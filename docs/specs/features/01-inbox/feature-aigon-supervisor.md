# Feature: aigon-supervisor

## Architecture

One process: `aigon dashboard start`. Two modules inside it with strict separation.

```
One process (managed by launchd/systemd, auto-restarts on crash)
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌──────────────────┐     ┌──────────────────┐          │
│  │  HTTP module      │     │  Supervisor module│          │
│  │                   │     │                   │          │
│  │  Serves UI        │     │  Polls tmux       │          │
│  │  Handles API      │     │  Checks heartbeats│          │
│  │  Reads snapshots  │     │  Emits signals    │          │
│  │                   │     │  Sends notifs     │          │
│  │  NEVER mutates    │     │  ONLY emits       │          │
│  │  engine state     │     │  signal events    │          │
│  └────────┬──────────┘     └────────┬──────────┘          │
│           │                         │                    │
│           │  Never call each other  │                    │
│           ▼                         ▼                    │
│  ┌─────────────────────────────────────────────────┐     │
│  │  Engine (files on disk: events.jsonl, snapshot)  │     │
│  └─────────────────────────────────────────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The HTTP module never imports the supervisor module. The supervisor module never imports the HTTP module. They share a process for operational simplicity (one thing to install, one thing to keep alive), not because they need each other.

## Module responsibilities

### HTTP module (`lib/dashboard-server.js` — refactored)

- Serves dashboard HTML/JS/CSS
- Handles API requests (read snapshots, proxy user actions to CLI)
- Pushes status updates via WebSocket
- Reads engine snapshots from disk
- **Never** polls tmux, checks heartbeats, classifies orphans, kills sessions, emits signals, or sends notifications

### Supervisor module (`lib/supervisor.js` — new, under 300 lines)

Does four things:

1. **Detects dead sessions** — polls tmux session liveness every 30 seconds. If an agent's session is dead and the engine thinks it's `running`, emits `signal.session_lost`.
2. **Detects expired heartbeats** — checks heartbeat file timestamps. If an agent hasn't heartbeated in 2 minutes, emits `signal.heartbeat_expired`.
3. **Sends notifications** — macOS/Linux desktop notifications when problems are detected or agents submit.
4. **Nothing else.**

### What the supervisor does NOT do

- Never kills tmux sessions
- Never restarts agents
- Never moves spec files
- Never writes agent status files
- Never makes decisions — it observes and reports via signals. The engine's XState machine decides validity.

### How the supervisor mutates state

One way only: `engine.emitSignal()` — append-only events in `events.jsonl`. Two signal types:
- `signal.session_lost`
- `signal.heartbeat_expired`

Engine guards (feature 168) prevent duplicates and signals to terminal states.

## Acceptance Criteria

- [ ] `aigon dashboard start` launches one process containing both HTTP and supervisor modules
- [ ] `aigon dashboard stop` stops both cleanly
- [ ] `aigon dashboard status` shows: running/stopped, uptime, last supervisor sweep time
- [ ] Supervisor polls tmux sessions every 30 seconds
- [ ] Supervisor checks heartbeat timestamps every 30 seconds
- [ ] Dead session detected → `signal.session_lost` emitted, notification sent
- [ ] Expired heartbeat detected → `signal.heartbeat_expired` emitted, notification sent
- [ ] Supervisor never kills a tmux session
- [ ] Supervisor never restarts an agent
- [ ] Supervisor never moves files
- [ ] Supervisor is idempotent — two sweeps with no state change produce no new events
- [ ] Process auto-restarts on crash (launchd plist on macOS, systemd unit on Linux)
- [ ] All orphan classification/killing logic removed from dashboard-server.js
- [ ] All notification logic moved from dashboard polling to supervisor module
- [ ] HTTP module and supervisor module have zero imports of each other

## Validation

```bash
node --check lib/dashboard-server.js
node --check lib/supervisor.js
npm test
```

## Technical Approach

### Step 1: Create `lib/supervisor.js`

Under 300 lines. Single exported function `startSupervisorLoop()` that runs on a 30-second interval.

```js
function startSupervisorLoop(config) {
  setInterval(() => sweep(config), 30000);
}

function sweep(config) {
  for (const repo of config.repos) {
    const snapshots = readAllFeatureSnapshots(repo);
    for (const snap of snapshots) {
      for (const agent of snap.agents) {
        if (agent.status !== 'running') continue;
        if (!tmuxSessionExists(agent.sessionName)) {
          engine.emitSignal(repo, snap.id, 'signal.session_lost', agent.id);
          notify(`Session lost: F${snap.id} ${agent.id}`);
        } else if (heartbeatExpired(agent)) {
          engine.emitSignal(repo, snap.id, 'signal.heartbeat_expired', agent.id);
          notify(`Heartbeat expired: F${snap.id} ${agent.id}`);
        }
      }
    }
  }
}
```

### Step 2: Integrate into dashboard process

In `lib/dashboard-server.js`, at startup:
```js
const { startSupervisorLoop } = require('./supervisor');
startSupervisorLoop(globalConfig);
```

That's the only integration point. One line.

### Step 3: Strip mutation logic from dashboard

Delete from `lib/dashboard-server.js`:
- `classifyOrphanReason()` — deleted
- `getEnrichedSessions()` orphan logic — deleted
- `/api/sessions/cleanup` endpoint — deleted
- All notification code from polling loop — moved to supervisor
- Any code that kills tmux sessions — deleted

### Step 4: Auto-restart via launchd/systemd

`aigon dashboard start --persistent`:
- macOS: writes `~/Library/LaunchAgents/com.aigon.dashboard.plist` with `KeepAlive: true`
- Linux: writes `~/.config/systemd/user/aigon-dashboard.service` with `Restart=on-failure`

## Dependencies

- depends_on: workflow-engine-full-cutover (feature 171)

## Out of Scope

- Auto-restart of dead agents (user decides via dashboard button → CLI)
- Research workflow supervision
- Projector/machine merge (separate follow-up)

## Related

- Feature 171 (full cutover) — prerequisite
- Feature 168 (signal guards) — prevents duplicate signals from supervisor
- Feature 167 (orchestrator sweep) — **superseded by this feature, cancel it**
- Feature dashboard-auto-restart — **superseded by this feature, cancel it**
