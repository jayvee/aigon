---
commit_count: 7
lines_added: 5755
lines_removed: 5234
lines_changed: 10989
files_touched: 26
fix_commit_count: 3
fix_commit_ratio: 0.429
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 5562750
output_tokens: 26187
cache_creation_input_tokens: 0
cache_read_input_tokens: 5348864
thinking_tokens: 6439
total_tokens: 5588937
billable_tokens: 5595376
cost_usd: 12.4048
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 516 - simplify-split-setup-commands
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-06-17

### Fixes Applied
- 7d06552c fix(review): extend F307 git-add guard to setup-legacy.js

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:architectural** — Acceptance criteria require each handler to be a real module with explicit `require()` dependencies (≤600 LOC), not a 5-line passthrough to `setup-legacy.js`. The dispatcher scaffold (`setup.js` at 59 lines) is correct, but all 16 handlers still live in the 5,248-line `setup-legacy.js` closure. `writeRepoRegistry` was correctly moved to `lib/config.js`; handler extraction remains the bulk of the feature work.
- **ESCALATE:architectural** — Per-handler `dashboard-server.js` import ban is satisfied only indirectly (legacy uses `config.writeRepoRegistry`); the criterion is met once handlers are actually split out of legacy.

### Notes
- Structural refactor is sound as an incremental step: dispatcher + legacy shim preserves behaviour, `_test` export surface, and `createSetupCommands(overrides)` wiring.
- `scripts/check-path-literals.js` acorn migration and `STAGE_FOLDERS` console-path fixes in feature/research.js are appropriate unblockers for the larger file move.
- Next implementer pass should migrate smallest handlers first per spec (`trust-worktree`, `installed-notice`, `project-context`) and delete corresponding blocks from `setup-legacy.js` as each lands.
