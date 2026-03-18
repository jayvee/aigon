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
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
