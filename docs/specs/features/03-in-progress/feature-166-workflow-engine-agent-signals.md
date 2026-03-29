# Feature: workflow-engine-agent-signals

## Summary

Wire agent lifecycle events (submit, error, heartbeat, session loss) into the workflow-core engine as first-class signals. Currently, agents write status to `.aigon/state/feature-{id}-{agent}.json` files and the dashboard polls them. With engine signals, these become immutable events (`signal.agent_ready`, `signal.agent_failed`, `signal.session_lost`, `signal.heartbeat_expired`) that the XState machine can react to — enabling automatic guard enforcement, compensating transactions, and crash recovery. This is the phase that makes the workflow truly robust.

## User Stories

- [ ] As a user, when an agent submits (`feature-submit`), the engine records `signal.agent_ready` and the XState machine knows this agent is done
- [ ] As a user, when an agent session crashes, the engine records `signal.session_lost` and the dashboard immediately reflects it — no polling delay
- [ ] As a user, I can see the complete agent lifecycle in the Events tab: started -> heartbeat -> ready (or failed/lost)
- [ ] As a user, when all agents are ready, the dashboard's "Run Eval" button appears instantly because the XState guard `allAgentsReady` evaluates from engine state

## Acceptance Criteria

- [ ] `feature-submit` emits `signal.agent_ready` into the engine when engine state exists
- [ ] Agent error paths emit `signal.agent_failed` into the engine
- [ ] `sessions-close` emits `signal.session_lost` for terminated sessions
- [ ] Dashboard reads agent status from engine snapshots instead of polling status files (for engine features)
- [ ] XState guards (`allAgentsReady`, `agentRecoverable`, `agentDroppable`) work correctly with signal-derived state
- [ ] `feature-eval` guard enforcement uses engine signals — eval is blocked until all `signal.agent_ready` events exist
- [ ] Agent heartbeat mechanism: periodic `signal.heartbeat` events with configurable timeout for `heartbeat_expired` detection
- [ ] Legacy agent status files continue to be written for backward compat

## Validation

```bash
node --check lib/commands/feature.js
npm test
```

## Technical Approach

### Signal injection points

| Event | Where injected | Engine signal |
|---|---|---|
| Agent submits code | `feature-submit` command | `signal.agent_ready` |
| Agent hits error | Agent error handler / validation failure | `signal.agent_failed` |
| Tmux session dies | `sessions-close` / dashboard polling | `signal.session_lost` |
| Agent is alive | Periodic from agent session | `signal.heartbeat` |
| Heartbeat timeout | Orchestrator sweep (phase 5) | `signal.heartbeat_expired` |

### Agent status derivation

Instead of reading `.aigon/state/feature-{id}-{agent}.json`, the dashboard derives agent status from the latest signal per agent in the event log. The snapshot already contains this — `workflow-snapshot-adapter.js` needs to be updated to expose per-agent signal state.

### Heartbeat mechanism

Agents periodically touch a heartbeat file or emit a signal. The orchestrator (phase 5) detects expired heartbeats and injects `signal.heartbeat_expired`. This replaces the current tmux-polling approach with a durable, event-sourced mechanism.

## Dependencies

- depends_on: workflow-engine-migrate-feature-start
- depends_on: workflow-engine-migrate-feature-eval
- depends_on: workflow-engine-migrate-pause-resume

## Out of Scope

- Automatic remediation of failed agents (that's orchestrator sweep, phase 5)
- Research agent signals
- Changing how agents actually run (tmux, worktrees)

## Open Questions

- What's the right heartbeat interval? (30s suggested in aigon-next)
- Should heartbeat be a file touch (simple) or an engine event (complete but more I/O)?
- How to handle the transition period where some features have signals and others don't?

## Related

- `lib/workflow-core/engine.js` — `emitSignal()`, `signalAgentReady()`
- `lib/workflow-core/machine.js` — agent signal event handling, guards
- `~/src/aigon-next/docs/integration-into-aigon.md` — signal injection design
- `lib/manifest.js` — `writeAgentStatusAt()` (legacy, to be kept for compat)
