---
status: submitted
updated: 2026-03-13T21:57:48.116Z
---

# Research Findings: filesystem and git

**Agent:** Claude (cc)
**Research ID:** 10
**Date:** 2026-03-14

---

## Key Findings

### 1. Current Model Analysis

The current filesystem-as-state model in Aigon uses `moveFile()` (`lib/utils.js:3847`) which calls `fs.renameSync()` to physically move spec files between state directories (`01-inbox/`, `02-backlog/`, `03-in-progress/`, `04-in-evaluation/`, `05-done/`).

**Git commit overhead per feature lifecycle:**

| Transition | Command | Commits | Commit Message |
|---|---|---|---|
| → inbox | `feature-create` | 0 | (no commit) |
| inbox → backlog | `feature-prioritise` | 1 | `chore: prioritise feature XX - move to backlog` |
| backlog → in-progress | `feature-setup` | 1 | `chore: start feature XX - move spec to in-progress` |
| in-progress → evaluation | `feature-eval` | 1 | `chore: move feature XX to evaluation` |
| evaluation → done | `feature-close` | 2-3 | merge commit + `chore: complete feature XX - move spec and logs` |

**A single feature lifecycle generates 5-6 git commits, of which 3-4 are pure state-change "chore" commits** that contain no meaningful code changes. Research topics and feedback items follow similar patterns. In a project with 50 features, that's 150-200 noise commits in git history.

**Additional friction points:**
- `feature-close` performs: `git push`, `git checkout`, `git merge --no-ff`, file moves, `git add`, `git commit` — a 6-step git sequence for what is conceptually "mark as done"
- Parallel agent work (Fleet mode) creates merge friction when multiple agents try to move files in the same directory tree
- The `organizeLogFiles()` function (`utils.js:4078-4104`) adds more file moves during close, shuffling logs between `selected/` and `alternatives/` subdirs

### 2. Alternative State Storage Options

#### Option A: Single JSON/YAML File (`board.json`)

**Pros:**
- Dead simple — `JSON.parse()`/`JSON.stringify()` with no dependencies
- Git-trackable (human-readable diffs)
- ~50-500KB for 100-500 items, parsing is instantaneous
- Already a pattern in the codebase (`.aigon/config.json`)

**Cons:**
- Git merge conflicts: JSON's commas and braces cause conflicts even for semantically independent changes. Two agents adding items concurrently will conflict.
- Full read-modify-write cycle for any change — concurrent CLI + UI access requires file locking (`proper-lockfile`)
- No partial updates — entire file rewritten for a single status change

**Mitigation:** Use JSONL (one item per line) instead of nested JSON. Git handles line-based additions/removals well. But this sacrifices readability and queryability.

#### Option B: SQLite (`.aigon/board.db`)

**Pros:**
- ACID transactions, WAL mode supports concurrent readers + one writer
- Partial updates (change one row without touching others)
- Queryable with SQL (cycle time, throughput metrics, filtering)
- Taskwarrior v3 migrated from text files to SQLite — strong signal about scaling limits of text-based storage
- Node.js options: `better-sqlite3` (35M+ weekly downloads, synchronous, fast) or built-in `node:sqlite` (Node 22.13+, Release Candidate stability)

**Cons:**
- Binary file — **must be gitignored**, cannot be diffed/merged in git
- State becomes local-only, not shareable via git clone
- `better-sqlite3` requires native addon distribution (prebuilt binaries or `node-gyp`)
- `node:sqlite` not yet stable (Stability 1.2 as of Node 25.7)
- Adds a dependency to what is currently a zero-native-dependency CLI

**Best for:** UI integration (concurrent CLI + web UI access), analytics/querying. Worst for: portability and git-based collaboration.

#### Option C: YAML Frontmatter in Spec Files (Hybrid)

