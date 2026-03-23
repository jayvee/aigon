# Research: filesystem-and-git

## Context

Aigon manages the state of research topics, features, and feedback using a filesystem-based Kanban approach — items are Markdown files that physically move between directories (`01-inbox/`, `02-backlog/`, `03-in-progress/`, `04-done/`). Each state transition triggers a git commit to create a point-in-time record of the item's status.

This model was a good starting point: it's transparent, version-controlled, and requires no database. But as usage scales, pain points are emerging:

- **Speed**: moving an item from inbox → backlog → in-progress involves multiple file moves, git adds, and commits. Each transition has ceremony that slows the creative flow.
- **Command friction**: slash commands like `/aigon:research-prioritise` and `/aigon:feature-setup` are hard to type and hard to remember. The command names are long and the workflow requires knowing the correct sequence.
- **Git noise**: state-change commits (e.g. "chore: move feature-42 to in-progress") pollute the git history without adding meaningful code changes. They also create merge friction when multiple agents are working in parallel.
- **Visual interface compatibility**: research-09 (control-surface-strategy) is exploring a visual UI (macOS app or web app). A filesystem-based state model is harder for a UI to interact with than a structured data store — it requires file I/O, git operations, and directory watching rather than simple API calls.

The core question: can Aigon move to a faster, lighter state management approach that preserves traceability without the overhead of filesystem moves and git commits for every state change?

## Questions to Answer

### Current Pain Points
- [ ] Which specific operations in the current workflow are the slowest or most friction-heavy?
- [ ] How many git commits in a typical feature lifecycle are pure state-change commits vs meaningful content commits?
- [ ] Are there cases where the filesystem state and git history have diverged or caused confusion?

### Alternative State Storage
- [ ] Could a single JSON/YAML file (e.g. `.aigon/board.json`) track item states instead of directory positions, while keeping the spec files in place?
- [ ] Could SQLite (local, single-file) provide queryable state without requiring a server?
- [ ] What are the trade-offs of each approach for: speed, traceability, merge conflicts, UI integration, and simplicity?
- [ ] How would a non-filesystem state model interact with git — should state changes still be committed, committed less frequently (batched), or excluded from git entirely?

### Reducing Git Ceremony
- [ ] Could state changes be tracked outside git entirely (local DB or config file in `.gitignore`) while spec content remains version-controlled?
- [ ] Would a "commit on milestone" approach work — only committing when content changes, not state changes?
- [ ] How would other agents or collaborators stay in sync if state isn't in git?

### Command Simplification
- [ ] Could shorter command aliases (e.g. `/fp` instead of `/aigon:feature-prioritise`) reduce friction enough on their own?
- [ ] Could a single "advance" command auto-detect the next state and move the item forward without explicit state names?
- [ ] Would natural language commands (e.g. "start working on feature 42") be feasible with current agent capabilities?

### Visual Interface Integration
- [ ] How would each storage approach (filesystem, JSON, SQLite) integrate with the Radar API from research-09?
- [ ] What API shape would a UI need to read/write board state efficiently?
- [ ] Could the state store be the single source of truth that both CLI and UI read from, eliminating the need for filesystem-based state?

### Traceability Without Git Commits
- [ ] Could an append-only log file (`.aigon/history.log`) provide the audit trail that git commits currently offer?
- [ ] Would timestamps + agent IDs in the state store be sufficient for traceability?
- [ ] Are there compliance or workflow reasons that require git-based traceability specifically?

## Scope

### In Scope
- Analysis of the current filesystem + git state management model and its bottlenecks
- Alternative state storage approaches (JSON file, SQLite, hybrid)
- Reducing or eliminating git commits for state-only changes
- Command UX simplification strategies
- Integration considerations for a visual UI (web or native app)
- Migration path from current model to proposed model

### Out of Scope
- Implementing the chosen approach
- Building the visual UI itself (covered by research-09 and subsequent features)
- Multi-user or remote collaboration models
- Changes to the spec file format or content structure

## Inspiration
- Research-09 (control-surface-strategy) — the UI surface that would consume this state
- Linear, Shortcut, and other project tools that use databases with git integration rather than git-as-database
- Taskwarrior's approach: local JSON-based task storage with optional sync
- The current Aigon `.aigon/config.json` — already a non-git-committed config store

## Findings

### Agent Research Summary

