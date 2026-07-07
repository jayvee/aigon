---
commit_count: 0
lines_added: 0
lines_removed: 0
lines_changed: 0
files_touched: 0
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 621 - dash-arch-2-fs-watch-collection
Agent: cu

## Status
Added `lib/dashboard-fs-watch.js` — debounced fs.watch on `.aigon/state`, workflows, and spec stage dirs → `pollRepoStatus`. Safety-net interval unified to 60s. Escape hatch: `dashboard.fsWatch: false` (global or per-repo).

## New API Surface
- `createDashboardFsWatch`, `resolveRepoWatchPaths`, `resolveFsWatchEnabled`, `shouldIgnoreWatchPath`
- Dashboard helpers: `registerRepoFsWatch`, `unregisterRepoFsWatch`
- `/api/refresh` calls `pollStatus({ force: true })` so manual refresh is not short-circuited by an in-flight fs-watch repo poll

## Key Decisions
- No `utils` import (breaks `utils → dashboard-server → fs-watch` cycle). Feedback stage dirs duplicated inline.
- Agent status files read from primary repo `.aigon/state/` only; worktree paths under `~/.aigon/worktrees/` intentionally unwatched (documented in module header).
- Poll side-effect paths filtered: `heartbeat-*`, `nudge-recovery-pending-*`, `.lock`, telemetry/cache.
- macOS: recursive watch on five roots; Linux: per-stage dirs + dynamic workflow entity subdirs.

## Gotchas / Known Issues
- `close-failure-event.spec.js` @smoke fails on this branch without F621 changes (duplicate repo in e2e status payload) — unrelated to fs-watch.

## Explicitly Deferred
- SSE push (F622). tmux control-mode events remain on safety-net poll.

## For the Next Feature in This Set
- F622 can subscribe clients to `statusVersion` bumps; fs-watch already narrows server-side staleness before the client poll.
- Consider deduping duplicate conductor repo entries in e2e fixture (`repos count: 2` with identical path).

## Test Coverage
- `tests/integration/dashboard-fs-watch.test.js` — ignore paths, watch roots, debounced trigger, config disable, spec move + re-collect.

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-07

### Fixes Applied
- 7d609fb2a fix(review): enable recursive fs watch on macOS
- 071545e82 fix(review): avoid duplicate and leaked fs watchers

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Review found the implementation aligned with the F621 scope after the watcher lifecycle fixes above.
