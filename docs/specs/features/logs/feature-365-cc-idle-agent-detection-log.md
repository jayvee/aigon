---
commit_count: 7
lines_added: 401
lines_removed: 4
lines_changed: 405
files_touched: 13
fix_commit_count: 1
fix_commit_ratio: 0.143
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 216
output_tokens: 51300
cache_creation_input_tokens: 575331
cache_read_input_tokens: 16951926
thinking_tokens: 0
total_tokens: 17578773
billable_tokens: 51516
cost_usd: 40.0661
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 365 - idle-agent-detection
Agent: cc

## Status
Implemented: agent JSON `idleDetection` blocks for cc/gg (+ comment placeholders for cx/cu); supervisor `captureAndDetectIdle` + per-agent regex cache + idleAtPromptData map; dashboard collector exposes `idleAtPrompt`/`anyIdleAtPrompt`; `awaiting-input` class extended to OR `anyIdleAtPrompt` on feature/research cards.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-25

### Fixes Applied
- fix(review): revert out-of-scope km removal, terminal adapter changes, and spec deletions (263e8a8c)
  - Restored `km` agent wrapper in `lib/worktree.js` — removal was unrelated to idle detection and would break Kimi sessions.
  - Restored `select tab newTab` in `lib/terminal-adapters.js` — removal was unrelated and could regress cmux focus behavior.
  - Restored deleted specs `feature-366-getnextid-collision...` and `research-41-agent-model-capability-matrix.md` — out-of-scope deletions.

### Residual Issues
- None

### Notes
- Idle-at-prompt implementation is clean and matches spec acceptance criteria. `captureAndDetectIdle` correctly short-circuits on `workingPattern`, degrades gracefully when `idleDetection` is absent, and uses the same in-memory Map lifecycle as existing `idleData`.
- `idleAtPrompt` / `anyIdleAtPrompt` wiring in `dashboard-status-collector.js` and `index.html` correctly parallels the existing `awaitingInput` shape.
- Test coverage exercises regex compilation, pattern matching, and sweep integration.
- Pre-authorised budget bump was not needed — existing test fit within ceiling.
