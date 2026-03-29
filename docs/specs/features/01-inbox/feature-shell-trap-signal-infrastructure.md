# Feature: shell-trap-signal-infrastructure

## Summary

Wrap all agent tmux sessions in a shell `trap EXIT` handler that emits lifecycle signals (`implementing` on start, `submitted`/`error` on exit) and runs a heartbeat file-touch sidecar. This is the universal signal foundation — it works identically across all agents (CC, GG, CX, MV, and any future agents) with zero agent-specific code required. Also introduces a signal capability registry in `templates/agents/*.json` so new agents automatically participate in the signal architecture.

## User Stories

- [ ] As a user, when an agent session exits normally, the engine automatically receives `signal.agent_ready` without the agent needing to explicitly call `agent-status submitted`
- [ ] As a user, when an agent session crashes, the engine receives `signal.agent_failed` via the shell trap — no silent hangs
- [ ] As a user, agent heartbeats are lightweight file touches, not engine event log entries — keeping the event log clean for meaningful lifecycle events
- [ ] As a user, when I add a new agent to Aigon (e.g., a new `templates/agents/xx.json`), it automatically gets shell trap signals and heartbeat with no additional wiring

## Acceptance Criteria

- [ ] `buildAgentCommand()` in `lib/worktree.js` wraps all agent commands in a bash shell with `trap _aigon_cleanup EXIT`
- [ ] The trap fires `aigon agent-status submitted` on exit code 0, `aigon agent-status error` on non-zero
- [ ] The trap fires `aigon agent-status implementing` on session start (before the agent command runs)
- [ ] A background heartbeat loop touches `.aigon/state/heartbeat-{featureId}-{agentId}` every 30 seconds
- [ ] The heartbeat sidecar exits when the agent process exits (tied to `$$` PID)
- [ ] Default heartbeat timeout changed from 90s to 120s (configurable via `.aigon/config.json` `heartbeat.timeoutMs`)
- [ ] Heartbeat interval configurable via `.aigon/config.json` `heartbeat.intervalMs` (default 30s)
- [ ] `templates/agents/*.json` gains a `signals` capability block declaring what each agent supports
- [ ] `lib/worktree.js` reads the agent's signal capabilities to decide what to wire (shell trap is always on; hooks are per-agent)
- [ ] Existing `agent-status` dual-write (manifest + engine signal) continues working — the shell trap calls the same command

## Validation

```bash
node --check lib/worktree.js
node --check lib/workflow-heartbeat.js
npm test
```

## Technical Approach

### Shell trap wrapper

Modify `buildAgentCommand()` to produce:
```bash
bash -lc "
  _aigon_cleanup() {
    code=$?
    if [ $code -eq 0 ]; then
      aigon agent-status submitted 2>/dev/null || true
    else
      aigon agent-status error 2>/dev/null || true
    fi
  }
  trap _aigon_cleanup EXIT
  aigon agent-status implementing
  # heartbeat sidecar
  (while kill -0 $$ 2>/dev/null; do
    touch .aigon/state/heartbeat-{featureId}-{agentId}
    sleep 30
  done) &
  <agent-command>
"
```

The trap fires on normal exit, Ctrl+C (SIGINT), and SIGTERM. It does NOT fire on SIGKILL or machine crash — the orchestrator sweep (feature 167) handles those.

### Heartbeat file touch

Replace the current engine-event heartbeat (`lib/workflow-heartbeat.js` emitting to `events.jsonl`) with a file touch:
- File: `.aigon/state/heartbeat-{featureId}-{agentId}`
- The orchestrator reads `mtime` to determine liveness
- Only `signal.heartbeat_expired` gets written to the engine event log (by the orchestrator sweep)
- For CC/GG: agent CLI hooks (`PostToolUse`/`AfterAgent`) can also touch the file for higher-frequency updates. This is an enhancement layer, not required.

### Agent signal capability registry

Extend `templates/agents/*.json` with a `signals` block:
```json
{
  "signals": {
    "shellTrap": true,
    "heartbeatSidecar": true,
    "cliHooks": {
      "heartbeatTouch": "PostToolUse",
      "exitEnforcement": "Stop"
    }
  }
}
```

For agents without hook support (MV, CX), `cliHooks` is `null` or omitted. `buildAgentCommand()` reads this to decide what to wire. New agents get shell trap + heartbeat sidecar automatically (the universal baseline). Agent-specific hooks are opt-in via the capability declaration.

### New agent pluggability

When someone adds a new agent (`templates/agents/xx.json`):
1. Shell trap + heartbeat sidecar work with zero config (universal)
2. If the agent CLI supports hooks, declare them in `signals.cliHooks`
3. `buildAgentCommand()` reads capabilities and wires accordingly
4. No code changes needed in `lib/worktree.js` for new agents — just config

## Dependencies

- depends_on: workflow-engine-agent-signals

## Out of Scope

- Agent-specific CLI hook implementation (CC Stop hook, GG AfterAgent) — see agent-recovery-and-enforcement
- Orchestrator sweep logic — see feature 167
- Compensating transactions — see agent-recovery-and-enforcement

## Open Questions

- Should the shell trap suppress `submitted` if the agent already called `feature-submit` explicitly? (Dedup in `emitSignal` may handle this — see engine-signal-guards)

## Related

- Research: #27 workflow-engine-signal-architecture
- Feature: 166 workflow-engine-agent-signals
- Feature: 167 workflow-engine-orchestrator-sweep
- `lib/worktree.js` — `buildAgentCommand()`, `createDetachedTmuxSession()`
- `lib/workflow-heartbeat.js` — current heartbeat implementation
- `templates/agents/*.json` — agent capability configs
