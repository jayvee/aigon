# Research Findings: single source of truth for feature state

**Agent:** Claude (cc)
**Research ID:** 33
**Date:** 2026-04-17

---

## Key Findings

### 1. The Desync Problem Is Structural, Not a Bug

The current architecture stores lifecycle state in two places that can independently mutate:

- **Workflow engine** (`.aigon/workflows/features/{id}/snapshot.json`) — event-sourced, authoritative by design
- **Spec file location** (`docs/specs/features/02-backlog/feature-29-*.md`) — a "derived projection" that is NOT treated as read-only

This is a textbook anti-pattern in event-sourced systems. The event sourcing literature is unanimous: **projections must be read-only views computed from the event log**. When a projection (folders) becomes independently mutable (via `git mv`, broad `git add`, manual moves), the fundamental contract breaks.

Six concrete desync vectors exist today:

| Vector | Mechanism | Incident? |
|--------|-----------|-----------|
| Bootstrap from wrong folder | `setup.js:218` creates snapshot with `lifecycle` from folder name | Yes — Feature #29 appeared in backlog despite being in `05-done/` |
| Broad `git add` sweeping stale moves | `check-version` previously ran `git add docs/` | Yes — Feature #01 reappeared in backlog |
| Manual `git mv` without engine update | No enforcement prevents direct file moves | Yes — Features 250-253 required manual snapshot edits |
| Crash between effect execution and snapshot write | `engine.js:410-417` has a non-atomic window | Theoretical but possible |
| Effect claim expiry | Two processes can both execute `move_spec` | Theoretical |
| Git merge conflict on spec file location | Two branches move same spec differently | Theoretical |

### 2. How Other Tools Solve This

Every successful tool in this space uses a **single source of truth** with no independently-mutable projection:

| Tool | Authority | Projection | Dual State? |
|------|-----------|------------|-------------|
| **git-bug** | Immutable operation DAG (git refs) | Computed views | No — views are always derived |
| **Terraform/Pulumi** | Code (HCL/language) | Actual infrastructure | No — `apply` reconciles actual to desired |
| **Linear** | Database | UI views | No — single DB |
| **Kiro (AWS)** | Markdown spec files | Agent state | No — specs are "golden" |
| **SpecKit** | Markdown files | VS Code UI | No — files ARE the state |
| **GitHub Projects** | API (database) | Labels, columns | **YES** — and it's a known unsolved pain point |

The only tool with a dual-authority problem similar to Aigon's is GitHub Projects (labels vs. project columns). Their "solution" is external automation via GitHub Actions — exactly the kind of reconciliation-on-read that Option C proposes, and it's universally considered inadequate.

### 3. Current Architecture Already Half-Implements Option B

The codebase is already designed with engine-as-authority in mind:

- **`feature-spec-resolver.js`** already prefers engine snapshot over folder scan (lines 99-111)
- **`workflow-core/effects.js:62-75`** already has a `move_spec` effect that the engine uses to move files as a side effect of state transitions
- **`workflow-core/paths.js:13-32`** already maps lifecycle states to folder names
- **`workflow-snapshot-adapter.js`** already maps snapshots to dashboard display data

What's missing is **enforcement**: nothing prevents folder mutations outside the engine, and read paths still fall back to folder scanning when snapshots are missing.

### 4. Migration Surface Is Manageable

Folder path references are partially centralized:

- **Primary constants**: `lib/templates.js:16-32` (PATHS), re-exported via `lib/constants.js`
- **Duplicated in**: `lib/workflow-core/paths.js` (lifecycle-to-folder maps), `lib/feature-spec-resolver.js` (VISIBLE_STAGE_DIRS)
- **250+ template files** reference folders but mostly in documentation comments, not logic
- **Board display** (`lib/board.js:10-38`) scans folders directly — needs migration
- **Dashboard collector** (`lib/dashboard-status-collector.js:89-97`) uses `listStageSpecFiles()` — folder scan

### 5. Feedback Is Decoupled

Feedback items use a completely different folder scheme (`01-inbox`, `02-triaged`, `03-actionable`, `04-done`, `05-wont-fix`, `06-duplicate`) with NO workflow engine. Any solution for features/research does not need to address feedback immediately — feedback can migrate later when/if it gets a workflow engine.

### 6. Eliminating Folders Entirely (Option A) Is Not Worth the Cost

While Option A would completely eliminate desync, it sacrifices something genuinely valuable: the ability to browse specs by stage in a file explorer, GitHub web UI, or `ls`. Tools like Kiro and SpecKit keep specs as readable files because developer ergonomics matter. The cost of removing folders (lost discoverability, migration complexity, breaking git history) outweighs the simplification benefit — especially when Option B achieves the same correctness guarantee while keeping folders.

### 7. Symlinks (Option E) Add Complexity Without Solving the Core Problem

Symlinks still create a dual-authority situation (symlink target vs. engine snapshot). Additionally: GitHub renders symlinks as text blobs, Windows support is poor, `git log --follow` doesn't track through symlinks, and editors may not follow them. The indirection cost exceeds the benefit.

---

## Answers to Research Questions

**Should the workflow engine be the sole authority, with folders as a derived projection?**
Yes. This is the correct architecture. The engine event log is already the authoritative record; folders should be a read-only projection that the engine maintains.

**Should folders be eliminated entirely?**
No. Folders provide genuine ergonomic value for browsing specs by stage. The desync problem is caused by mutability of folders, not by their existence.

