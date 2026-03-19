---
status: submitted
updated: 2026-03-18T12:44:12.115Z
---

# Research Findings: Unified Feature State

**Agent:** Claude (cc)
**Research ID:** 14
**Date:** 2026-03-18

---

## Key Findings

### Part 1: Complete State Signal Inventory

Aigon tracks feature/research lifecycle via **five independent signal sources** that are never formally reconciled. The state machine (`lib/state-machine.js`) is **pure logic** -- it receives a context object and returns decisions, but never persists or reads state. Callers must assemble context from all five signals.

#### Signal 1: Folder Position (Spec File Location)

The filesystem directory where a spec `.md` file resides determines its lifecycle stage. This is the **primary signal for entity stage**.

| Entity | Stages (folder prefixes 01-06) |
|--------|------|
| Feature | inbox, backlog, in-progress, in-evaluation, done, paused |
| Research | inbox, backlog, in-progress, done, paused |
| Feedback | inbox, triaged, actionable, done, wont-fix, duplicate |

**Writers:** `moveFile()` in `utils.js:495` (the single function that performs `fs.renameSync`). Called by `feature-prioritise`, `feature-setup`, `feature-eval`, `feature-close`, `feature-now`, and dashboard `/api/spec/move`.

**Readers:** `findFile()` in `utils.js:450` (scans specified folders for a file by ID), `findEntityStage()` in `worktree.js:194` (scans all stage dirs), `collectDashboardStatusData()` in `dashboard-server.js:183` (iterates all stage directories for full state).

**Staleness risks:**
- Folder position is immediately consistent (synchronous `fs.renameSync`)
- **Worktree staleness**: worktrees are branches created at setup time; they see the spec in whatever folder it was in at branch creation. If main repo moves a spec, worktrees won't see this
- **No locking**: two concurrent commands could move the same file simultaneously
- The `transitions` array recorded by `moveFile()` is a best-effort audit trail, never read for logic

#### Signal 2: Log Frontmatter (Agent Status)

Each agent's log file contains YAML frontmatter with status tracking. This is the **primary signal for agent-level status**.

| Field | Values | Written by | Read by |
|-------|--------|------------|---------|
| `status` | implementing/waiting/submitted/error | `agent-status` command, `updateLogFrontmatterInPlace()`, autopilot | Dashboard, autopilot polling, `collectIncompleteFeatureEvalAgents()`, analytics |
| `updated` | ISO timestamp | `updateLogFrontmatterInPlace()` | Dashboard (fallback updatedAt), autopilot |
| `startedAt` | ISO timestamp | First `implementing` event | Analytics (cycle time) |
| `completedAt` | ISO timestamp | `feature-close` | Analytics |
| `events` | Array of `{ts, status}` | `updateLogFrontmatterInPlace()` with `appendEvent` | Analytics (autonomy ratio, wait count) |

**Staleness risks:**
- Log files in worktrees are **separate copies** from main. Dashboard reads both via directory scanning
- `normalizeDashboardStatus()` defaults unknown/missing status to `implementing` -- missing log = appears active
- `agent-status` infers context from **current git branch name**, not from arguments. Wrong branch = wrong log
- No validation that status values are recognized; typos silently normalize to `implementing`

#### Signal 3: Worktree Existence

Presence/absence of git worktree directories signals agent setup and participation.

**Naming:** `{repo}-worktrees/feature-{id}-{agent}-{desc}`

**Writers:** `feature-setup` (fleet mode), `setupWorktreeEnvironment()` in `worktree.js:997`

**Destroyers:** `feature-close`, `feature-cleanup`, `sessions-close`

**Readers:** `git.listWorktrees()`, `git.filterWorktreesByFeature()`, `collectDashboardStatusData()` (scans directory directly), `feature-eval` (counts worktrees for solo vs fleet)

**Staleness risks:**
- Losing agents' worktrees persist after `feature-close` until explicit `feature-cleanup`
- Dashboard discovers agents by **two independent methods**: worktree directory names AND log file names, merged via `knownAgentsByFeature`. Mismatches create phantom agents
- After close, losing worktrees become **orphans** detected by `classifyOrphanReason()` but no auto-cleanup

#### Signal 4: Git State (Branches, Commits, Status)

**Branch naming:** Drive: `feature-{id}-{desc}`, Fleet: `feature-{id}-{agent}-{desc}`

