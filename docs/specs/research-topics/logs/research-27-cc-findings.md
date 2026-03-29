# Research Findings: workflow engine signal architecture

**Agent:** Claude (cc)
**Research ID:** 27
**Date:** 2026-03-30

---

## Key Findings

### 1. Signal Injection Mechanisms

#### `signal.agent_ready` — CLI command, not trap

**Recommendation: Injected by `feature-submit` (the CLI command the agent runs).**

The GG agent also recommends this. The current `agent-status` command already implements dual-write (legacy manifest + engine signal) — see `lib/commands/misc.js:99-131`. The signal path works: `agent-status submitted` → `signalMap['submitted']` → `emitSignal(..., 'agent-ready', agentId)`.

Alternatives evaluated:
- **Shell exit trap (`trap "aigon agent-status submitted" EXIT`)**: Research-26 recommended this as Layer 1 with ~90% coverage. However, there's a semantic problem: the trap fires on *any* exit, including error exits and user-initiated kills. A smarter trap (`code=$?; if [ $code -eq 0 ]; then submitted; else error; fi`) helps but still can't distinguish "agent finished work and forgot to signal" from "agent crashed mid-implementation." The trap is better suited as a *safety net* for `implementing` signals (see heartbeat section) rather than as the primary `agent_ready` source.
- **Orchestrator observing status files**: Too slow (10s poll) and adds polling complexity. The engine should be event-driven where possible.

**Verdict**: `feature-submit` is the right primary injection point. It's semantically accurate (the agent explicitly declares readiness), already implemented, and includes a security gate. Shell traps and polling serve as fallback layers, not primary sources.

#### `signal.session_lost` — Shell trap + orchestrator sweep, NOT tmux hooks

**Recommendation: Shell trap as primary, orchestrator sweep as fallback. Do NOT use tmux `session-closed` hooks.**

The GG agent recommends tmux `session-closed` hooks as primary. I strongly disagree based on research-26's findings, which documented **5 failure modes** for tmux hooks:

