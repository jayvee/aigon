# Feature: aigon-supervisor

## Name

**Supervisor**. Not daemon, not orchestrator, not sweep. The Supervisor.

## What It Is

A separate background process that watches agent sessions and reports problems to the workflow engine. It runs alongside the dashboard but is not part of it. The dashboard is read-only. The supervisor is observe-and-signal-only.

## What It Does (exhaustive list)

1. **Detects dead sessions** — polls tmux session liveness every 30 seconds. If an agent's tmux session no longer exists and the engine still thinks it's `running`, emits `signal.session_lost`.

2. **Detects expired heartbeats** — checks heartbeat file timestamps. If an agent hasn't heartbeated in 2 minutes and the engine thinks it's `running`, emits `signal.heartbeat_expired`.

3. **Sends notifications** — when a problem is detected or an agent submits, sends macOS/Linux desktop notifications.

4. **Keeps itself alive** — auto-restarts on crash via launchd (macOS) or systemd (Linux).

That's it. Four responsibilities.

## What It Does NOT Do

- **Never kills tmux sessions** — only the user or `aigon sessions-close` kills sessions
- **Never restarts agents** — only the user can restart (via dashboard button or CLI)
- **Never moves spec files** — only CLI commands move specs
- **Never writes agent status files** — only agents write their own status
- **Never makes decisions** — it observes and reports to the engine via signals. The engine's XState machine decides what transitions are valid.
- **Never reads or writes manifests** — manifests are deleted in the cutover (feature 171)

## How It Mutates State

The supervisor writes exactly one type of thing: **engine signal events** via `engine.emitSignal()`. These are append-only events in `events.jsonl`. The engine's guards prevent invalid signals (dedup, terminal state checks from feature 168).

The signal types it can emit:
- `signal.session_lost` — tmux session for agent X is dead
- `signal.heartbeat_expired` — agent X hasn't heartbeated in >2 minutes

That's it. Two signal types. Both are observations, not decisions.

## Acceptance Criteria

- [ ] `aigon supervisor start` launches the supervisor as a background process
- [ ] `aigon supervisor stop` stops it cleanly
- [ ] `aigon supervisor status` shows: running/stopped, uptime, last sweep time, problems detected
- [ ] Supervisor polls tmux sessions every 30 seconds
- [ ] Supervisor checks heartbeat timestamps every 30 seconds
- [ ] When a dead session is detected: emits `signal.session_lost` to the engine, sends notification
- [ ] When an expired heartbeat is detected: emits `signal.heartbeat_expired` to the engine, sends notification
- [ ] Supervisor never kills a tmux session
- [ ] Supervisor never restarts an agent
- [ ] Supervisor never moves files
- [ ] Supervisor auto-restarts on crash (launchd plist on macOS, systemd unit on Linux)
- [ ] Supervisor is idempotent — running two sweeps with no state change produces no new events
- [ ] Dashboard does not contain any supervision logic — all moved to supervisor
- [ ] Orphan classification and killing logic removed from dashboard entirely

## Validation

```bash
node --check lib/supervisor.js
npm test
```

## Technical Approach

### One file: `lib/supervisor.js`

Not a module tree. Not a framework. One file, under 300 lines.

```
aigon supervisor start
  → spawns: node aigon-cli.js supervisor run (detached)
  → writes PID to ~/.aigon/supervisor.pid
  → registers launchd/systemd for auto-restart

aigon supervisor run (the actual loop)
  every 30 seconds:
    for each repo in config.repos:
      snapshots = readAllFeatureSnapshots(repo)
      for each snapshot where stage is active:
        for each agent:
          if agent.status == 'running':
            if !tmuxSessionExists(sessionName):
              engine.emitSignal(repo, id, 'signal.session_lost', agent)
              notify('Session lost: F{id} {agent}')
            elif heartbeatExpired(agent):
              engine.emitSignal(repo, id, 'signal.heartbeat_expired', agent)
              notify('Heartbeat expired: F{id} {agent}')

aigon supervisor stop
  → reads PID from ~/.aigon/supervisor.pid
  → sends SIGTERM
  → unloads launchd/systemd
```

### Dashboard cleanup

Remove from `lib/dashboard-server.js`:
- `classifyOrphanReason()` — deleted
- `getEnrichedSessions()` orphan classification — deleted
- `/api/sessions/cleanup` endpoint — deleted
- All notification logic that depends on polling — moved to supervisor
- Any code that kills tmux sessions based on state inference — deleted

### Relationship to other components

```
CLI commands ──────→ Engine (mutates state)
Supervisor ────────→ Engine (emits signals only)
Dashboard ─────────→ Engine snapshots (reads only)
Dashboard buttons ─→ CLI commands (user-initiated mutations)
```

## Dependencies

- depends_on: workflow-engine-full-cutover (feature 171 — must land first, cleans up legacy)

## Out of Scope

- Auto-restart of dead agents (user decides via dashboard button → CLI command)
- Auto-drop of failed agents (user decides)
- Research workflow supervision (features only for now)
- Remote/distributed supervision

## Related

- Feature 171 (full cutover) — prerequisite, removes legacy state
- Feature 168 (signal guards) — engine dedup prevents supervisor from creating duplicate signals
- Feature 167 (orchestrator sweep) — superseded by this feature. 167 should be closed/cancelled.
- Feature dashboard-auto-restart — the supervisor replaces this need (supervisor manages its own lifecycle via launchd/systemd)
