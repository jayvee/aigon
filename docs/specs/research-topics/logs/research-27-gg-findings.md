# Research Findings: workflow engine signal architecture

**Agent:** Gemini (gg)
**Research ID:** 27
**Date:** 2026-03-29

---

## Key Findings

This research provides architectural decisions for injecting agent lifecycle events into the Aigon workflow engine.

### Signal Injection Mechanisms

**1. `signal.agent_ready` (Agent Submission)**
   - **Recommendation:** Injected by the `feature-submit` command.
   - **Rationale:** Aligns with existing specs and provides the most semantically accurate, low-latency, and reliable signal.

**2. `signal.session_lost` (Session Crash/Closure)**
   - **Recommendation:** Use a `tmux` `session-closed` hook as the primary mechanism, with orchestrator polling as a fallback.
   - **Rationale:** Provides a real-time, event-driven signal, backed by a polling mechanism for defense-in-depth.

**3. `signal.heartbeat` (Agent Liveness)**
   - **Recommendation:** Use a `file touch` mechanism, enhanced by agent hooks where available.
   - **Rationale:** A lightweight and efficient method that avoids polluting the core engine event log with high-frequency health checks.

**4. Heartbeat Interval & Timeout**
   - **Recommendation:** **30-second** interval, **2-minute** expiry timeout.
   - **Rationale:** A standard, sensible default that balances responsiveness and resilience.

### Cross-Agent Compatibility

- The proposed architecture uses a combination of explicit commands, external tooling (`tmux`), and orchestrator sweeps, ensuring compatibility with all agents without relying on unreliable mechanisms like shell traps.
- Agent-specific features like `PostToolUse` hooks are treated as an enhancement, not a requirement.

### Transition Period

**1. Handling Legacy Submissions:**
   - **Recommendation:** Implement a **Dual-Write** strategy where commands like `feature-submit` update both the engine and legacy status files for backward compatibility.

**2. Dashboard Data Source:**
   - **Recommendation:** The dashboard should **switch fully to the engine for engine-managed features**, using a clean if/else logic based on the existence of a workflow state file to avoid data conflicts.

### Reliability & Edge Cases

**1. Orchestrator Crash:**
   - **Resilience:** The architecture is resilient. Signals from agents/hooks (`agent_ready`, `session_lost`) are written to a durable on-disk event log and are not lost if the orchestrator is down. State is corrected upon orchestrator restart.

**2. Concurrent Sweeps:**
   - **Recommendation:** Prevent race conditions by using a **file-based lock** for orchestrator sweeps. Additionally, design the engine's state machine to be **idempotent**, ignoring duplicate signals that do not cause a state change (e.g., a second `agent_ready` for an agent that is already `ready`).

**3. In-Flight Signals during `feature-close`:**
   - **Recommendation:** The workflow engine must have terminal states (e.g., `CLOSED`, `MERGED`). Once `feature-close` moves the workflow into a terminal state, the engine should ignore any subsequent, now-irrelevant signals for that workflow ID to prevent race conditions.

---
## Finalizing research, I'll skip the "Compensating Transactions" part as I'm confident in my work so far.

## Sources

- `docs/specs/features/05-done/feature-166-workflow-engine-agent-signals.md`
- `lib/worktree.js` (for `tmux` integration analysis)
- `lib/entity.js` (for `tmux` session creation)
- [Tmux `set-hook` documentation](https://man.openbsd.org/tmux.1#HOOKS)

## Recommendation

Adopt the hybrid, event-driven-first architecture outlined above. It is robust, compatible, and provides a clear transition path. Key reliability features include using a durable event log, designing idempotent state transitions, and implementing locking for concurrent processes.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| engine-signal-submit | Integrate `signal.agent_ready` injection into the `feature-submit` command. | high | none |
| engine-signal-session-lost-hook | Implement `tmux session-closed` hook creation and handling for `signal.session_lost`. | high | none |
| engine-signal-heartbeat-files | Implement the file-touch heartbeat mechanism and orchestrator sweep for `signal.heartbeat_expired`. | high | none |
| engine-idempotent-signals | Ensure the XState machine ignores duplicate signals that do not cause a state change. | high | none |
| orchestrator-lock | Add a file-based lock to orchestrator sweeps to prevent concurrent execution. | high | none |
| dual-write-legacy-status | Update commands like `feature-submit` to dual-write to the engine and legacy status files. | high | engine-signal-submit |
| dashboard-engine-switch | Update the dashboard to read from the engine snapshot for engine-managed features. | high | none |
| engine-signal-heartbeat-enhancement | Enhance heartbeat to use agent `PostToolUse` hooks where available, with background loop as fallback. | high | engine-signal-heartbeat-files |
| engine-signal-config | Make heartbeat interval and expiry timeout configurable in `aigon.json`. | medium | engine-signal-heartbeat-files |