**Key readers:** `branchExists()` (feature-close pre-check), `getCurrentBranch()` (agent-status context inference, feature-do mode detection), `getStatus()` (uncommitted changes check with `.env.local` filtering)

**Staleness risks:**
- Branch existence is the **weakest signal** -- branches can persist after close if cleanup fails
- `.env.local` changes are invisible to all git state checks (intentional but creates hidden state)
- **No atomic operations**: the merge->move spec->organize logs->commit->delete branch->delete worktree sequence can be interrupted at any point

#### Signal 5: Agent Process State (tmux Sessions)

**Session naming:** `{repo}-f{id}-{agent}-{desc}`

**Writers:** `ensureTmuxSessionForWorktree()` in `worktree.js:644`, `feature-setup`, `feature-open`

**Readers:** `tmuxSessionExists()` (boolean), `safeTmuxSessionExists()` (enhanced with attachment check), `getEnrichedSessions()` (lists all with orphan detection)

**Staleness risks:**
- tmux session existence does **not** mean agent is alive -- session persists after process exits
- Dashboard shows "implementing" from log + "session running" from tmux = appears active but actually dead
- tmux sessions survive dashboard restarts, system sleep, and even feature-close of winning agent

#### Multi-Signal Reconciliation Points

There is exactly **one function** that assembles all signals: `collectDashboardStatusData()` in `dashboard-server.js:183`. It reads folders (Signal 1), log frontmatter from main and worktree dirs (Signal 2), worktree directories (Signal 3), and tmux sessions (Signal 5). It does NOT read git branch state (Signal 4).

The state machine's `getAvailableActions()` / `getRecommendedActions()` consume a caller-assembled `StateContext` but are **advisory only** -- commands do not call `isActionValid()` before executing.

---

### Part 2: Desync Scenarios and Failure Modes

#### DATA LOSS severity

**F1: feature-close merges then fails to find spec** (`feature.js:1288-1306`)
Sequence: checkout default -> merge -> findFile post-merge -> moveFile to done. If `findFile()` returns null after merge (spec moved by merge itself), moveFile is skipped. Branch deleted, worktree gone, spec stuck in old folder with no way to proceed.

**F2: Auto-commit succeeds but merge fails** (`feature.js:1218-1295`)
Branch pushed to origin, then merge fails (conflicts). User left on default branch with conflicts. Worktree auto-commits already pushed.

**F3: Log says "submitted" but code not committed** (`validation.js:571-626`)
Log frontmatter written to disk via `fs.writeFileSync` BEFORE git commit. Crash between = log says submitted, implementation may have uncommitted changes. Dashboard reports "submitted."

#### CONFUSING STATE severity

**F4: feature-setup fails after spec move but before worktree creation** (`feature.js:314-477`)
Spec moved to `03-in-progress`, git commit succeeds, but worktree creation fails. Spec in-progress with no agents, no worktrees. Re-runnable (finds spec already in-progress).

**F5: Partial fleet setup** (`feature.js:413-477`)
Worktree creation loop catches and prints errors but continues. Some agents get worktrees, others don't. Partially recoverable on re-run.

**F6: All agents done but spec stuck in-progress**
By design (human must approve), but no timeout, no reminder, no automated transition. Feature appears stuck indefinitely.

**F7: feature-eval moves spec then crashes** (`feature.js:851-854`)
Spec moved to `04-in-evaluation` before eval template created. Re-runnable (finds spec already in evaluation).

**F8: Worktree outlives feature-close** (`feature.js:1336-1352`)
`safeRemoveWorktree` can fail silently (returns false). Spec moved to done, branch merged, but orphaned worktree directory remains. `classifyOrphanReason` detects but takes no auto action.

**F9: feature-close bypasses state machine** (`feature.js:1107`)
`feature-close` does NOT check log frontmatter status or consult state machine. Can close with partially-implemented code, log still saying "implementing."

**F10: No locking or concurrency control**
No file locks, mutexes, or advisory locks anywhere. Two `feature-close` commands on the same feature can race on git checkout and `fs.renameSync`.

**F11: tmux session alive but agent dead**
tmux session persists after agent exits. Dashboard shows "implementing" + "session running" = misleadingly active. State machine's `getSessionAction` returns `attach` for a dead-but-persisting session.

