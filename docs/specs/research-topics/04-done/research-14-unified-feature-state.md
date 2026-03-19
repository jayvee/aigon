# Research: unified-feature-state

## Context

Aigon's understanding of "where a feature is" is currently derived from **five independent signal sources** that can contradict each other:

1. **Folder position** — which `docs/specs/features/0N-*` folder the spec file is in determines the stage (inbox, backlog, in-progress, in-evaluation, done)
2. **Log frontmatter** — agent-written YAML in log files tracks status (implementing, submitted, success), timestamps, and events
3. **Worktree existence** — `git worktree list` reveals whether a worktree is alive, which agents are active, and whether branches exist
4. **Git state** — uncommitted changes, branch existence, merge status, and commit history
5. **Agent process state** — the AI agent's in-memory understanding of what it's doing. This is invisible to the rest of the system until the agent writes to the log. An agent may believe it has submitted, but crashed before the write. It may still be running but stuck. It may have exited without updating status. The tmux session may be alive but the agent process inside it dead. This is the most volatile signal and the hardest to observe — yet it's the one that ultimately drives all the others.

These five signals are **never reconciled into a single authoritative record**. The state machine (`lib/state-machine.js`) reads from some of them via context objects, but each consumer (dashboard, notifications, CLI commands, conductor daemon) assembles its own view of reality from a different subset. When signals desync — an agent crashes mid-commit, a worktree outlives a close, a log says `submitted` but code isn't committed, a folder says `in-progress` but all agents are done — the system breaks in confusing ways.

This is not a bug to patch. It's a fundamental design problem: **Aigon has no single source of truth for the state of a feature**. The state machine defines valid transitions, but it doesn't own the state. It's consulted sometimes, bypassed others, and has no ability to detect or repair inconsistencies.

This research should redesign Aigon's state architecture from the ground up around the **unit of work** (feature/research/feedback) as a first-class entity with a single, authoritative, always-consistent state record.

## Questions to Answer