Three agents (cc, cx, gg) independently researched this topic. All agreed on the core problems:

- **3-4 pure state-change commits per feature lifecycle** — cx counted 163 state-change commits vs 307 content commits in this repo (~35% noise)
- **The git ceremony (add + commit) is the slow part**, not the file move itself (`fs.renameSync` is instant)
- **An append-only event log** could replace git-based traceability for state changes

The agents proposed replacing the folder model with JSON files, frontmatter, or SQLite. However, on review these alternatives introduce significant complexity (schema management, sync problems, dual sources of truth) while solving a problem that has a simpler fix.

### Key Insight: Keep Folders, Fix the Ceremony

The folder-based Kanban model is actually a strength:
- **Transparent** — any agent or human can understand state by looking at the filesystem
- **Debuggable** — `ls docs/specs/features/03-in-progress/` tells you everything
- **No schema** — no JSON structure to maintain, validate, or migrate
- **Git-native** — file moves show up cleanly in diffs and history

The real bottleneck is that every state transition triggers a blocking `git add` + `git commit` sequence (~200-500ms), and the workflow requires multiple separate slash commands to move through states.

### Proposed Approach: Deferred Commits + Combined Commands

**1. Deferred git commits for state-only moves**
- File moves happen immediately (instant `fs.renameSync`)
- Git commits are deferred — state moves are batched into the next content commit, or committed at session end
- Only milestone transitions (start work, complete, close) get their own commits if needed
- The folder state is always correct on disk; git just catches up

**2. Milestone-only commits**
- Moving inbox → backlog → in-progress doesn't need individual commits
- Commit at meaningful points: when content changes, when a feature completes, when evaluation is written
- State moves piggyback onto these content commits naturally

**3. Combined workflow commands**
- `/afn` (feature-now) already combines create + setup + implement
- Add more combined flows: "prioritise and start", "evaluate and close"
- Reduce the number of transitions a user must invoke

**4. Faster CLI path via Radar**
- If Radar is running, state moves could go through the API (already in-memory) instead of spawning `node aigon-cli.js` (Node startup cost)
- The Radar API can also serve the folder state to a visual UI via directory scanning — no separate data store needed

**5. Append-only event log (optional enhancement)**
- `.aigon/history.jsonl` records state transitions with timestamps and agent IDs
- Supplements git history with richer metadata for analytics (cycle time, throughput)
- Not a replacement for the folder model — just an audit/analytics layer

## Recommendation

**Keep the folder-based Kanban model. Make it faster by deferring git commits and combining workflow steps.**

The folder structure is simple, transparent, and works. The pain is the git ceremony, not the model. Replacing it with JSON/SQLite introduces schema management, sync complexity, and a less debuggable system — solving the wrong problem.

Priority order:
1. **Defer state-change commits** — biggest speed win, simplest change
2. **Combine workflow steps** — fewer commands to type, fewer transitions
3. **Event log for analytics** — optional, adds cycle-time metrics without changing the core model
4. **Radar as fast path** — eliminates Node startup cost for state moves when Radar is running

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| deferred-state-commits | Defer git commits for state-only file moves; batch into next content commit or session end | high | `aigon feature-create "deferred-state-commits"` |
| combined-workflow-commands | Add combined commands (prioritise+start, evaluate+close) to reduce transition count | high | `aigon feature-create "combined-workflow-commands"` |
| workflow-event-log | Append-only `.aigon/history.jsonl` for state transition audit trail and cycle-time analytics | medium | `aigon feature-create "workflow-event-log"` |
| radar-fast-state | Use Radar API for state moves when running, bypassing Node CLI startup cost | low | `aigon feature-create "radar-fast-state"` |

### Feature Dependencies
- combined-workflow-commands depends on deferred-state-commits (combined flows should use deferred commits)
- workflow-event-log is independent
- radar-fast-state depends on Radar being implemented (research-09 / feature work)

### Not Selected
- **board.json / SQLite state store** — introduces schema, sync complexity, and dual sources of truth for a problem that deferred commits solve more simply
- **YAML frontmatter in specs** — co-locates state with content but requires parsing all files to build the board; folder scanning is equivalent and already works
- **Flatten spec directories** — removes the visual clarity of the current folder model
- **Short command aliases** — already exist (`afc`, `afp`, `afd`, etc.); not the bottleneck
