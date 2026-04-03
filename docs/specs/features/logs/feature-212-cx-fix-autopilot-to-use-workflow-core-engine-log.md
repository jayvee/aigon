---
commit_count: 5
lines_added: 214
lines_removed: 51
lines_changed: 265
files_touched: 5
fix_commit_count: 2
fix_commit_ratio: 0.4
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 3443506
output_tokens: 13096
cache_creation_input_tokens: 0
cache_read_input_tokens: 2967808
thinking_tokens: 4838
total_tokens: 3456602
billable_tokens: 3461440
cost_usd: 7.5853
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 212 - fix-autopilot-to-use-workflow-core-engine
Agent: cx

## Plan
- Move `feature-autopilot` monitoring from legacy `.aigon/state` reads to workflow-core snapshots, with legacy fallback only when no snapshot exists.
- Ensure feature autopilot spawn uses the wrapped launcher path (`buildAgentCommand`) while still running autonomous `feature-do` commands.
- Require both autopilots to auto-eval only when workflow snapshot agents are `ready`, then wait for engine transition confirmation (`currentSpecState === evaluating`).
- Route Ralph auto-submit completion signal through `aigon agent-status submitted` to emit both legacy status and workflow-core signal.

## Progress
- Updated `lib/commands/feature.js`:
  - `feature-autopilot` is now async.
  - `status` reads workflow snapshot first and falls back to legacy state only when snapshot is missing.
  - Spawn phase checks engine `ready` first and uses `buildAgentCommand({... rawCommand })` for wrapped autonomous launches.
  - Monitor phase polls workflow snapshots (`agent.status === ready`) with snapshot-initialization and legacy fallback handling.
  - Auto-eval path removed `--force`, validates engine readiness, calls `feature-eval`, then waits for `currentSpecState === evaluating`.
- Updated `lib/worktree.js`:
  - Added `rawCommand` override support in `buildRawAgentCommand()` so callers can reuse the shell-trap wrapper for internal CLI flows.
- Updated `lib/commands/research.js`:
  - `research-autopilot` is now async.
  - Auto-eval now checks snapshot readiness, invokes `research-eval`, and waits for `currentSpecState === evaluating`.
- Updated `lib/validation.js`:
  - Ralph auto-submit now runs `aigon agent-status submitted` instead of direct local `writeAgentStatus(...)`.
- Validation:
  - `node -c lib/commands/feature.js`
  - `node -c lib/commands/research.js`
  - `node -c lib/validation.js`
  - `node -c lib/worktree.js`
  - `node -c aigon-cli.js`
  - `npm test` (13/13 passing)
  - `node aigon-cli.js server restart` (no running server found, started fresh)

## Decisions
- Kept a legacy status fallback only when workflow snapshots are absent to preserve behavior for pre-engine entities while making engine snapshots the primary source.
- Added an explicit eval-transition confirmation wait with timeout to prevent autopilot from claiming success before workflow-core state actually moves to `evaluating`.

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-04-03

### Findings
- Snapshot read (`readWorkflowSnapshotSync`) was called inside the `existingWorktrees.forEach()` spawn loop, re-reading the same file on every iteration instead of once before the loop.

### Fixes Applied
- `fix(review): hoist snapshot read outside spawn forEach loop` — moved snapshot read before the forEach, eliminating redundant file reads per agent.

### Notes
- Implementation is clean and well-structured. All acceptance criteria are addressed.
- The `rawCommand` escape hatch in `buildRawAgentCommand()` is a reasonable approach to reuse the shell-trap wrapper for internal CLI commands.
- Legacy fallback strategy (only when no snapshot exists) is sound and preserves backward compatibility.
- Research.js uses repeated inline `require('../workflow-snapshot-adapter')` calls (readSnapSync, readSnapSync2, etc.) — consistent with the file's existing pattern but worth consolidating in a future cleanup.
- Ralph auto-submit change from `writeAgentStatus()` to `execSync('aigon agent-status submitted')` correctly routes through the engine signal path.
- All changed files pass syntax checks.
