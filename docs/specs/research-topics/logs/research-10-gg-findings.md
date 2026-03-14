---
status: submitted
updated: 2026-03-13T21:57:53.799Z
---

# Research Findings: filesystem and git

**Agent:** Gemini (gg)
**Research ID:** 10
**Date:** 2026-03-14

---

## Key Findings

### Current Pain Points
- **Git Noise and Latency:** Executing `git add` and `git commit -m "chore: start feature XX - move spec to in-progress"` for every state transition is a major source of friction. It litters the git history with state-change metadata rather than meaningful code/content updates.
- **Merge Conflicts:** When multiple agents (e.g., in a Fleet setup) operate simultaneously, filesystem moves and directory-level git operations can create unnecessary merge conflicts.

### Alternative State Storage
- **JSON File (`.aigon/board.json`):**
  - **Pros:** Native to JS/Node environments, extremely fast compared to git operations, human-readable, requires no extra dependencies, easily watched by a UI/Radar API.
  - **Cons:** Concurrency issues if multiple processes write simultaneously (though manageable with atomic writes or a simple file lock).
- **SQLite:**
  - **Pros:** ACID compliant, excellent concurrency, powerful query capabilities.
  - **Cons:** Introduces native dependencies (`sqlite3`), opaque without a viewer, overkill for tracking ~100-500 feature states. Even Taskwarrior, which recently migrated to SQLite (v3.0), had to build a dedicated sync server to manage the complexity of syncing SQLite files.

### Reducing Git Ceremony
The most effective strategy is a "Hybrid Model":
1. Keep the feature specification Markdown files in a **single, flat directory** (e.g., `docs/specs/features/`) so they never move.
2. Track the lifecycle state (Inbox, Backlog, In Progress, Done) in an unversioned `.aigon/board.json` file.
3. Add `.aigon/board.json` to `.gitignore`.
4. Only use `git commit` when the actual content of a spec file changes, completely decoupling state from version control.

### Visual Interface Integration
A visual UI (like the one proposed in research-09) needs low-latency reads and writes. A JSON file or SQLite DB is vastly superior to invoking `git` CLI commands under the hood. The Radar API could easily serve the contents of `.aigon/board.json` and broadcast updates via WebSockets when the file changes.

### Traceability Without Git Commits
To maintain an audit trail without polluting git, Aigon can use an append-only log file (`.aigon/history.log`) containing structured JSON lines (e.g., `{"timestamp": "...", "featureId": 10, "from": "inbox", "to": "in-progress", "agent": "jviner"}`). This provides perfect historical traceability without merge conflicts.

## Sources
- **SQLite vs JSON for CLI State:** Standard industry practice dictates JSON for configuration and lightweight state (< 1MB). SQLite is preferred for relational data and high concurrency, which is unnecessary here.
- **Taskwarrior 3.0 Sync:** Taskwarrior abandoned simple file-sync for SQLite and a custom Sync Server, highlighting the complexity of syncing databases versus files.
- **Aigon Codebase:** Grep searches reveal numerous `git commit -m "chore: move..."` calls in `lib/commands/shared.js`, confirming the high volume of automated state commits.

## Recommendation

**Migrate to a Hybrid JSON State Model.**

Aigon should stop using directories (`01-inbox/`, `02-backlog/`, etc.) to represent state. All feature specs should reside in a flat `docs/specs/features/` directory.

The state of each feature should be tracked in `.aigon/board.json` (ignored by git). This completely eliminates the need for `git mv` and state-only git commits, massively speeding up transitions and reducing git noise. To preserve the audit trail, state transitions should be appended to a local `.aigon/history.log`. This approach seamlessly sets up Radar (research-09) to build a fast, reactive UI.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| flatten-spec-directories | Move all specs to a single directory and remove state-based folders | high | none |
| json-board-state | Implement `.aigon/board.json` for state storage and ignore it in git | high | flatten-spec-directories |
| local-history-log | Implement an append-only `.aigon/history.log` for state transitions | medium | json-board-state |
| radar-board-api | Expose the JSON board state via Radar API for UI clients | high | json-board-state |
| command-aliases | Implement shorter aliases (e.g., `/fp` for prioritise) to reduce typing friction | low | none |