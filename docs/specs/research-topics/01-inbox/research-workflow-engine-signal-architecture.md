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
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, update the feature spec for workflow-engine-agent-signals with architectural decisions -->
- [ ] Update: `docs/specs/features/01-inbox/feature-workflow-engine-agent-signals.md` with chosen architecture
- [ ] Optionally: refine `docs/specs/features/01-inbox/feature-workflow-engine-orchestrator-sweep.md` based on findings
