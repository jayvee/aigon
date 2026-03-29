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

```
for each engine-managed feature:
  snapshot = readFeatureSnapshot(id)
  for each agent in snapshot.agents:
    tmuxAlive = tmuxSessionExists(sessionName)
    heartbeatAge = now - agent.lastHeartbeat

    if !tmuxAlive && agent.status == 'running':
      engine.emitSignal(id, 'signal.session_lost', { agent })

    if heartbeatAge > HEARTBEAT_TIMEOUT && agent.status == 'running':
      engine.emitSignal(id, 'signal.heartbeat_expired', { agent })

    if autoRecover && agent.status == 'lost' && snapshot.can('restart_agent'):
      engine.restartAgent(id, agent)
```

### Integration with dashboard

The sweep runs inside the dashboard's existing polling loop (already runs every 5s for status collection). The sweep is a new function called after `collectDashboardStatusData()`. Recovery actions are exposed as dashboard actions in the action menu, gated by `snapshot.can()`.

### Compensating transactions

When `signal.agent_failed` is received, the engine transitions the agent to `failed` state. Any effects that were `claimed` by that agent can be detected as stale (claim expired) and reclaimed by a fresh agent session. This is already built into the effect lifecycle — this feature just wires it up end-to-end.

## Dependencies

- depends_on: workflow-engine-agent-signals

## Out of Scope

- Research workflow orchestration
- Cross-feature orchestration (e.g., dependency graphs between features)
- Remote/distributed orchestration (single-machine only for now)
- Removing the legacy system (phase 6, separate feature)

## Open Questions

- Should auto-recovery be on by default, or opt-in?
- What notification should fire when the orchestrator detects and recovers from a problem?
- Should the sweep run as part of the dashboard process, or as a separate `aigon orchestrate` command?

## Related

- `~/src/aigon-next/` — orchestrator-sweep prototype
- `lib/workflow-core/engine.js` — `restartAgent()`, `dropAgent()`, `forceAgentReady()`
- `lib/workflow-core/effects.js` — claim expiry and reclaim mechanism
- `lib/workflow-core/machine.js` — recovery guards (`agentRecoverable`, `agentDroppable`)