#### Summary of Architectural Issues

1. **No transactional state mutations.** Every command performs 3-8 sequential operations. Any failure partway through leaves partial state with no rollback.
2. **State machine is advisory only.** Commands don't call `isActionValid()` before executing.
3. **No locking or concurrency control.** Two commands can race on the same feature.
4. **Log frontmatter written before git commits.** Crash between = dashboard/actual state desync.
5. **Error handling inconsistent.** Some failures abort, others are warned and continued. `try/catch` around git commits means users may not realize operations failed.
6. **`fs.renameSync` is atomic for the file move but not with the git commit that follows.** Crash between = spec physically in new folder but git doesn't know.

---

### Part 3: Distributed Workflow Pattern Analysis

I evaluated 10 approaches for solving state consistency in file-based workflow systems:

| Approach | Complexity | Atomicity | Recovery | Observability | Migration | **Aigon Fit** |
|----------|-----------|-----------|----------|--------------|-----------|---------------|
| Temporal/Durable Execution | Very High | Excellent | Excellent | Good | Very Hard | Poor (needs server) |
| Saga (Orchestration) | Low-Medium | Medium | Good | Good | Easy | **Strong** |
| Event Sourcing | Medium | Good | Excellent | Excellent | Medium | **Strong** |
| WAL + State Machine | Low-Medium | Good | Excellent | Excellent | Easy | **Strong** |
| SQLite | Medium | Excellent | Excellent | Poor | Hard | Poor (not human-readable) |
| Durable Objects | Very High | Excellent | Excellent | N/A | N/A | Poor (needs cloud) |
| Git as State Store | Medium | Good | Good | Medium | Medium | Partial |
| Outbox Pattern | Low | Good | Excellent | Good | Easy | **Strong** |
| AI Orchestrators (LangGraph) | Medium | Good | Good | Good | Medium | Partial |
| Build Tools (Bazel/Nx) | Medium | Good | N/A | N/A | N/A | Insight only |

**Key insights from external patterns:**
- **Temporal**: Patterns (event sourcing, activity retry, replay) are relevant but infrastructure is a non-starter for a CLI tool
- **Saga**: Aigon commands are already orchestrators; adding compensating transactions is incremental
- **Event Sourcing**: Aigon already has proto-event-sourcing via the `transitions` array in spec frontmatter
- **Outbox**: Maps directly to Aigon's "state update + side effects" problem with minimal complexity
- **LangGraph**: Its checkpoint + pending-writes model is closest to what Aigon needs -- if `feature-setup` creates a worktree but fails to move spec, the worktree creation is a "pending write" that shouldn't repeat
- **SQLite**: Excellent atomicity but poor human observability -- conflicts with Aigon's folder-based spec UX

---

### Part 4: Worktree Communication Problem

**The core isolation issue:** All agent status writes happen **inside the worktree**. The dashboard bridges this by scanning worktree directories from outside (`collectDashboardStatusData()` iterates `{repo}-worktrees/*/docs/specs/features/logs/`). There are zero cross-boundary writes in the current design.

This means:
- Worktree deletion destroys agent status, progress history, and any uncommitted work
- The dashboard's worktree scanning is fragile and ad-hoc
- Every new consumer must reimplement this scanning logic

#### How other systems solve this

| System | Approach | Relevance |
|--------|----------|-----------|
| **GasTown** (Yegge) | Git-backed "Beads" + Erlang-style mailboxes. Agents communicate via mail, never directly. Mayor coordinates. | Solves inter-agent communication — overkill for Aigon where agents are independent |
| **Composio Agent Orchestrator** | Each agent gets own worktree. Orchestrator routes CI failures into agent sessions. | Similar to Aigon but orchestrator-mediated |
| **ccswarm** | Rust message bus with channel-based orchestration. No shared state/locks. | Clean but requires running coordinator |
| **Claude Code native** | `.worktrees/events.jsonl` + `.tasks/` in **main repo**, not inside worktrees | Simplest version — file-based, no server, directly applicable |
| **CI/CD systems** (BuildKite, GitHub Actions) | Workers report to coordinator via HTTP API. Never share filesystem. | Clean separation but requires server |