1. **Last-session-on-server**: When the closing session is the last one, `session-closed` hooks fail because the tmux server is shutting down (tmux#1245)
2. **Per-pane hook destruction race**: Pane options are freed before the hook callback fires (tmux#3736)
3. **Simultaneous pane death**: Multiple agent sessions dying concurrently cause missed events (tmux#2483)
4. **Signal-based termination**: SIGHUP/SIGTERM don't always trigger hooks (tmux#1174, partially fixed in 2.6+)
5. **Environment context**: `run-shell` executes in a limited environment with potentially wrong PATH/cwd

These aren't theoretical — they're documented tmux issues with open bug reports. A signal mechanism that silently fails in 5+ scenarios is worse than no mechanism, because it creates false confidence.

**Better approach — shell `trap EXIT`**:
```bash
tmux new-session -d -s name 'bash -lc "
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
  <agent-command>
"'
```

Shell traps fire on normal exit, Ctrl+C (SIGINT), and SIGTERM. They don't fire on SIGKILL or machine crash — but neither do tmux hooks. The shell trap has strictly better reliability than tmux hooks for the same failure modes.

**Fallback — orchestrator sweep** (see Heartbeat section):
The dashboard already polls every 10 seconds (`lib/dashboard-server.js:3607`). Adding a "stale implementing" detector catches the remaining cases where both the trap and the session died without signaling:
- If tmux session is gone AND agent status is still `running`/`implementing` AND `lastHeartbeatAt` is stale → emit `signal.session_lost`

#### `signal.heartbeat` — File touch, NOT engine events

**Recommendation: Agent touches a sentinel file periodically; orchestrator detects staleness.**

The current implementation in `lib/workflow-heartbeat.js` emits heartbeat as an engine event via `wf.emitSignal(repoPath, featureId, 'heartbeat', agentId)`. This works but has a cost: every 30 seconds, it appends a JSONL line to `events.jsonl`, acquires a file lock, and rebuilds the snapshot. For a 3-agent Fleet over a 2-hour session, that's ~720 events just for heartbeats — drowning out the ~20 semantically meaningful lifecycle events.

**Better approach — file touch**:
```
.aigon/state/heartbeat-{featureId}-{agentId}
```
The agent (or its shell wrapper) touches this file every 30 seconds. The orchestrator sweep checks `mtime` instead of reading engine events. Only when a heartbeat expires does the orchestrator emit `signal.heartbeat_expired` into the engine — this is the only heartbeat-related engine event.

**How to implement the touch**:
- For CC/GG: Use a `PostToolUse` hook that touches the file on every tool call. Tool calls are frequent enough (~every few seconds) that explicit periodic touching isn't needed.
- For CX/MV: Use a background loop in the shell wrapper:
  ```bash
  (while kill -0 $$ 2>/dev/null; do touch .aigon/state/heartbeat-*; sleep 30; done) &
  ```
- Fallback: The `implementing` signal from `agent-status` also updates `lastHeartbeatAt` — so the initial heartbeat is always set.

**Interval and timeout**: The current defaults (30s interval, 90s timeout) are reasonable. The GG agent recommends 30s/120s. I recommend **30s/120s** — 90s is too tight, since some tool calls (builds, tests) can block an agent for 60+ seconds without any hook firing. 120s (4x interval) provides adequate margin.

### 2. Cross-Agent Compatibility

| Agent | Shell Trap | CLI Hooks (Heartbeat) | CLI Hooks (Enforcement) | Net Coverage |
|-------|-----------|----------------------|------------------------|--------------|
| **CC** | Yes — `trap EXIT` in bash wrapper | `PostToolUse` → file touch | `Stop` hook → block if no `submitted` | ~99% |
| **GG** | Yes — `trap EXIT` in bash wrapper | `AfterAgent` → file touch (on every response) | `AfterAgent` → reject if no signal | ~99% |
| **CX** | Yes — `trap EXIT` in bash wrapper | `PostToolUse` (if `codex_hooks` flag enabled) | `Stop` is non-blocking (advisory only) | ~92% |
| **MV** | Yes — `trap EXIT` in bash wrapper | Background `while` loop in shell | None — prompt-only | ~90% |

**Key insight from research-26**: Shell trap is the **only mechanism that works identically across all agents** because it's agent-agnostic. Agent CLI hooks add reliability where available but cannot be relied upon as the sole mechanism.

### 3. Transition Period

#### Legacy submissions → engine signals

**Recommendation: Dual-write, already implemented.**

The current `agent-status` command (`lib/commands/misc.js:99-131`) already dual-writes:
1. Legacy manifest: `writeAgentStatus(id, agent, { status })`
2. Engine signal: `wf.emitSignal(repoPath, featureId, signalMap[status], agentId)` (only if engine snapshot exists)

This means features started with the new engine (`workflow.startEngine=true`) get engine signals automatically. Features on legacy mode only get manifest writes. No additional transition logic needed.

#### Dashboard data source

**Recommendation: if/else per feature, based on engine state existence.**

The `workflow-snapshot-adapter.js` already maps engine state to dashboard format. The dashboard should:
- If `.aigon/workflows/features/{id}/snapshot.json` exists → read from engine
- Else → read from legacy manifests

This is cleaner than trying to merge both sources. GG agrees with this approach.

#### Synthesize signals for legacy features entering eval

`workflow-eval.js` already handles this with `synthesizeAgentReadySignals()` — it reads legacy `.aigon/state/feature-{id}-{agent}.json` files and emits `signal.agent_ready` into the engine if the legacy status is `submitted`. This bridge works well and should remain until all features are started via the engine.

### 4. Reliability & Edge Cases

#### Orchestrator crash recovery

The event log (`events.jsonl`) is append-only and durable. Signals emitted by agents (via `agent-status submitted`) write directly to the log, regardless of whether the orchestrator is running. When the orchestrator restarts:
1. It replays `events.jsonl` to rebuild the snapshot
2. Runs `sweepExpiredHeartbeats()` to catch any agents that died during the outage
3. Resumes normal polling

**No signals are lost.** The file-based architecture means the orchestrator is stateless — it can crash and restart without data loss.

#### Duplicate signal idempotency

**Current state: NOT idempotent.** Each `emitSignal()` call appends a new event to `events.jsonl`. Two `agent-ready` signals for the same agent produce two events.

**Is this a problem?** Mostly no. The projector handles duplicate `signal.agent_ready` by overwriting the same agent status (`status: 'ready'`) — the result is identical. The `allAgentsReady` guard checks the final projected state, not event count.

**Where it could be a problem**: If the orchestrator sweep and the agent's own `agent-status submitted` both fire within the same second, you get two `agent-ready` events. This is benign for correctness but clutters the event log.

**Recommendation**: Add a lightweight dedup check in `emitSignal()`:
```javascript
async function emitSignal(repoPath, featureId, signal, agentId) {
  const snapshot = await showFeature(repoPath, featureId);
  const agent = snapshot?.agents?.[agentId];
  // Skip if already in target state
  if (signal === 'agent-ready' && agent?.status === 'ready') return;
  if (signal === 'heartbeat-expired' && agent?.status === 'lost') return;
  // ... proceed with emit
}
```

This is not a mutex/lock concern (file lock already prevents concurrent writes) — it's a "don't emit if already in target state" optimization.

#### In-flight signals during feature-close

The XState machine defines terminal states (`closed`, `merged`). Once a feature enters a terminal state, the machine rejects further transitions. However, `emitSignal()` doesn't check the machine state — it just appends to the event log.

**Recommendation**: `emitSignal()` should check if the feature is in a terminal state and silently discard signals:
```javascript
if (['closed', 'merged', 'abandoned'].includes(snapshot.state)) return;
```

GG also recommends this. It prevents log pollution from stale heartbeats or late-arriving signals.

### 5. Compensating Transactions

#### Supported compensating actions

| Action | Trigger | Effect | Automation |
|--------|---------|--------|------------|
| **Restart agent** | `signal.agent_failed` or `signal.session_lost` | Re-launch tmux session, reset agent to `running` | Automatic (with retry limit) |
| **Drop agent** | `signal.heartbeat_expired` + no recovery | Remove agent from XState context, proceed with remaining | Requires approval |
| **Force-ready** | Manual override when agent crashed after completing work | Set agent to `ready` without signal | Manual only |
| **Revert spec move** | Effect failure (e.g., `git mv` failed during close) | Undo partial spec file move | Automatic (effect lifecycle) |

**Automatic vs. manual**:
- **Restart** should be automatic with a limit (max 2 retries per agent per feature). After 2 failures, transition to "needs-attention" for human decision.
- **Drop** should require dashboard approval — removing an agent changes the `allAgentsReady` gate semantics.
- **Force-ready** is always manual — it's a human override for edge cases.

#### Effect lifecycle interaction

The engine's effect claim/reclaim lifecycle (`requested → claimed → succeeded/failed`) interacts with agent failure:
1. Agent fails while an effect (e.g., spec move) is `claimed` by the orchestrator
2. The effect itself is independent of agent state — it completes or fails on its own
3. If the agent is restarted, it doesn't re-claim effects — the orchestrator continues managing them
4. If the agent is dropped, pending effects for that agent are cancelled

This separation is already well-designed in the engine. No changes needed.

## Sources

### Codebase Analysis
- `lib/workflow-core/engine.js` — Signal emission, event persistence, file locking
- `lib/workflow-core/machine.js` — XState guards (`allAgentsReady`, `agentRecoverable`, `agentDroppable`)
- `lib/workflow-core/projector.js` — Signal event projection to agent state
- `lib/workflow-heartbeat.js` — Heartbeat emission and sweep logic
- `lib/workflow-eval.js` — Legacy signal synthesis (`synthesizeAgentReadySignals()`)
- `lib/workflow-close.js` — Bootstrap with synthetic signals
- `lib/workflow-snapshot-adapter.js` — Engine-to-dashboard state mapping
- `lib/manifest.js` — Legacy agent status file I/O
- `lib/commands/misc.js:29-151` — `agent-status` command implementation (dual-write)
- `lib/worktree.js` — Tmux session creation (`createDetachedTmuxSession()`, `buildAgentCommand()`)
- `lib/dashboard-server.js:2012-2077,3607` — Dashboard polling cycle

### Prior Research
- Research-26 (cc findings): Defense-in-depth signal enforcement, tmux hook failure modes, agent capability matrix
- Research-27 (gg findings): Signal injection recommendations, transition strategy

### External References
- tmux#1245 — session-closed not triggering on last session
- tmux#3736 — pane-exited run-shell race condition
- tmux#2483 — pane-died inconsistency with multiple panes
- tmux#1174 — signal death skips hooks
- Temporal.io durable execution — runtime guarantees vs agent compliance

## Recommendation

### Architecture: Shell-first, engine-backed, defense-in-depth

The signal injection architecture should follow three principles:

1. **Shell responsibility over LLM responsibility**: The shell wrapper fires `implementing` (on start) and `submitted`/`error` (on exit) via `trap EXIT`. This removes the most unreliable component (the LLM) from the critical path.

2. **Agent hooks as enhancement, not requirement**: CC's `Stop` hook and GG's `AfterAgent` hook add enforcement layers where available. CX and MV fall back to shell-only coverage.

3. **Orchestrator sweep as safety net**: The dashboard's 10-second poll detects stale agents via heartbeat expiry and emits `signal.session_lost` or `signal.heartbeat_expired` to the engine.

### Concrete implementation plan

**Phase 1 — Shell trap wrapper** (immediate, all agents):
Modify `buildAgentCommand()` in `lib/worktree.js` to wrap commands:
```bash
bash -lc "
  _aigon_cleanup() { ... }
  trap _aigon_cleanup EXIT
  aigon agent-status implementing
  <agent-command>
"
```

**Phase 2 — Heartbeat file touch** (replaces engine-event heartbeat):
- Create `.aigon/state/heartbeat-{featureId}-{agentId}` on agent start
- CC/GG: `PostToolUse`/`AfterAgent` hook touches file on each interaction
- CX/MV: Background `while` loop in shell wrapper
- Orchestrator: checks `mtime`, emits `signal.heartbeat_expired` when stale

**Phase 3 — Signal dedup and terminal state guard**:
- `emitSignal()` skips if agent already in target state
- `emitSignal()` discards signals for features in terminal states

**Phase 4 — Agent CLI hooks** (CC and GG first):
- CC `Stop` hook: blocks exit if `submitted` not called
- GG `AfterAgent` hook: rejects response if signals missing
- CX: Enable `codex_hooks`, add advisory `PostToolUse`

**Phase 5 — Compensating transactions**:
- Auto-restart on `agent_failed` (max 2 retries)
- Dashboard approval for agent drop
- Manual force-ready override

### Key disagreement with GG findings

The GG agent recommends tmux `session-closed` hooks as the primary mechanism for `signal.session_lost`. Based on research-26's documentation of 5 tmux hook failure modes (with real bug report citations), **shell `trap EXIT` is strictly more reliable** for the same failure scenarios. Tmux hooks should not be part of this architecture.

### Heartbeat tuning

Change the default timeout from 90s to **120s** (4× the 30s interval). Long-running tool calls (builds, test suites) can block agent hooks for 60+ seconds, and a 90s timeout creates false positives.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| shell-trap-signal-wrapper | Wrap agent commands in `trap EXIT` to fire implementing/submitted/error signals at the shell level | high | none |
| heartbeat-file-touch | Replace engine-event heartbeats with file touch mechanism; orchestrator checks mtime | high | none |
| signal-dedup-guard | Skip signal emission if agent already in target state; discard signals for features in terminal states | high | none |
| cc-stop-hook-enforcement | Add Claude Code `Stop` hook that blocks session end until `agent-status submitted` is called | high | shell-trap-signal-wrapper |
| stale-agent-sweep | Dashboard poll detects stale implementing agents (tmux gone + heartbeat expired) and emits session_lost | high | heartbeat-file-touch |
| gg-afteragent-enforcement | Add Gemini `AfterAgent` hook that rejects response if lifecycle signals missing | medium | shell-trap-signal-wrapper |
| compensating-auto-restart | Auto-restart failed/lost agents (max 2 retries) before escalating to needs-attention | medium | stale-agent-sweep |
| heartbeat-timeout-120s | Change default heartbeat timeout from 90s to 120s to reduce false positives during long builds | low | heartbeat-file-touch |
| cx-hooks-enablement | Enable Codex `codex_hooks` feature flag; add PostToolUse reminders for lifecycle signals | low | none |
