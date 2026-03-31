# Feature: Fix Supervisor Heartbeat Bridge — Emit Signals from File Liveness

## Summary

The heartbeat sidecar touches `.aigon/state/heartbeat-{id}-{agent}` every 30 seconds. The supervisor runs every 30 seconds. But the supervisor reads `agent.lastHeartbeatAt` from the engine snapshot instead of the heartbeat **file** mtime. Once the engine marks an agent as `lost` (after 2 minutes), the supervisor never corrects it because the snapshot says expired and nobody reads the file. Result: every agent goes permanently `lost` within 2 minutes despite being alive and actively coding. This has required manual `emitSignal('agent-started')` calls on every feature today.

## User Stories

- [ ] As a user, I want agents that are running to show as "Running" on the dashboard without manual intervention
- [ ] As a user, I want an agent that actually dies to be marked as lost, but one that's alive to stay running

## Acceptance Criteria

- [ ] Supervisor reads heartbeat **file mtime** (`.aigon/state/heartbeat-{id}-{agent}`), not `snapshot.agents[id].lastHeartbeatAt`
- [ ] Supervisor also checks **tmux session alive** via `tmux has-session`
- [ ] If file is fresh OR tmux is alive: emit `signal.heartbeat` to engine (keeps agent `running`)
- [ ] If file is stale AND tmux is dead: emit `signal.heartbeat_expired` (marks agent `lost`)
- [ ] If agent is already `lost` in engine but file/tmux shows alive: emit `signal.agent_started` to revive
- [ ] Engine deduplication (`isSignalRedundant`) prevents flooding the event log with identical heartbeats
- [ ] Dashboard events tab filters out `signal.heartbeat` events (only show `heartbeat_expired` and lifecycle events)
- [ ] `node -c lib/supervisor.js` passes

## Validation

```bash
node -c lib/supervisor.js
node -c lib/dashboard-server.js

# Supervisor must read heartbeat files, not just snapshot timestamps
grep -q 'statSync\|mtimeMs\|heartbeat.*file' lib/supervisor.js || { echo "FAIL: supervisor must read heartbeat file mtime"; exit 1; }

# Supervisor must emit signals (not just log)
grep -q 'emitSignal' lib/supervisor.js || { echo "FAIL: supervisor must emit engine signals"; exit 1; }

# Supervisor must revive lost agents when alive
grep -q 'agent.started\|agent-started' lib/supervisor.js || { echo "FAIL: supervisor must revive lost agents"; exit 1; }
```

## Technical Approach

The supervisor's `sweepEntity()` function currently checks `agent.lastHeartbeatAt` from the snapshot. Change it to:

```js
// Read heartbeat FILE, not snapshot timestamp
const hbFile = path.join(stateDir, `heartbeat-${entityId}-${agentId}`);
let fileFresh = false;
try {
    const stat = fs.statSync(hbFile);
    fileFresh = (Date.now() - stat.mtimeMs) < heartbeatTimeoutMs;
} catch (_) {}

const tmuxAlive = tmuxSessionAlive(sessionName);
const isAlive = fileFresh || tmuxAlive;

if (isAlive && (agent.status === 'lost' || agent.status === 'needs_attention')) {
    // Revive — agent is alive but engine thinks it's dead
    await emitSignal(repoPath, entityId, 'agent-started', agentId);
} else if (isAlive) {
    // Keep alive — emit heartbeat (engine dedupes)
    await emitSignal(repoPath, entityId, 'heartbeat', agentId);
} else if (!isAlive && agent.status === 'running') {
    // Actually dead — mark as lost
    await emitSignal(repoPath, entityId, 'heartbeat-expired', agentId);
}
```

For the dashboard event filtering: in the events tab rendering, skip events where `type === 'signal.heartbeat'`.

### Key files:
- `lib/supervisor.js` — fix `sweepEntity()` to read file mtime and emit signals
- `templates/dashboard/js/spec-drawer.js` or equivalent — filter heartbeat from events tab

## Dependencies

- None

## Out of Scope

- Changing the heartbeat sidecar mechanism (file touching is fine)
- Changing the engine's signal handling (dedup already works)
- Display-only liveness indicators (that was 187's approach — this replaces it with actual signals)

## Related

- Feature 184: Engine-Driven Actions (had a supervisor fix that got overwritten)
- Feature 187: Heartbeat/Liveness (went display-only, didn't fix the bridge)