### The core problem
- [ ] What is the full inventory of state signals today? For each: who writes it, who reads it, when, and what happens if it's stale or missing?
- [ ] What are the known desync scenarios? (agent crash mid-commit, worktree outlives close, log says submitted but files aren't committed, folder and status disagree, etc.)
- [ ] Which desyncs have actually bitten users vs. which are theoretical?
- [ ] Is the distributed nature of the state inherent to the problem (agents are independent processes) or an accidental complexity that can be eliminated?

### Single source of truth
- [ ] Should there be one authoritative state file per feature (e.g., a JSON/YAML manifest) that all four signals feed into, rather than being the signals themselves?
- [ ] If so, where does it live? Options: a `.aigon/features/<id>.json` file, a field in the spec frontmatter, a centralized registry, a SQLite database, or the existing log file with stricter contracts
- [ ] What is the minimal state record that makes a feature's status unambiguous? (stage, agent statuses, worktree paths, last commit SHA, timestamps, etc.)
- [ ] How do you handle the bootstrap problem — the state file needs to exist before the worktree, but the worktree creates some of the state?

### State transitions and consistency
- [ ] Should state transitions be **write-through** (update the authoritative record atomically, then update folders/logs/worktrees as side effects) vs. the current approach (move file, create worktree, write log, hope they stay consistent)?
- [ ] Can we make transitions **idempotent** so that re-running a failed `feature-close` or `feature-setup` converges to the correct state rather than erroring?
- [ ] Should there be a **reconciliation** pass that detects and repairs desync? (e.g., "log says submitted but worktree has uncommitted changes" → auto-commit or warn)
- [ ] How do other distributed workflow systems solve this? (Temporal, Durable Objects, saga patterns, event sourcing)

### Non-deterministic agents
- [ ] Agents are independent processes that can crash, hang, or behave unexpectedly. How do you design state transitions that are safe against agent misbehavior?
- [ ] Should the state machine **own** the transitions (agents request, state machine executes) vs. agents writing state directly?
- [ ] What happens if an agent writes `submitted` but didn't actually finish? Can the state machine verify claims?
- [ ] Should there be heartbeat/watchdog mechanisms to detect dead agents and transition their state accordingly?

### Migration and compatibility
- [ ] How do you migrate from the current folder-based state to a unified model without breaking existing features in flight?
- [ ] Can the new model be introduced incrementally (e.g., new state file + old folders kept in sync during transition)?
- [ ] What's the impact on the dashboard, CLI, and templates?

### Simplification
- [ ] Can we reduce the four signals to fewer? (e.g., eliminate folder-based staging if we have a state file)
- [ ] What state can be derived rather than stored? (e.g., "has worktree" can be checked live rather than recorded)
- [ ] Is the log file pulling double duty (human-readable implementation narrative + machine-readable status)? Should those concerns be separated?

## Scope

### In Scope
- The feature lifecycle (inbox → done) as the primary unit of work
- Research lifecycle (same pattern, same problems)
- All four signal sources and their interactions
- Architectural options for a unified state model
- Migration strategy from current design
- Impact on state machine, dashboard, CLI commands, and agent templates

### Out of Scope
- Dashboard UI redesign (that's a separate feature)
- Specific notification improvements (covered by feature 97)
- Agent SDK or runtime changes (agents remain external processes)
- Multi-repo coordination (each repo manages its own features)

## Findings

### Consensus (both agents)
1. The five unsynchronized state signals are **accidental complexity**, not inherent to the problem.
2. A **per-feature JSON manifest** should be the authoritative state record.
3. **Log files should stop carrying machine state** — pure narrative only.
4. All transitions must be **idempotent** (safe to re-run, converges to correct state).
5. A **reconciliation mechanism** is needed to detect/repair desyncs.
6. The **state machine must be mandatory**, not advisory — all transitions through a gatekeeper.
7. Agents should **report status to a coordinator**, not own system state directly.

### Key Architectural Decision: Folder vs Manifest Authority
- **CC:** Folders remain shared ground truth (committed, visible to collaborators). Manifests are a **local reliability layer**, gitignored. If they disagree, folder wins.
- **GG:** Manifest is the single source of truth. Folders are organizational sugar. If they disagree, JSON wins.

**Decision:** CC's approach adopted — manifests are gitignored (contain machine-local paths like worktree locations), folders are the collaboration signal. This avoids merge conflicts and preserves the "your project board is just folders" UX.

### Key Design Decision: Agent Write Model
- **CC:** Per-agent status files (`feature-55-cc.json`) — agents write directly to `.aigon/state/` in main repo. No write contention.
- **GG:** Agent-state-proxy — agents use a CLI proxy command and never write state files directly.

**Decision:** CC's per-agent files adopted — simpler, no proxy process needed, zero contention by design.

### Key Design Decision: Crash Recovery
- **CC:** Outbox pattern — pending operations list in manifest, replayed on next command.
- **GG:** Intent-based control loop (Kubernetes-style) — `target_status` vs `current_status`, reconciler converges.

**Decision:** CC's outbox pattern adopted — explicit pending array is simpler to implement and debug.

### Detailed Analysis
See agent findings for full details:
- `logs/research-14-cc-findings.md` — deep codebase analysis (line-number refs, 11 failure scenarios, 10 distributed patterns evaluated)
- `logs/research-14-gg-findings.md` — higher-level architectural analysis with Kubernetes-style intent patterns

## Recommendation

**Architecture: "State Manifest + Outbox + Idempotent Steps"**

Hybrid of three patterns: per-entity state manifests, the outbox pattern for reliable side effects, and idempotent/compensatable steps.

1. **Split state files** in gitignored `.aigon/state/`: coordinator manifest (`feature-55.json`) + per-agent status files (`feature-55-cc.json`). No write contention.
2. **Folders remain shared ground truth** — committed to git, visible to all. Manifests are local reliability layer.
3. **State machine becomes mandatory gatekeeper** — all transitions through `requestTransition()`.
4. **Outbox for crash-safe side effects** — pending ops list in manifest, replayed on next command.
5. **All side effects idempotent** — interrupted commands resume cleanly.
6. **Lazy bootstrap** — manifests created on first access from existing folder+log state.
7. **Logs lose frontmatter** — pure markdown narrative, machine state in manifests.
8. **Flat log structure** — drop `selected/`/`alternatives/` folders, winner recorded in manifest.

## Output

### Consolidated Features (5)

| # | Feature Name | Absorbs | Priority |
|---|-------------|---------|----------|
| 1 | **state-manifest-core** | + feature-locking, + manifest-lazy-bootstrap, + event-audit-trail | high |
| 2 | **idempotent-outbox-transitions** | + outbox-side-effects, + idempotent-transitions, + state-machine-gatekeeper | high |
| 3 | **agent-status-out-of-worktree** | + log-narrative-only | high |
| 4 | **dashboard-manifest-reader** | (standalone) | medium |
| 5 | **state-reconciliation** | + drop-selected-alternatives | medium |

### Implementation Phases

```
Phase 1 (sequential — foundation):
  [1] state-manifest-core

Phase 2 (parallel — all depend only on #1):
  [2] idempotent-outbox-transitions
  [3] agent-status-out-of-worktree
  [4] dashboard-manifest-reader

Phase 3 (after #2 lands):
  [5] state-reconciliation
```

### Not Selected
- **agent-state-proxy** (GG): CLI proxy for agent state transitions — per-agent files are simpler, no proxy process needed
- **state-migration-tool** (GG): Explicit migration command — lazy bootstrap on first access makes this unnecessary
