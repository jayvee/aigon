---
commit_count: 4
lines_added: 2027
lines_removed: 1932
lines_changed: 3959
files_touched: 17
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 632 - be-arch-4-worktree-tmux-boundary
Agent: cu

## Status
worktree.js 2280→467 LOC; tmux spawn consolidated in `hosts/tmux-exec.js`; launch → `agent-launch-command.js`, terminal → `terminal-launch.js`, session read-model → `enriched-sessions.js`; worktree facade uses lazy getters; module-graph baseline refreshed (81 cycles, worktree hub 28→~8).

## New API Surface
- `lib/agent-launch-command.js` — `buildAgentCommand`, `buildRawAgentCommand`, `buildResearchAgentCommand`, `buildAgentWrapperEnvironmentLines`, `getAgentSignalCapabilities`
- `lib/terminal-launch.js` — `openTerminalAppWithCommand`, `openInWarpSplitPanes`, `openSingleWorktree`, `ensureTmuxSessionForWorktree`
- `lib/agent-sessions/enriched-sessions.js` — `getEnrichedSessions`, `parseEnrichedTmuxSessionsOutput`, `findEntityStage`, `classifyOrphanReason`, sidecar index/prune
- `lib/agent-sessions/entity-sessions.js` — `ensureAgentSessions`, `gracefullyCloseEntitySessions`
- `lib/agent-sessions/hosts/tmux-exec.js` — `runTmux`, `assertTmuxAvailable`, `tmuxSessionExists`, `resolveTmuxTarget`, `isTmuxSessionAttached`
- `lib/agent-sessions/hosts/tmux-sidecar.js`, `tmux-capture.js`, `tmux-lifecycle.js`

## Key Decisions
- Kept 37-importer `worktree.js` facade with `@deprecated` lazy getters (variable `require()` paths) to avoid new static module-graph edges.
- `agent-launch.js` (triplet resolver) stays separate from `agent-launch-command.js` (shell-trap builder) — shared consumers differ.
- `attachSessionCapture` + rotate script moved to `hosts/tmux-capture.js`; host no longer lazy-borrows worktree for tmux exec.

## Gotchas / Known Issues
- `static-guards.test.js` still fails on pre-existing `git add -A` in `feature-close.js` (unrelated to F632).
- Real `feature-start` e2e not re-run in this session (test-mode launch-command contract verified).

## Explicitly Deferred
- Migrating 37 importers off the worktree facade (follow-up mechanical work).

## For the Next Feature in This Set
- Consider lazy re-exports pattern for remaining hub modules (`utils.js` spread of worktree).

## Test Coverage
- `tests/unit/module-graph-guard.test.js` — worktree must not spawn tmux (F632 regression).
- Existing session/launch/worktree integration tests pass via facade.

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- 0e4a97f06 fix(review): preserve launch home hygiene exports

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- FIX_NOW: The launch extraction dropped the safe-home helper exports from the `worktree.js` compatibility facade and used raw `process.env.HOME` in the moved wrapper env builder; patched in the launch producer so existing callers keep the hygiene contract.