Sources: [GasTown](https://github.com/steveyegge/gastown), [Composio](https://github.com/ComposioHQ/agent-orchestrator), [ccswarm](https://github.com/nwiizo/ccswarm), [Claude Code worktree isolation](https://code.claude.com/docs/en/common-workflows)

#### Recommended solution: per-agent status files in shared directory

Agents write status to `.aigon/state/` in the **main repo**, not inside their worktree. One file per agent, not per feature — eliminates write contention in fleet mode:

```
.aigon/state/
  feature-45.json       ← coordinator manifest (stage, pending ops, events)
  feature-45-cc.json    ← cc writes this, only cc
  feature-45-gg.json    ← gg writes this, only gg
```

No clashes. Each agent owns exactly one file. The coordinator manifest is only written by CLI commands (`feature-setup`, `feature-close`, `feature-eval`) — never by agents.

During `feature-setup`, write `AIGON_MAIN_REPO=/path/to/repo` into the worktree's `.aigon/worktree.json`. The `agent-status` command resolves this to find the shared state directory.

**Consequence for log files:** Log frontmatter status goes away. Log files become pure human-readable narrative (what the agent did, decisions made, code written). Machine-readable status lives in the manifest. This cleanly separates the two concerns that log files currently conflate.

---

### Part 5: Unified Consumer API

Today every consumer builds its own view of reality:

| Consumer | Signals used | Assembly logic |
|----------|-------------|----------------|
| CLI commands | Folders + log frontmatter + git status + worktree existence (each command different subset) | Ad-hoc per command |
| Dashboard | All 5 signals via `collectDashboardStatusData()` | 400+ line reconciliation function |
| Agents | Write to log frontmatter in their worktree, unaware of what others see | None (write-only) |
| Future macOS app | Would need to reimplement dashboard assembly from scratch | TBD |

With manifests, every consumer reads the same files:
```
.aigon/state/feature-88.json      → stage, pending ops, events
.aigon/state/feature-88-cc.json   → agent cc status
.aigon/state/feature-88-gg.json   → agent gg status
```

**The benefit isn't the format — it's the API surface.** Instead of "understand 5 signals, 12 modules, and 6 folder conventions," it's "read JSON files from one directory." New consumers go from a week of implementation to an afternoon.

The state machine becomes enforceable because there's one write path. `requestTransition()` validates every stage change — no more `feature-close` bypassing the state machine.

---

### Part 6: Directory Structure — Keep It Simple

**Considered and rejected: per-feature folders** (grouping spec + logs + eval in `feature-88-whatever/`).

Problems with per-feature folders:
- Every spec file named `spec.md` — zero context in git log, search results, editor tabs, `git diff --stat`
- `git log --follow` only works on single files, not folders — tracking history across column moves gets harder
- Git rename detection is heuristic — folder rename + file edits in same commit can show as delete+add
- Merge conflicts on folder renames are messier than file renames
- Browsing `05-done/` to scan feature names requires drilling into each folder

**The current naming convention is already doing the grouping job** — `feature-88-dark-mode-*.md` prefix lets you `ls feature-88-*` to see everything. Self-describing filenames work everywhere without path context.

**Recommended simplification:** Drop `logs/selected/` and `logs/alternatives/` folders. Keep all logs flat in `logs/`. Record the winner as a field in the eval doc or manifest (`"winner": "cc"`). This eliminates `organizeLogFiles()` — one less state mutation during `feature-close`, one less thing that can fail partway through.

---

## Sources

### Codebase Analysis
- `lib/state-machine.js` (602 lines) -- pure logic state machine, no I/O
- `lib/utils.js:495` -- `moveFile()` with `transitions` array recording
- `lib/dashboard-server.js:183` -- `collectDashboardStatusData()`, the only multi-signal reconciler
- `lib/commands/feature.js` -- all feature lifecycle commands
- `lib/worktree.js` -- worktree management, orphan detection
- `lib/validation.js` -- Ralph/autonomous loop, status writing
- `lib/git.js` -- branch/status helpers

### External Research
- [Temporal: Beyond State Machines](https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications)
- [Durable Execution Meets AI (Temporal)](https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai)
- [Restate.dev -- Lightweight Durable Execution](https://www.restate.dev/)
- [Saga Pattern -- Microsoft Azure Architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)
- [Saga Pattern -- microservices.io](https://microservices.io/patterns/data/saga.html)
- [Event Sourcing -- Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Event Sourcing -- Arkwright](https://arkwright.github.io/event-sourcing.html)
- [Write-Ahead Logs in Distributed Systems](https://medium.com/@abhi18632/understanding-write-ahead-logs-in-distributed-systems-3b36892fa3ba)
- [SQLite WAL Mode](https://www.sqlite.org/wal.html)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- [LangGraph Persistence -- Checkpoints](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph State Management 2025](https://sparkco.ai/blog/mastering-langgraph-state-management-in-2025)
- [Transactional Outbox Pattern -- microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)
- [Transactional Outbox -- AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Bazel Task-Based Builds](https://bazel.build/basics/task-based-builds)
- [Git Atomic Pushes](https://github.blog/2015-04-30-git-2-4-atomic-pushes-push-to-deploy-and-more/)

---

## Recommendation

### Architecture: "State Manifest + Outbox + Idempotent Steps"

The best fit for Aigon is a **hybrid of three patterns**: per-entity state manifests (event sourcing), the outbox pattern for reliable side effects, and idempotent/compensatable steps (sagas).

#### 1. Split state files: coordinator manifest + per-agent status

```
.aigon/state/
  feature-55.json       ← coordinator (CLI commands write this)
  feature-55-cc.json    ← agent cc writes this, only cc
  feature-55-gg.json    ← agent gg writes this, only gg
```

**Coordinator manifest** (`feature-55.json`):
```json
{
  "id": 55,
  "type": "feature",
  "name": "unified-state",
  "stage": "in-progress",
  "specPath": "docs/specs/features/03-in-progress/feature-55-unified-state.md",
  "agents": ["cc", "gg"],
  "winner": null,
  "pending": [],
  "events": [
    { "type": "created", "at": "2026-03-17T08:00:00Z", "actor": "cli" },
    { "type": "stage-changed", "from": "backlog", "to": "in-progress", "at": "2026-03-17T10:00:00Z" }
  ]
}
```

**Agent status file** (`feature-55-cc.json`):
```json
{
  "agent": "cc",
  "status": "implementing",
  "updatedAt": "2026-03-18T10:00:00Z",
  "worktreePath": "/Users/jviner/src/aigon-worktrees/feature-55-cc-unified-state"
}
```

No write contention — each writer owns exactly one file. Dashboard reads all `feature-55-*.json` to assemble the full picture.

#### 2. Outbox for crash-safe side effects

When a command runs (e.g., `feature-setup`):
1. Write intent to manifest: `{ stage: "in-progress", pending: ["move-spec", "create-worktree-cc", "init-log-cc"] }`
2. Execute each side effect, removing from `pending` on success
3. If crash mid-execution, next command reads manifest, sees `pending` items, completes them

#### 3. Idempotent steps

Every side effect must be safe to re-run:
- "Move spec to 03-in-progress" -- if already there, no-op
- "Create worktree" -- if already exists, no-op
- "Write log file" -- if already exists, no-op
- "Delete worktree" -- if already gone, no-op

#### 4. Folders remain source of truth for stage

Spec files in kanban folders are the **shared ground truth** — committed to git, visible to all collaborators, and the core Aigon UX ("your project board is just folders"). The manifest caches stage locally for fast reads and crash recovery, but folders are authoritative. If they disagree, the folder wins and the manifest is corrected.

#### 5. State machine becomes the gatekeeper

Instead of advisory-only, the state machine validates ALL transitions before execution. Commands must go through `requestTransition(featureId, action)` which:
1. Reads the manifest
2. Validates the action is permitted
3. Writes the new state + pending side effects atomically
4. Returns the list of side effects to execute

#### 6. Per-entity file locking

Before any state mutation, acquire an advisory lock (`.aigon/locks/feature-55.lock`). This prevents concurrent commands from racing on the same feature. Simple flock-based locking, automatically released on process exit.

### Multi-user and git considerations

**Key scoping decision:** `.aigon/state/` should be **fully gitignored** for v1.

The manifest contains machine-local state (worktree paths like `/Users/alice/src/...`, tmux session names, heartbeat timestamps, pending operations). If two developers both set up the same feature with the same agent ID, their manifests would conflict on merge with no clean resolution — agent assignments are per-machine, not shared.

**What's shared vs local:**
- **Shared (already in git):** spec file folder position (the existing derived signal), spec content, log files committed on submit
- **Local (gitignored `.aigon/state/`):** stage (redundant with folder position), agent assignments, worktree paths, pending ops, events

**For v1:** Folder position remains the collaboration signal. Manifests are a **local reliability improvement** (crash safety, idempotent recovery, single source of truth per machine), not a collaboration protocol. Multi-user coordination is a separate, harder problem that doesn't need to block the crash-safety wins.

**Implication for "lazy bootstrap":** Since manifests are local, any command that touches a feature should check for a manifest and create one from folder position + log frontmatter if missing. This means a user can still manually create a spec file in `01-inbox/` and the first CLI/dashboard access will bootstrap the manifest. The manifest owns the lifecycle *on this machine*; the folder position is the shared ground truth across machines.

### Why this combination:
- **No server required** -- just JSON files in `.aigon/state/` (gitignored)
- **Human-readable** -- JSON manifests inspectable directly; spec files stay in folders
- **Crash-safe** -- pending outbox + idempotent steps = interrupted commands can resume
- **Low migration cost** -- introduced alongside existing folder-based state; manifests are local overlay
- **Agent-compatible** -- agents write per-agent status files to shared `.aigon/state/`; log files become pure narrative
- **Incremental adoption** -- start with manifests for new features; backfill existing features on first access
- **Multi-user safe** -- gitignored manifests can't conflict; folder position is the shared signal

### What gets eliminated:
- **Dashboard reassembling state from 5 signals** -- reads manifests instead (locally)
- **Race conditions** -- file locking prevents concurrent mutations on same machine
- **Partial state on crash** -- outbox pattern ensures recovery
- **State machine bypass** -- all transitions go through gatekeeper

### What changes:
- **Log files lose frontmatter status** -- become pure narrative markdown, no YAML machine state
- **Agent status moves to `.aigon/state/`** -- per-agent JSON files, written outside worktrees
- **`organizeLogFiles()` eliminated** -- no more selected/alternatives folders; winner recorded in manifest

### What stays:
- **Folder position as shared ground truth** -- still committed, still the collaboration signal, still the Aigon pitch
- **Spec markdown files in folders** -- still there, still human-readable, still edited directly
- **Log files as implementation narrative** -- still written by agents, still committed on close
- **Self-describing filenames** -- `feature-88-dark-mode.md`, not `spec.md` in a folder
- **tmux sessions** -- ephemeral process state, checked live not stored
- **Git branches and worktrees** -- still the execution mechanism

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| state-manifest-core | Implement split state files in `.aigon/state/`: coordinator manifest + per-agent status files, with read/write API and file locking | high | none |
| agent-status-out-of-worktree | Agents write status to `.aigon/state/feature-{id}-{agent}.json` in main repo instead of log frontmatter; `feature-setup` writes `AIGON_MAIN_REPO` to worktree context | high | state-manifest-core |
| idempotent-transitions | Make all state transition side effects (file moves, worktree ops, log writes) idempotent and retryable | high | state-manifest-core |
| outbox-side-effects | Add pending-operations outbox to coordinator manifest with crash-recovery replay on next command | high | state-manifest-core |
| state-machine-gatekeeper | Refactor state machine from advisory to mandatory; all transitions go through `requestTransition()` | high | state-manifest-core |
| manifest-lazy-bootstrap | Any command that touches a feature bootstraps a manifest from folder position + worktree/tmux probing if missing; enables manual inbox file creation | medium | state-manifest-core |
| dashboard-manifest-reader | Refactor dashboard to read state from manifests instead of assembling from 5 signal sources | medium | state-manifest-core |
| log-narrative-only | Remove YAML frontmatter from log files; logs become pure markdown narrative; agent status lives in manifest | medium | agent-status-out-of-worktree |
| drop-selected-alternatives | Eliminate `logs/selected/` and `logs/alternatives/` folders; keep all logs flat in `logs/`; record winner in manifest or eval doc | medium | state-manifest-core |
| feature-locking | Per-entity advisory file locking to prevent concurrent command races on the same feature | medium | state-manifest-core |
| state-reconciliation | Detect and repair desync between manifest, folder position, and worktree existence via `aigon doctor` | medium | idempotent-transitions |
| event-audit-trail | Record all state transitions as events in the coordinator manifest for debugging and analytics queries | low | state-manifest-core |