Inspired by [Backlog.md](https://github.com/MrLesk/Backlog.md) — keep spec files as markdown but add YAML frontmatter with status metadata. State changes update the frontmatter field, not the file's directory location.

```yaml
---
id: feature-42
status: in-progress
priority: high
created: 2026-03-10
moved: 2026-03-14T10:00:00Z
---
# Feature: dashboard-statistics
...
```

**Pros:**
- Status is metadata on the entity, not a physical location (the Linear/Notion model)
- Files stay in one directory — no more moves, no more chore commits
- Git-friendly — frontmatter changes are clean, small diffs
- No new dependencies
- AI agents can read status directly from the file they're already working with
- Board view is dynamically constructed by parsing frontmatter across all spec files

**Cons:**
- Requires parsing frontmatter from every spec file to build the board (but trivial for <500 files)
- No built-in concurrency protection (two agents editing frontmatter simultaneously could conflict)
- Less queryable than SQLite (no indexes, no SQL)

#### Option D: Append-Only JSONL Log (`.aigon/history.jsonl`)

```jsonl
{"ts":"2026-03-14T10:00:00Z","agent":"cc","action":"create","id":"feature-42","status":"inbox"}
{"ts":"2026-03-14T10:05:00Z","agent":"cc","action":"move","id":"feature-42","from":"inbox","to":"backlog"}
```

**Pros:**
- Replaces git commits as the audit trail for state changes
- Append-only = no merge conflicts (just `fs.appendFileSync()`)
- Enables analytics: cycle time per state, throughput, agent activity
- Git-friendly — each event is a separate line, diffs are clean appends
- Can reconstruct full board state by replaying events

**Cons:**
- Log grows indefinitely (mitigated by periodic snapshots)
- Needs a companion current-state store for fast reads (don't want to replay 10K events to show the board)
- Two sources of truth if paired with frontmatter — must stay in sync

### 3. Command UX Simplification

**Current state:** Aigon already has 2-3 character aliases (`afc`, `afp`, `afse`, `afd`, `afe`, etc.) — this is at the sweet spot identified by kubectl and git alias research.

**Key opportunities identified:**

1. **Auto-advance command:** A single "next" command that detects current state and advances to the next logical step. This already partially exists as `/an` (next) but could be extended to auto-execute rather than just suggest.

2. **Context-aware defaults:** Like `git push` inferring remote/branch, commands like `afd` could auto-detect the current feature from the branch name (`feature/42-dashboard-stats` → feature 42).

3. **Natural language via skills:** Claude Code's skill system already supports NL triggering. "Start working on feature 42" can invoke the right skill if the description matches. This works today with no code changes.

4. **Single entry point:** A `/a` dispatcher with subcommands (`/a start`, `/a review`, `/a done`) is feasible but [clig.dev](https://clig.dev/) warns against catch-all patterns. The current explicit aliases are actually better for discoverability.

### 4. Visual Interface Integration

**File-watching approach (JSON/frontmatter):**
- macOS FSEvents via [Chokidar](https://github.com/paulmillr/chokidar) is reliable for moderate change volumes
- Known issues: event coalescing under high write loads, no network filesystem support
- Sufficient for a single-user kanban board with infrequent state changes

**SQLite as shared state (CLI + UI):**
- WAL mode handles concurrent readers + one writer without locking issues
- Both CLI and web UI can read/write the same `.aigon/board.db`
- No synchronization problem — single source of truth
- [SkyPilot](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) demonstrates this pattern in production

**Local API server pattern:**
- CLI starts a local Express server (e.g., `localhost:3847`) that the web UI connects to
- REST API shape: `GET /api/board`, `PATCH /api/items/:id`, `GET /api/history`
- Server-Sent Events (SSE) for real-time UI updates
- Modeled on [Linear's GraphQL API](https://linear.app/developers/graphql) but simplified to REST

**Best approach for Aigon:** depends on whether we commit to SQLite. If yes, SQLite with WAL is the cleanest shared state. If we stay file-based, the CLI serving a local API that reads/writes JSON/frontmatter files provides the same benefits with less architectural change.

### 5. Traceability Without Git Commits

**JSONL event log vs git commits:**

| Aspect | Git commits | `.aigon/history.jsonl` |
|---|---|---|
| Atomicity | Atomic across multiple files | One event per line |
| Queryability | Requires `git log` parsing | Simple line filter/grep |
| Portability | Tied to git repo | Self-contained file |
| Analytics | Difficult (parse commit messages) | Easy (structured data) |
| Undo | `git revert` | Append compensating event |

**Recommendation:** Use JSONL as a **supplement** to git, not a replacement. Git tracks content changes; the JSONL log tracks state transitions with richer metadata (who, when, why, duration). This enables analytics (cycle time, throughput) that git log cannot easily provide, while eliminating noise commits.

**Timestamps + agent IDs in the state store** are sufficient for traceability. There are no compliance reasons requiring git-based traceability for Aigon's use case — it's a personal/team productivity tool, not a regulated system.

## Sources

### State Storage
- [Taskwarrior v3 SQLite migration](https://taskwarrior.org/docs/upgrade-3/) — text-to-SQLite migration rationale
- [Backlog.md](https://github.com/MrLesk/Backlog.md) — YAML frontmatter in markdown for task state
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) — synchronous SQLite for Node.js
- [Node.js built-in sqlite](https://nodejs.org/api/sqlite.html) — `node:sqlite` module (RC stability)
- [SQLite WAL documentation](https://sqlite.org/wal.html) — concurrent access with WAL mode
- [SkyPilot SQLite concurrency](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) — CLI tool using SQLite with WAL
- [When JSON sucks: road to SQLite](https://pl-rants.net/posts/when-not-json/) — JSON vs SQLite trade-offs
- [Claw-Kanban](https://github.com/GreenSheep01201/Claw-Kanban) — CLI kanban using node:sqlite

### Merge Conflicts
- [Avoiding JSON merge conflicts](https://sophiabits.com/blog/avoid-json-file-merge-conflicts) — sentinel value technique
- [git-json-merge](https://github.com/jonatanpedersen/git-json-merge) — semantic JSON merging
- [SQLite in git](https://ongardie.net/blog/sqlite-in-git/) — why SQLite must be gitignored

### Command UX
- [clig.dev](https://clig.dev/) — CLI guidelines, alias patterns, subcommand design
- [kubectl-aliases](https://github.com/ahmetb/kubectl-aliases) — programmatic alias generation
- [gitflow-cli](https://github.com/mercedes-benz/gitflow-cli) — context-aware workflow commands
- [AI agent CLI patterns (InfoQ)](https://www.infoq.com/articles/ai-agent-cli/) — NL-compatible CLI design

### UI Integration
- [Chokidar](https://github.com/paulmillr/chokidar) — cross-platform file watching
- [fsevents](https://github.com/fsevents/fsevents) — native macOS file system events
- [proper-lockfile](https://www.npmjs.com/package/proper-lockfile) — Node.js file locking
- [electron-store](https://github.com/sindresorhus/electron-store) — JSON state shared between processes
- [Linear GraphQL API](https://linear.app/developers/graphql) — board state API design

### Traceability
- [Event sourcing pattern (Microsoft)](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) — append-only event stores
- [JSON Lines spec](https://jsonlines.org/) — JSONL format for append-only logs
- [Event sourcing vs audit log](https://www.kurrent.io/blog/event-sourcing-audit) — when to use each

## Recommendation

### Recommended approach: Hybrid Frontmatter + JSONL (Phase 1), SQLite optional (Phase 2)

**Phase 1 — Eliminate directory-as-state (high impact, low risk):**

1. **Add YAML frontmatter to spec files** with `status`, `priority`, `moved` fields
2. **Stop moving files between directories** — all specs live in a single `docs/specs/features/` directory (or keep subdirs for organization, but status comes from frontmatter, not directory name)
3. **Add `.aigon/history.jsonl`** as an append-only state transition log, replacing chore commits
4. **Build board view dynamically** by parsing frontmatter across all spec files
5. **Keep spec content in git** — frontmatter changes produce clean, small diffs

This eliminates 3-4 chore commits per feature lifecycle, removes file-move ceremony, and provides richer traceability than git commits alone. It requires no new dependencies and is fully backwards-compatible (old specs without frontmatter default to their directory-based status).

**Phase 2 — SQLite for UI integration (if/when a visual UI ships):**

6. **Add `.aigon/board.db`** (gitignored) as a derived cache built from frontmatter + JSONL
7. **CLI populates SQLite on startup** by scanning spec files (fast for <500 items)
8. **Web UI reads from SQLite** via a local Express server with WAL mode for concurrent access
9. **State changes write to both** frontmatter (source of truth in git) and SQLite (fast query cache)

This gives the UI fast queryable access without making SQLite the source of truth. Git remains authoritative; SQLite is a local accelerator.

**Why not SQLite-first?**
- Adds a native dependency (`better-sqlite3`) or requires Node 22.13+ (`node:sqlite`)
- Binary file can't be in git — loses the transparency that makes Aigon's current model appealing
- Phase 1 solves the primary pain points (git noise, file-move ceremony, command friction) without any new dependencies

**Why not JSON file?**
- Merge conflict risk is too high for multi-agent workflows (Fleet mode)
- Full read-modify-write cycle is unnecessary when frontmatter gives us per-file atomic updates

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|---|---|---|---|
| spec-frontmatter-state | Add YAML frontmatter with status/priority/timestamps to spec files, replacing directory-as-state | high | none |
| state-transition-log | Append-only `.aigon/history.jsonl` recording all state changes with timestamps and agent IDs | high | spec-frontmatter-state |
| dynamic-board-view | Build board/kanban view by parsing frontmatter across spec files instead of scanning directories | high | spec-frontmatter-state |
| eliminate-chore-commits | Remove git add/commit calls for pure state-change operations, keeping commits only for content changes | high | spec-frontmatter-state |
| migrate-existing-specs | Migration script to add frontmatter to existing spec files based on their current directory location | medium | spec-frontmatter-state |
| auto-advance-command | Single command that detects current item state and advances to the next logical step automatically | medium | spec-frontmatter-state |
| context-aware-defaults | Infer feature ID from current git branch name, reducing required command arguments | medium | none |
| sqlite-board-cache | Optional SQLite cache (`.aigon/board.db`) derived from frontmatter for fast querying and UI integration | low | spec-frontmatter-state |
| board-rest-api | Local Express server exposing board state as REST API for web UI consumption | low | sqlite-board-cache |
| cycle-time-analytics | Compute cycle time, throughput, and agent activity metrics from the JSONL history log | low | state-transition-log |
