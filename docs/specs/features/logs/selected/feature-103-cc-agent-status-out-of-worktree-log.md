---
updated: 2026-03-18T21:23:59.459Z
completedAt: 2026-03-18T21:23:59.459Z
---

# Implementation Log: Feature 103 - agent-status-out-of-worktree
Agent: cc

## Plan

Moved agent status reporting from log file YAML frontmatter (inside worktrees) to per-agent JSON state files in `.aigon/state/` (in the main repo). Changes:

1. **`lib/manifest.js`**: Added `writeAgentStatusAt(repoPath, id, agent, data)` — writes to a specific repo's `.aigon/state/` dir using atomic rename, enabling worktree agents to write to the main repo.

2. **`lib/commands/misc.js`**: Replaced `updateLogFrontmatterInPlace()` with `writeAgentStatusAt()`. Now reads `.aigon/worktree.json` to find the main repo path; falls back to `process.cwd()` for Drive branch mode. Added `error` to valid statuses.

3. **`lib/worktree.js`**: `setupWorktreeEnvironment()` now writes `.aigon/worktree.json` with `{mainRepo}` into each worktree. Removed YAML frontmatter from log templates.

4. **`lib/commands/feature.js`**: Removed YAML frontmatter from Drive mode log template.

5. **`lib/dashboard-server.js`**: Added state file scanning — reads `.aigon/state/feature-{id}-{agent}.json` files from the main repo as the primary status source, overriding log frontmatter. Legacy frontmatter scanning is kept for backward compat with older features.

## Decisions

- Kept legacy log frontmatter scanning in the dashboard as a fallback — existing features that predate this change still show correct status.
- Solo Drive mode uses `'solo'` as the agent key (was `null` before), which allows writing a proper state file (`feature-{id}-solo.json`).
- `writeAgentStatusAt()` is separate from `writeAgentStatus()` to avoid hardcoding `ROOT_DIR` — the manifest module always operates on itself, while the new function takes any repoPath.
- The `.aigon/worktree.json` for this specific worktree was created manually since it predates the feature.
