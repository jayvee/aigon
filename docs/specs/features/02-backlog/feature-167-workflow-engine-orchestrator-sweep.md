# Feature: workflow-engine-orchestrator-sweep

## Summary

Implement the orchestrator sweep — a periodic process (run by the dashboard or a cron-like mechanism) that observes the state of all engine-managed features and injects corrective signals when problems are detected. The orchestrator is side-effect-free in itself: it reads snapshots and tmux state, then injects signals into the engine. The engine's XState machine decides what to do. This is the payoff feature — it enables automatic detection and recovery from hung agents, lost sessions, and stuck workflows.

## User Stories

- [ ] As a user, when an agent's tmux session dies unexpectedly, the orchestrator detects it within 60 seconds and the dashboard shows the agent as "lost"
- [ ] As a user, when an agent hasn't heartbeated in 2 minutes, the orchestrator marks it as expired and I get a notification
- [ ] As a user, I can see recovery actions in the dashboard: "Restart agent", "Drop agent", "Force ready" — all enforced by XState guards
- [ ] As a user, I can enable auto-recovery where the orchestrator automatically restarts lost agents (configurable)

## Acceptance Criteria

- [ ] Orchestrator sweep runs periodically (configurable interval, default 30s) from the dashboard process
- [ ] Sweep reads all engine snapshots, checks tmux session state, compares heartbeat timestamps
- [ ] For each detected problem, sweep injects the appropriate signal: `signal.session_lost`, `signal.heartbeat_expired`
- [ ] Dashboard exposes recovery actions derived from XState `snapshot.can()`: restart, drop, force-ready
- [ ] Recovery actions call engine methods: `engine.restartAgent()`, `engine.dropAgent()`, `engine.forceAgentReady()`
- [ ] Auto-recovery mode (optional): orchestrator automatically calls `restartAgent()` for lost sessions
- [ ] Compensating transactions: when an agent fails mid-work, the engine can mark its effects as failed and allow retry
- [ ] Sweep is idempotent — running it twice with no state change produces no new events
- [ ] All sweep actions are logged as events in the feature's event log

## Validation

```bash
node --check lib/dashboard-server.js
npm test
```

## Technical Approach

### Sweep loop (observation -> signal injection)

The sweep is the **authoritative detector** for session loss and heartbeat expiry (research-27 consensus). Agents provide signals via shell traps and CLI commands, but the sweep is the safety net that catches everything traps miss (SIGKILL, machine crash, tmux server death).

```
for each engine-managed feature:
  snapshot = readFeatureSnapshot(id)

  // Skip terminal-state features (engine-signal-guards handles this in emitSignal too)
  if snapshot.state in ['closed', 'merged', 'abandoned']: continue

  for each agent in snapshot.agents:
    tmuxAlive = tmuxSessionExists(sessionName)
    heartbeatFile = `.aigon/state/heartbeat-{featureId}-{agentId}`
    heartbeatAge = now - mtime(heartbeatFile)  // file touch, NOT engine event

    // Session loss: tmux gone + agent still running
    if !tmuxAlive && agent.status in ['running', 'implementing']:
      engine.emitSignal(id, 'signal.session_lost', { agent })
      // emitSignal dedup (engine-signal-guards) prevents duplicate events

    // Heartbeat expiry: file not touched within timeout
    if heartbeatAge > HEARTBEAT_TIMEOUT && agent.status in ['running', 'implementing']:
      engine.emitSignal(id, 'signal.heartbeat_expired', { agent })

    // Auto-recovery (delegated to agent-recovery-and-enforcement feature)
    if autoRecover && agent.status == 'lost' && agent.restartCount < maxRetries:
      if snapshot.can('restart_agent'):
        engine.restartAgent(id, agent)
```

**Key design decisions from research-27:**
- **Heartbeat source**: File `mtime` check, NOT engine event log query. Heartbeat file touches are cheap I/O; engine events are reserved for meaningful lifecycle transitions. This prevents 720+ noise events per 2-hour Fleet session.
- **Heartbeat timeout**: 120s default (4x the 30s interval). 90s creates false positives during long builds/test runs that block agent hooks for 60+ seconds.
- **tmux hooks NOT used**: Research-27 documented 5 tmux hook failure modes (tmux#1245, #3736, #2483, #1174, plus environment issues). Shell `trap EXIT` (from shell-trap-signal-infrastructure) is strictly more reliable. The sweep handles the remaining gap.
- **Signal dedup**: `emitSignal()` guards (engine-signal-guards) prevent duplicate events when both the shell trap and the sweep detect the same condition.

### Integration with dashboard

The sweep runs inside the dashboard's existing polling loop (already runs every 10s at `lib/dashboard-server.js:3607`). The sweep is a new function called after `collectDashboardStatusData()`. Recovery actions are exposed as dashboard actions in the action menu, gated by `snapshot.can()`.

**Data source selection** (research-27 consensus):
- If `.aigon/workflows/features/{id}/snapshot.json` exists → read from engine snapshot
- Else → read from legacy manifests
- Never mix both sources for the same feature

### Compensating transactions

Compensating transactions are split between this feature (detection) and agent-recovery-and-enforcement (response):
- **This feature**: detects problems, injects signals, exposes recovery actions in dashboard
- **agent-recovery-and-enforcement**: auto-restart policy, approval flows, retry limits

When `signal.agent_failed` is received, the engine transitions the agent to `failed` state. Any effects that were `claimed` by that agent can be detected as stale (claim expired) and reclaimed by a fresh agent session. This is already built into the effect lifecycle — this feature just wires it up end-to-end.

### New agent compatibility

The sweep is agent-agnostic by design. It observes tmux sessions and heartbeat files — both mechanisms work identically for any agent. When a new agent is added to Aigon (`templates/agents/xx.json`), the sweep works automatically because:
1. Shell trap wrapper (from shell-trap-signal-infrastructure) produces heartbeat files for all agents
2. Sweep reads file mtime — doesn't care which agent produced it
3. tmux session naming convention is consistent across agents

No sweep code changes are needed when adding new agents.

## Dependencies

- depends_on: shell-trap-signal-infrastructure
- depends_on: engine-signal-guards

## Out of Scope

- Research workflow orchestration
- Cross-feature orchestration (e.g., dependency graphs between features)
- Remote/distributed orchestration (single-machine only for now)
- Removing the legacy system (phase 6, separate feature)
- Auto-restart policy and retry limits (see agent-recovery-and-enforcement)

## Open Questions

- ~~Should auto-recovery be on by default, or opt-in?~~ **Resolved**: On by default, max 2 retries (research-27)
- What notification should fire when the orchestrator detects and recovers from a problem?
- ~~Should the sweep run as part of the dashboard process, or as a separate `aigon orchestrate` command?~~ **Resolved**: Part of the dashboard polling loop (research-27)

## Related

- Research: #27 workflow-engine-signal-architecture
- Feature: shell-trap-signal-infrastructure (produces heartbeat files the sweep reads)
- Feature: engine-signal-guards (dedup prevents sweep from creating duplicate events)
- Feature: agent-recovery-and-enforcement (auto-restart and approval policy)
- `~/src/aigon-next/` — orchestrator-sweep prototype
- `lib/workflow-core/engine.js` — `restartAgent()`, `dropAgent()`, `forceAgentReady()`
- `lib/workflow-core/effects.js` — claim expiry and reclaim mechanism
- `lib/workflow-core/machine.js` — recovery guards (`agentRecoverable`, `agentDroppable`)
