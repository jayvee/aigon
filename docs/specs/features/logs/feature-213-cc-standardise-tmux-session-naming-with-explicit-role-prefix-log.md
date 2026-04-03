---
commit_count: 5
lines_added: 123
lines_removed: 63
lines_changed: 186
files_touched: 10
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 287
output_tokens: 21272
cache_creation_input_tokens: 182295
cache_read_input_tokens: 7915911
thinking_tokens: 0
total_tokens: 8119765
billable_tokens: 21559
cost_usd: 16.8916
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 213 - standardise-tmux-session-naming-with-explicit-role-prefix
Agent: cc

## Plan

Followed spec directly — updated core naming functions in `lib/worktree.js`, then updated all callers across the codebase.

## Progress

- Updated `buildTmuxSessionName` to accept `role` option with allowlist: do, eval, review, auto
- Updated `parseTmuxSessionName` with 3-tier parsing: auto (no agent), role+agent, legacy fallback
- Simplified `matchTmuxSessionByEntityId` to delegate to `parseTmuxSessionName`
- Updated all callers in: feature.js, research.js, misc.js, entity.js, dashboard-server.js, dashboard-status-helpers.js, dashboard-status-collector.js, workflow-read-model.js
- Added `role` field to `getEnrichedSessions` output
- All syntax checks and tests pass

## Decisions

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-03

### Findings
- Legacy feature eval tmux sessions in the old `{repo}-f{id}-eval-{desc}` format no longer parsed after the rename, which would make generic session discovery and shutdown paths miss already-running eval sessions after upgrade.

### Fixes Applied
- `b7c1ba1c` — `fix(review): preserve legacy feature eval session parsing`

### Notes
- Review otherwise stayed aligned with the spec's new naming scheme; no additional changes were needed.

1. **Role filtering for implementation session lookups**: `safeTmuxSessionExists` and `ensureTmuxSessionForWorktree` now filter by `role === 'do'` when looking for existing implementation sessions. This prevents false matches against review/eval sessions for the same agent — a correctness improvement over the old code where `review-cc` as an agent string wouldn't match `cc`.

2. **workflow-read-model.js direct string constructions**: Kept the prefix-based approach for review/eval session scanning (since it searches by prefix match), but added `parseTmuxSessionName` calls to extract the agent code correctly from matched sessions. This maintains backwards compatibility while supporting the new naming.

3. **Eval session agent extraction**: For new-style eval sessions, the agent is now directly parseable from the session name. Added parser as primary extraction method with heartbeat/log file fallbacks for legacy sessions only.
