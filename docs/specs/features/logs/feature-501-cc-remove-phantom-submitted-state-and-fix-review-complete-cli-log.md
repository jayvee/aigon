---
commit_count: 6
lines_added: 273
lines_removed: 178
lines_changed: 451
files_touched: 56
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 488
output_tokens: 160738
cache_creation_input_tokens: 537103
cache_read_input_tokens: 100480043
thinking_tokens: 0
total_tokens: 101178372
billable_tokens: 161226
cost_usd: 172.8534
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 501 - remove-phantom-submitted-state-and-fix-review-complete-cli
Agent: cc

## Commits
- `9ce8b496` — Main implementation. Removes `submitted` lifecycle from engine,
  projector, paths, snapshot adapter, dashboard read paths, CSS, and notification
  types. `review-complete` now requires `--approve` or `--request-revision`.
  Doctor `--fix` rewrites legacy snapshots. Docs and tests updated.
- `833dd65f` — Cleanup. Removes stray `submitted` references from argHints,
  agent-status cleared-by set, eval default expectedFinalState, autonomous
  ready-statuses, and misc.js dead code. Adds backward-compat comments to all
  intentional remaining references.
- `1486222b` — Pre-existing test fixes. `parseClaudeStatus` old-format regex
  regression (trailing `$` anchor) and stale `isLoopbackAddress` pty test.

## Validation
- `node -c` on all modified engine/CLI files: pass
- `npm test` (79 integration + 1 workflow-core): pass
- `npm run test:iterate` (lint, diagram, scoped-tests, browser smoke): pass
- `npm run test:browser:smoke` (4 Playwright smoke tests): pass

## Notes
- f495 is already in `05-done`; the doctor `--fix` migration path is available
  for any other legacy `submitted` snapshots.
- `.cursor` orphan cleanup not applicable in this worktree (no `.cursor/` dir).
