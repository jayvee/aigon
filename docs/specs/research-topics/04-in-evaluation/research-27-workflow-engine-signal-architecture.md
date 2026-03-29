# Research: workflow-engine-signal-architecture

## Context

Aigon's workflow-core engine (phases 1-3 now complete) supports first-class agent signals: `signal.agent_ready`, `signal.agent_failed`, `signal.session_lost`, `signal.heartbeat_expired`. These signals drive XState guards (e.g., `allAgentsReady` gates eval) and enable crash recovery, compensating transactions, and orchestrator-driven remediation.

The previous research (research-26, "improve-agent-signalling") explored prompt-based approaches to get agents to run shell commands like `aigon agent-status submitted`. That research predates the workflow engine migration. Now that the engine is in place, the question shifts from "how to make agents comply with shell commands" to "what signal injection architecture reliably feeds lifecycle events into the engine, across all agents and failure modes?"

The feature spec for phase 4 (`workflow-engine-agent-signals`) exists but needs architectural decisions before implementation. This research should provide those decisions.

## Questions to Answer

### Signal Injection Mechanisms
- [ ] For `signal.agent_ready` (agent submitted): should this be injected by `feature-submit` (CLI command the agent runs), by a shell exit trap in the tmux session, or by the orchestrator observing agent status files?
- [ ] For `signal.session_lost`: should the orchestrator poll tmux session state, or can tmux itself notify via a hook (e.g., `set-hook session-closed`)?
- [ ] For `signal.heartbeat`: what mechanism is lightest — file touch (agent writes timestamp to a file), engine event append (more durable but more I/O), or tmux pane activity detection?
- [ ] What's the right heartbeat interval and expiry timeout? (aigon-next suggested 30s interval, 2min expiry)

### Cross-Agent Compatibility
- [ ] Which agents support shell exit traps? (CC yes, Codex unclear, Gemini unclear, MV unclear)
- [ ] Can we use agent CLI hooks (e.g., Claude Code's `PostToolUse` hooks, Codex's exit handlers) to inject signals automatically?
- [ ] For agents that don't support hooks, is the orchestrator sweep sufficient as the sole signal source?

### Transition Period
- [ ] During the transition (some features on engine, some on legacy), how do we handle features where agents submit via legacy `agent-status` files? Synthesize signals from status files? Dual-write?
- [ ] Should the dashboard read from both engine snapshots AND legacy status files during transition, or switch fully to engine for engine-managed features?

### Reliability & Edge Cases
- [ ] What happens if the orchestrator process (dashboard) crashes? Do signals get lost? How does the engine recover?
- [ ] Can two concurrent orchestrator sweeps create duplicate signals? Is the engine idempotent to duplicate signal events?
- [ ] What happens to in-flight signals if a feature-close runs while heartbeat signals are still being emitted?

### Compensating Transactions
- [ ] What compensating actions should the engine support? (restart agent, drop agent, force-ready, revert spec move)
- [ ] Should compensating transactions be automatic (orchestrator decides) or require human approval via the dashboard?
- [ ] How does the effect claim/reclaim lifecycle interact with agent failure signals?

## Scope

### In Scope
- Signal injection architecture for all signal types
- Cross-agent compatibility analysis
- Heartbeat mechanism design
- Orchestrator sweep integration
- Transition period strategy (legacy ↔ engine coexistence)

