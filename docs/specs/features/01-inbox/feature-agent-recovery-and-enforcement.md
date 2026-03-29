# Feature: agent-recovery-and-enforcement

## Summary

Implement compensating transactions (auto-restart, drop, force-ready) with a clear automation policy, plus agent-specific CLI hook enforcement for CC and GG. Auto-restart is the default recovery for lost/failed agents (max 2 retries). Drop-agent and force-ready require human approval via the dashboard. CC's `Stop` hook and GG's `AfterAgent` hook add enforcement layers that block session end until signals are emitted.

## User Stories

- [ ] As a user, when an agent session crashes, the orchestrator automatically restarts it (up to 2 times) without my intervention
- [ ] As a user, after 2 failed restarts, the dashboard shows "needs attention" and I can choose to drop the agent or force-ready
- [ ] As a user, the CC agent cannot exit without calling `agent-status submitted` — the `Stop` hook blocks premature exit
- [ ] As a user, I can configure auto-restart behavior (on/off, max retries) in `.aigon/config.json`

## Acceptance Criteria

### Compensating transactions
- [ ] Orchestrator calls `engine.restartAgent()` automatically when an agent is `lost` or `failed` and retry count < max (default 2)
- [ ] After max retries, the agent enters `needs-attention` state — no further auto-recovery
- [ ] Dashboard exposes "Drop Agent" action, gated by XState `agentDroppable` guard
- [ ] Dashboard exposes "Force Ready" action, gated by manual-only policy (no auto trigger)
- [ ] All recovery actions are logged as events in the feature's event log
- [ ] Auto-restart is configurable via `.aigon/config.json` `recovery.autoRestart` (default: true) and `recovery.maxRetries` (default: 2)

### CC Stop hook enforcement
- [ ] CC's `Stop` hook checks if `agent-status submitted` has been called in the current session
- [ ] If not called, the hook blocks exit with a message: "You haven't submitted your work. Run `aigon agent-status submitted` first."
- [ ] Hook is configured in `templates/agents/cc.json` under `extras.settings.hooks.Stop`

### GG AfterAgent enforcement
- [ ] GG's `AfterAgent` hook checks for lifecycle signal compliance
- [ ] Advisory warning (not blocking) if agent hasn't signaled
- [ ] Hook is configured in `templates/agents/gg.json` under `extras.settings.hooks`

## Validation

```bash
node --check lib/dashboard-server.js
node --check lib/workflow-core/engine.js
npm test
```

## Technical Approach

### Auto-restart flow

```
orchestrator sweep detects agent.status == 'lost' || 'failed'
  → check snapshot.agents[id].restartCount < config.recovery.maxRetries
  → if yes: engine.restartAgent(featureId, agentId)
    → XState transitions agent to 'restarting'
    → effect: re-launch tmux session via worktree.js
    → on success: agent status → 'running'
    → on failure: increment restartCount, retry or escalate
  → if no: transition to 'needs-attention'
    → dashboard shows notification + manual actions
```

### Approval policy matrix

| Action | Trigger | Automation | Dashboard UI |
|--------|---------|------------|-------------|
| Restart agent | `session_lost` / `agent_failed` | Automatic (max 2 retries) | "Restarting..." status |
| Drop agent | Manual decision | Requires approval | "Drop Agent" button (gated by `agentDroppable`) |
| Force ready | Manual override | Never automatic | "Force Ready" button (always manual) |
| Revert spec move | Effect failure | Automatic (effect lifecycle) | Logged in events |

### CC Stop hook

Add to `templates/agents/cc.json`:
```json
"Stop": [{
  "matcher": ".*",
  "hooks": [{
    "type": "command",
    "command": "aigon check-agent-submitted",
    "timeout": 5
  }]
}]
```

`aigon check-agent-submitted` reads the agent's status file and returns non-zero if not submitted, which blocks the session exit.

### GG AfterAgent hook

Advisory hook — logs a warning but doesn't block. GG's hook system is less mature than CC's, so blocking could cause issues.

## Dependencies

- depends_on: shell-trap-signal-infrastructure
- depends_on: engine-signal-guards

## Out of Scope

- CX/MV hook enforcement (these agents lack robust hook systems — shell trap is their coverage)
- Remote/distributed recovery
- Cross-feature dependency-aware recovery

## Open Questions

- Should auto-restart re-use the same worktree or create a new one?
- Should the restart preserve the agent's log file or start fresh?

## Related

- Research: #27 workflow-engine-signal-architecture
- Feature: 167 workflow-engine-orchestrator-sweep
- `lib/workflow-core/machine.js` — `agentRecoverable`, `agentDroppable` guards
- `lib/workflow-core/engine.js` — `restartAgent()`, `dropAgent()`, `forceAgentReady()`
- `templates/agents/cc.json` — CC hook config
- `templates/agents/gg.json` — GG hook config