**Is there a hybrid approach where folders exist but are auto-corrected from engine state?**
Yes — this is Option B. On every read, if the folder disagrees with the engine, the engine wins and the file is auto-corrected. This makes folders self-healing.

**What is the migration path?**
1. Make all CLI state transitions go exclusively through the engine (most already do)
2. Add auto-correction on read paths — if folder position disagrees with engine, move the file
3. Remove direct folder scanning from board/dashboard — read engine state, use folders only for the `move_spec` effect
4. Bootstrap migration for existing specs: scan folders, create engine state where missing

**How does this affect research and feedback?**
Research already uses the workflow engine — same solution applies. Feedback does not use the engine and can remain folder-based for now; it has no desync problem because there's no second authority to disagree with.

**What happens to git history if we stop moving files?**
We still move files — the engine's `move_spec` effect does the move. The difference is that NO other code path is allowed to move specs. Git history continues to show moves, but they're always correct and engine-driven.

**How do humans browse specs by stage without folders?**
They still use folders. Option B keeps folders. The change is enforcement: folders are maintained by the engine, never by manual operations.

**What do other tools do?**
See table above. The consensus is single authority with derived views.

---

## Sources

- [Event Sourcing Pattern — Azure Architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) — projections must be read-only views
- [Anti-patterns in event modelling — Property Sourcing](https://event-driven.io/en/property-sourcing/) — mutable projections break event sourcing contract
- [git-bug: Distributed bug tracker in Git](https://github.com/git-bug/git-bug) — CRDT-inspired operation DAG, single source of truth
- [Terraform vs Pulumi: State management comparison](https://www.pulumi.com/docs/iac/comparisons/terraform/) — code-authoritative with reconciliation
- [Kiro (AWS): Specs as first-class artifacts](https://kiro.dev/docs/specs/) — specs are "golden", version-controlled
- [GitHub SpecKit](https://speckit.org/) — specs as single source of truth
- [GSD Framework](https://gsd-build-get-shit-done.mintlify.app/) — file-based state, context isolation
- [GitHub Community: Label-column sync problem](https://github.com/orgs/community/discussions/181366) — dual authority is a known unsolved issue
- [CRDT: Conflict-free Replicated Data Types](https://crdt.tech/) — distributed state convergence
- [Linear: Project status docs](https://linear.app/docs/project-status) — single database authority

### Codebase References

- `lib/workflow-core/effects.js:62-75` — `move_spec` effect executor (already exists)
- `lib/workflow-core/engine.js:88-129` — effect builder generates `move_spec` on lifecycle change
- `lib/workflow-core/engine.js:383-419` — non-atomic window between effect execution and snapshot write
- `lib/workflow-core/paths.js:13-32` — lifecycle-to-folder mappings
- `lib/feature-spec-resolver.js:97-149` — hybrid spec resolution (already prefers engine)
- `lib/commands/setup.js:151-257` — bootstrap creates snapshots from folder position
- `lib/board.js:10-38` — direct folder scanning for board display
- `lib/dashboard-status-collector.js:89-97` — `listStageSpecFiles()` folder scan

---

## Recommendation

**Implement Option B: Engine as sole authority, folders as a derived self-healing projection.**

This is the right solution because:

1. **It matches the existing design intent** — the engine was always meant to be authoritative; folders were meant to be a convenience projection. The problem is weak enforcement, not wrong architecture.
2. **The codebase is already 70% there** — spec resolver prefers engine state, `move_spec` effect exists, lifecycle-to-folder mappings exist
3. **It's what every successful tool does** — single authority with derived views (Terraform, git-bug, Linear, Kiro)
4. **It preserves developer ergonomics** — folders still work for browsing in file explorers and GitHub
5. **It's self-healing** — auto-correction on read means desync is automatically fixed, not manually repaired

### Implementation approach (3 features, ordered by dependency):

**Feature 1 — Enforce engine-only state transitions:**
- Audit all code paths that move spec files; ensure every move goes through the engine's `move_spec` effect
- Add a safeguard: if a spec file exists in an unexpected folder (disagrees with engine snapshot), log a warning and auto-correct by moving it to the engine-expected location
- Remove the bootstrap path that creates snapshots from folder position; instead, create snapshots with correct lifecycle and move the file to match

**Feature 2 — Migrate read paths from folder scanning to engine queries:**
- `lib/board.js`: replace `fs.readdirSync()` folder scanning with engine snapshot queries
- `lib/dashboard-status-collector.js`: replace `listStageSpecFiles()` with engine-based listing
- Keep folder scanning ONLY as a fallback for pre-engine entities (legacy migration)

**Feature 3 — Self-healing reconciliation on read:**
- On every dashboard/board refresh, compare engine state with folder position
- If they disagree, engine wins: move the file and log the correction
- This replaces the manual `aigon repair` command for spec drift

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| engine-only-spec-transitions | Enforce that all spec file moves go through the workflow engine's `move_spec` effect, with auto-correction when folder position disagrees with engine state | high | none |
| engine-based-read-paths | Migrate board and dashboard from folder scanning to engine snapshot queries for feature/research lifecycle display | high | engine-only-spec-transitions |
| self-healing-spec-reconciliation | Auto-correct spec file position on read when folder disagrees with engine state, replacing manual repair for drift | medium | engine-based-read-paths |
| feedback-workflow-engine | Add workflow engine support for feedback entities, eliminating folder-only state management | low | engine-only-spec-transitions |
