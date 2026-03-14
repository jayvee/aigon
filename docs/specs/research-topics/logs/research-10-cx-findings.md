---
status: submitted
updated: 2026-03-13T21:58:57.845Z
---

# Research Findings: filesystem and git

**Agent:** Codex (cx)
**Research ID:** 10
**Date:** 2026-03-14

---

## Key Findings

### 1. The current workflow cost is real and concentrated in file moves plus git commits

- Aigon's state model is explicitly "state-as-location": items live in numbered directories under `docs/specs/`, and command handlers discover state by scanning those folders. This is documented in `docs/architecture.md` and implemented across `lib/utils.js` and `lib/commands/shared.js`.
- `moveFile()` is a synchronous filesystem rename with no abstraction beyond directory changes. That keeps the model simple, but every state transition is tightly coupled to pathname changes rather than item metadata.
- Feature transitions commonly add workflow-only commits:
  - `feature-prioritise` commits `chore: prioritise feature NN - move to backlog`
  - `feature-setup` commits `chore: start feature NN - move spec to in-progress`
  - `feature-eval` commits `chore: move feature NN to evaluation`
  - `feature-close` commits `chore: complete feature NN - move spec and logs`
- In this repo's actual git history, I counted **163 state-change commits** matching those workflow patterns, versus **307 `feat:` / `fix:` / `docs:` commits**. That is substantial: workflow movement is a large visible fraction of history, not a minor edge case.

### 2. The current model already leaks friction into implementation details

- Worktree setup depends on the in-progress spec move being committed before worktrees are created; otherwise the spec may not exist in the worktree. The code explicitly warns about this in `feature-setup`.
- UI/status surfaces are coupled to filesystem layout. Board and dashboard code infer state by reading `03-in-progress`, `04-in-evaluation`, `04-done`, and related folders rather than querying a state model.
- Research uses a mixed approach already:
  - main topic state is still encoded by directory
  - per-agent findings live in `logs/`
  - completion/submission is inferred from file contents and front matter
- Aigon already accepts ignored local runtime state in `.aigon/`. This repo ignores `.aigon/` in `.gitignore` and already stores `.aigon/.board-map.json`. So "workflow metadata outside git" is not a foreign concept in this codebase.

### 3. Keeping specs in place and moving board state elsewhere is the cleanest next step

- A full "specs stay where created, board state lives in `.aigon/board.json`" model would remove most rename/move churn while preserving markdown specs as durable human-readable artifacts.
- This also fits the likely UI direction better than directory-as-state. A UI or local API wants CRUD over items and stages, not directory scanning and rename semantics.
- Minimal board record shape could be:

```json
{
  "items": {
    "feature-54": {
      "type": "feature",
      "specPath": "docs/specs/features/feature-54-config-models-global-resolution.md",
      "stage": "in-progress",
      "updatedAt": "2026-03-14T08:58:00Z",
      "updatedBy": "cx"
    }
  }
}
```

- That gives CLI and UI a stable ID-based state model while leaving spec content in markdown files.

### 4. JSON is a good first replacement; SQLite is a better medium-term control-plane store

- **Single JSON/YAML file**
  - Pros: trivial to inspect, zero dependency cost, easy migration from current helpers, easiest way to prototype a new board model.
  - Cons: whole-file rewrites, no concurrency protection beyond ad hoc locking, awkward history queries, higher merge risk if checked into git.
  - Best use: local ignored runtime state or a transitional adapter.

- **SQLite**
  - Pros: single local file, transactional updates, easy querying, natural fit for history/events tables, much better backend for Radar/API-style reads and writes.
  - Cons: more implementation surface than JSON, harder to inspect casually than markdown, needs a clear migration/export story.
  - Best use: local source of truth for board state and append-only event history once Aigon treats Radar/CLI/UI as multiple clients of one control plane.

- Based on the official SQLite docs, this use case is squarely in SQLite's comfort zone: local application state in a single file with transactional updates and optional WAL mode for better concurrent read/write behavior.

### 5. Git should keep content history, not minute-by-minute board movement

- The current feature lifecycle often produces 3-4 workflow-only commits before counting actual implementation commits.
- Those commits are useful only because directory location is the source of truth. If stage becomes data, the main reason for those commits disappears.
- Recommended split:
  - keep specs, evaluations, findings, and implementation logs in git
  - stop auto-committing pure state transitions
  - record state changes in a local append-only event log instead
