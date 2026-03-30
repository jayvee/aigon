# Feature: engine-signal-guards

## Summary

Add deduplication and terminal-state guards to `emitSignal()` in the workflow engine. Currently, duplicate signals (e.g., shell trap and explicit `feature-submit` both firing `agent-ready`) produce redundant events, and signals can arrive for features that are already closed. This feature makes the engine robust to these edge cases by checking projected state before appending events.

## User Stories

- [ ] As a user, when an agent submits AND the shell trap also fires, I see one `agent-ready` event in the log, not two
- [ ] As a user, when a feature is closed, stale heartbeat or late-arriving signals don't pollute the event log
- [ ] As a user, the Events tab in the dashboard shows only meaningful lifecycle events, not duplicates

## Acceptance Criteria

- [ ] `emitSignal()` checks the current projected agent status before appending — skips if agent is already in the target state (e.g., `agent-ready` when agent is already `ready`)
- [ ] `emitSignal()` checks the feature's workflow state — silently discards signals when the feature is in a terminal state (`closed`, `merged`, `abandoned`)
- [ ] The dedup is state-based, not time-based — two `agent-ready` signals separated by a `restart` are both valid
- [ ] File lock is still acquired before the state check to prevent TOCTOU races
- [ ] Unit tests cover: duplicate agent-ready, signal after close, signal after restart (should not be deduped)

## Validation

```bash
node --check lib/workflow-core/engine.js
npm test
```

## Technical Approach

### State-based dedup in `emitSignal()`

```javascript
async function emitSignal(repoPath, featureId, signal, agentId) {
  // Acquire file lock first (existing)
  const snapshot = await showFeature(repoPath, featureId);

  // Terminal state guard
  if (['closed', 'merged', 'abandoned'].includes(snapshot.state)) return;

  // Agent state dedup
  const agent = snapshot?.agents?.[agentId];
  if (signal === 'agent-ready' && agent?.status === 'ready') return;
  if (signal === 'heartbeat-expired' && agent?.status === 'lost') return;
  if (signal === 'session-lost' && agent?.status === 'lost') return;
  if (signal === 'agent-failed' && agent?.status === 'failed') return;

  // ... proceed with event append
}
```

This is not a mutex concern (file lock already prevents concurrent writes) — it's a "don't emit if already in target state" optimization. The check happens inside the lock to prevent TOCTOU.

### Why state-based, not event-based

A simple "has this signal been emitted before?" check would break restart flows: agent fails → restart → agent-ready should emit a NEW agent-ready event. The state-based check handles this correctly because after restart, the agent status is `running`, not `ready`.

## Dependencies

- depends_on: workflow-engine-agent-signals

## Out of Scope

- Changing the event log format
- Adding event compaction or log rotation

## Open Questions

- Should discarded signals be logged somewhere (debug log) for troubleshooting?

## Related

- Research: #27 workflow-engine-signal-architecture
- `lib/workflow-core/engine.js` — `emitSignal()`
- `lib/workflow-core/projector.js` — signal event projection
- `lib/workflow-core/machine.js` — terminal states
