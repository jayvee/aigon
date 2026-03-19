---
status: submitted
updated: 2026-03-18T11:35:22.948Z
---

# Findings: Unified Feature State

## The Core Problem

**Inventory of State Signals:**
1. **Folder Position:** Written by CLI, read by state machine/dashboard. If stale, the dashboard shows the wrong stage.
2. **Log Frontmatter:** Written by agent, read by dashboard. If stale, the system thinks the agent is still running when it has crashed.
3. **Worktree Existence:** Written by Git, read by CLI. If stale (worktree exists but feature is closed), it causes conflicts or blocks future checkouts.
4. **Git State:** Written by Git/agent. If stale (uncommitted changes), work might be lost or block transitions.
5. **Agent Process State:** Written by OS. Most volatile. If the agent crashes, other signals are left in a hanging state.

**Known Desync Scenarios:**
- Agent crashes mid-commit, but the log says `submitted`.
- Feature is closed, but the worktree outlives the close, blocking future branch creation.
- Folder is moved to `03-in-progress`, but the agent fails to start or exits silently.
- Log claims `success`, but changes were never committed to the worktree branch.

The distributed nature of the state is **accidental complexity**. While agents are independent processes, they don't need to own the system's state; they should only report their progress to a central authority.

## Single Source of Truth

- **Authoritative State File:** There should be one authoritative state file per feature. The best location is `.aigon/features/<id>.json`. This avoids merge conflicts that a single global `state.json` would suffer from, while cleanly separating machine-readable state from human-readable specs.
- **Minimal State Record:** The minimal record should include: `id`, `target_status`, `current_status`, `assigned_agents` (with PIDs for heartbeat checks), `worktree_path`, `git_branch`, and `last_updated_timestamp`.
- **Bootstrap Problem:** Use an intent-based approach (similar to Kubernetes). The CLI writes `current_status: inbox, target_status: in-progress` to the state file *before* creating the worktree. If the process fails, the state reflects the incomplete transition, allowing the system to retry idempotently.

## State Transitions and Consistency

- **Write-Through / Intent-Based:** Transitions should follow a control-loop pattern. The user requests a state change (sets `target_status`). The state machine then executes side effects (moving folders, creating worktrees) until `current_status` matches `target_status`.
- **Idempotency:** By using intent-based transitions, commands like `feature-setup` and `feature-close` become naturally idempotent. They check the current reality (does worktree exist?) and only perform missing steps.
- **Reconciliation Pass:** An automatic reconciliation pass (or a manual `aigon sync` command) should run to detect desyncs (e.g., checking if agent PIDs are still alive, verifying Git status) and either repair them or flag the feature as `error_state`.
- **Prior Art:** Distributed systems like Kubernetes use control loops (observe -> diff -> act). Workflow engines like Temporal use event sourcing to ensure state is never lost even if workers crash.

## Non-Deterministic Agents

- **State Machine Ownership:** The state machine (CLI/daemon) must *own* the state. Agents should not write directly to `state.json` or move folders. Instead, they should invoke an `aigon-proxy` command (e.g., `aigon-proxy status update --status submitted`) which validates the transition.
- **Verification:** Before accepting a `submitted` status from an agent, the state machine should verify claims (e.g., check that the worktree has no uncommitted changes and tests pass).
- **Heartbeats:** The state machine should record the agent's PID in the state file. A lightweight watchdog or reconciliation loop can check if the PID is still active; if not, it transitions the agent's status to `crashed`.

## Migration and Compatibility

- **Migration Strategy:** Provide an `aigon migrate-state` command that parses existing folders, logs, and git worktrees to generate the `.aigon/features/<id>.json` files for all inflight features.
- **Compatibility:** Keep the folder structure (`01-inbox`, etc.) for human organization, but treat the JSON file as the source of truth. If they disagree, the JSON file wins, and the reconciliation loop moves the folder to match the JSON state.

## Simplification

- **Reduce Signals:** By making the JSON file the source of truth, folder position becomes purely aesthetic. 
- **Derived State:** Things like "has worktree" can be checked live via Git rather than hardcoded, or used strictly as a cache.
- **Log Separation:** The `log.md` file should be purely for narrative (the agent's thought process) and should no longer be parsed for machine state.

## Recommendation

Implement an **Intent-Based Unified State Architecture** utilizing `.aigon/features/<id>.json` as the single source of truth for each unit of work. 

1. **Decouple state from folders and logs:** Introduce JSON manifests for machine state.
2. **Centralize state mutations:** Agents must use the CLI/proxy to request state changes, rather than manipulating files directly.
3. **Implement a Reconciliation Loop:** Build a mechanism that compares desired state with actual system state (Git worktrees, PIDs) to automatically fix or flag desyncs.
4. **Make transitions idempotent:** Ensure commands like `setup` and `close` can be re-run safely to converge on the desired state.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
| --- | --- | --- | --- |
| `feature-state-manifests` | Introduce `.aigon/features/<id>.json` as the single source of truth for feature state. | high | none |
| `state-reconciliation-loop` | Implement a core engine that detects and repairs desyncs between manifests, worktrees, and processes. | high | `feature-state-manifests` |
| `agent-state-proxy` | Create a proxy CLI for agents to request state transitions safely, removing their direct access to state files. | medium | `feature-state-manifests` |
| `idempotent-transitions` | Refactor feature setup, close, and transition logic to be intent-based and idempotent. | high | `state-reconciliation-loop` |
| `state-migration-tool` | Provide a migration command to build JSON manifests from existing folders and logs. | medium | `feature-state-manifests` |