- A simple event stream such as `.aigon/history.log` or a SQLite `events` table can preserve traceability:

```json
{"ts":"2026-03-14T08:58:00Z","item":"feature-54","from":"backlog","to":"in-progress","actor":"cx","surface":"cli"}
```

- That preserves auditability without polluting the repo's shared commit graph.

### 6. Collaboration is the main trade-off if board state leaves git

- If `.aigon/board.json` or SQLite stays ignored, collaborators on different machines will not automatically share workflow state through git.
- For Aigon's current scope, that may be acceptable because the project is already optimized for local-first single-operator orchestration, and the research scope explicitly excludes multi-user sync.
- If shared state becomes important later, SQLite still leaves room for:
  - explicit export/import
  - optional checked-in snapshots
  - a lightweight local daemon/API that becomes the sync boundary instead of raw files

### 7. Command simplification should happen alongside state simplification, not instead of it

- Shorter aliases help, but they do not remove the underlying ceremony of move + add + commit + branch/worktree side effects.
- A single `advance` command becomes much easier once state is data:
  - current state is read from the board store
  - the command applies the next legal transition
  - optional side effects are attached to transitions as policy, not inferred from folder names
- Natural-language commands are feasible later, but they are not the core fix. The real win is replacing a path-based workflow model with an ID-and-stage model that simpler commands can target.

### 8. Recommended migration path: hybrid first, then optional SQLite

1. Add a state adapter layer so commands stop reading folder names directly.
2. Introduce `.aigon/board.json` as the new source of truth for stage.
3. Freeze spec paths for new items instead of moving them between folders.
4. Record transitions in `.aigon/history.log` or equivalent event records.
5. Update board/dashboard/Radar reads to use the adapter rather than directory scanning.
6. Once the shape stabilizes, consider swapping the JSON backend for SQLite without changing command UX.

This avoids a flag-day rewrite and lets Aigon keep markdown specs while removing most of the filesystem and git ceremony.

## Sources

- Local code and docs:
  - `docs/architecture.md`
  - `docs/development_workflow.md`
  - `lib/utils.js`
  - `lib/commands/shared.js`
  - `.gitignore`
  - `.aigon/.board-map.json`
  - `git log` in this repo for workflow commit patterns

- Primary external sources:
  - SQLite, "Appropriate Uses For SQLite": https://www.sqlite.org/whentouse.html
  - SQLite, "Write-Ahead Logging": https://www.sqlite.org/wal.html

## Recommendation

Move Aigon to a **hybrid local-state model**:

- Keep markdown specs, logs, findings, and evaluations in git.
- Stop using directory location as the canonical workflow state.
- Introduce an ignored local board store first (`.aigon/board.json`) plus an append-only history log.
- Add a state adapter so CLI, dashboard, and Radar stop scanning directories directly.
- Treat SQLite as the likely medium-term backend once the board schema and event model settle.

I would not jump straight to SQLite on day one if the goal is fast iteration. The lowest-risk path is:

1. replace path-based state reads with a board-state adapter
2. persist stage in `.aigon/board.json`
3. stop auto-committing state-only transitions
4. add `.aigon/history.log` for auditability
5. migrate to SQLite only if Radar/UI querying or event history becomes awkward in JSON

That gives Aigon most of the benefit immediately:

- faster transitions
- less git noise
- cleaner UI integration
- easier "advance" style commands
- preserved traceability without forcing every workflow nudge into the shared commit history

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| board-state-adapter | Introduce a shared state abstraction so commands and UI code read item stage from one interface instead of scanning numbered folders directly. | high | none |
| local-board-store | Add `.aigon/board.json` as the local source of truth for workflow stage while keeping specs and logs as markdown files. | high | board-state-adapter |
| workflow-event-log | Record all stage transitions in an append-only local history file with timestamps, actor IDs, and surface metadata. | high | local-board-store |
| stop-state-change-commits | Remove automatic git commits for pure state transitions and reserve commits for spec/log/content changes only. | high | local-board-store |
| advance-command | Add a single command that reads current state and applies the next legal workflow transition automatically. | medium | board-state-adapter |
| sqlite-board-backend | Replace or complement the JSON board store with SQLite once Radar/UI/event-query needs outgrow whole-file JSON updates. | medium | local-board-store |