### Out of Scope
- Research workflow signals (features only for now)
- Actual implementation of agent signals (that's feature `workflow-engine-agent-signals`)
- Remote/distributed orchestration

## Findings

Research conducted by 3 agents (CC, GG, CX) on 2026-03-29/30. Full findings in `docs/specs/research-topics/logs/research-27-*-findings.md`.

### Consensus (all agents agree)
- `signal.agent_ready` from `feature-submit` (CLI command, not shell trap)
- Heartbeat via file touch (`.aigon/state/heartbeat-{featureId}-{agentId}`), NOT engine events
- 30s heartbeat interval
- Orchestrator sweep as safety net for session loss / heartbeat expiry
- Dashboard: if/else per feature based on engine state existence
- Signal dedup + terminal state guard in `emitSignal()`
- Agent CLI hooks as enhancement, not requirement
- Auto-restart with retry limit; drop/force-ready require human approval

### Key disagreement: `signal.session_lost` mechanism
- **CC**: Shell `trap EXIT` as primary (cited 5 tmux hook failure modes from research-26)
- **GG**: tmux `session-closed` hook as primary
- **CX**: Orchestrator sweep as authoritative; tmux hooks as optional accelerator

**Decision**: Shell `trap EXIT` as primary (CC's analysis of tmux bugs was most thorough). tmux hooks excluded from architecture.

### Heartbeat timeout
- CC/GG: 120s. CX: 90s default, configurable to 120s.
- **Decision**: 120s default, configurable. 90s creates false positives during long builds.

### New agent pluggability
- Add `signals` capability block to `templates/agents/*.json`
- Shell trap + heartbeat sidecar = universal baseline (all agents, zero config)
- Agent-specific hooks opt-in via capability declaration
- New agents get signal infrastructure automatically — no code changes needed

## Recommendation

Adopt a **shell-first, engine-backed, defense-in-depth** architecture:

1. **Shell `trap EXIT`** wraps all agent commands — fires `implementing` on start, `submitted`/`error` on exit. Works identically across all agents.
2. **File-touch heartbeat** — lightweight sidecar touches a file every 30s. Orchestrator checks `mtime`. Only `heartbeat_expired` enters the engine event log.
3. **Signal dedup + terminal guard** — `emitSignal()` checks projected state before appending. Prevents duplicate events and stale signals for closed features.
4. **Orchestrator sweep** — authoritative detector for session loss and heartbeat expiry. Reads tmux state + heartbeat file mtimes. Agent-agnostic.
5. **Agent capability registry** — `templates/agents/*.json` declares signal capabilities. New agents get universal baseline; hooks are opt-in.
6. **Compensating transactions** — auto-restart (max 2 retries), human approval for drop/force-ready.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| shell-trap-signal-infrastructure | Shell trap wrapper + heartbeat file touch + agent signal capability registry | high | `aigon feature-create "shell-trap-signal-infrastructure"` |
| engine-signal-guards | Signal dedup + terminal state guard in `emitSignal()` | high | `aigon feature-create "engine-signal-guards"` |
| agent-recovery-and-enforcement | Auto-restart, approval policy, CC/GG hook enforcement | medium | `aigon feature-create "agent-recovery-and-enforcement"` |

### Feature Dependencies
- engine-signal-guards depends on workflow-engine-agent-signals (feature 166)
- shell-trap-signal-infrastructure depends on workflow-engine-agent-signals (feature 166)
- agent-recovery-and-enforcement depends on shell-trap-signal-infrastructure and engine-signal-guards
- feature 167 (orchestrator-sweep) updated with research findings; depends on shell-trap-signal-infrastructure and engine-signal-guards

### Updated Specs
- [x] Updated: `docs/specs/features/02-backlog/feature-167-workflow-engine-orchestrator-sweep.md` with architectural decisions from research

### Not Selected (folded into other features or already implemented)
- stale-agent-sweep: Folded into feature 167 (orchestrator-sweep) spec update
- heartbeat-timeout-config: Folded into shell-trap-signal-infrastructure
- GG's `engine-signal-submit`: Already implemented in `agent-status` dual-write (`lib/commands/misc.js:99-131`)
- GG's `dashboard-engine-switch`: Already implemented in `workflow-snapshot-adapter.js`
- GG's `dual-write-legacy-status`: Already implemented in `lib/commands/misc.js`
- CX's `workflow-legacy-signal-synthesis`: Already implemented in `workflow-eval.js`
- GG's `engine-signal-session-lost-hook` (tmux hooks): Excluded per CC's tmux reliability analysis
- CX's `workflow-tmux-hook-accelerators`: Excluded — tmux hooks are too unreliable to include even as optional
