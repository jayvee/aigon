---
commit_count: 7
lines_added: 253
lines_removed: 7
lines_changed: 260
files_touched: 11
fix_commit_count: 2
fix_commit_ratio: 0.286
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 4291232
output_tokens: 16398
cache_creation_input_tokens: 0
cache_read_input_tokens: 4094208
thinking_tokens: 5380
total_tokens: 4307630
billable_tokens: 4313010
cost_usd: 9.5325
sessions: 3
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 260 - research-reset
Agent: cx

## Plan
- Add first-class `research-reset` command in the research command domain.
- Add workflow-core reset API for research lifecycle state.
- Wire dashboard/manual action surfaces to expose and dispatch `research-reset`.
- Register command metadata/template and update reset guidance docs.

## Progress
- Ran `aigon feature-start 260` first; CLI confirmed the feature was already running as solo worktree.
- Verified workspace safety checks (`git branch --show-current` and `pwd`) and ran `aigon feature-do 260`.
- Implemented `research-reset` with research-specific cleanup (sessions, findings, state, heartbeat, spec move, workflow engine state).
- Added workflow-core `resetResearch(...)` API and exported it.
- Added `ManualActionKind.RESEARCH_RESET` and exposed action candidate in research workflow rules.
- Updated snapshot adapter, dashboard server allowlist, and dashboard frontend action handling for destructive confirmation + dispatch to `research-reset`.
- Follow-up UX fix: ranked `research-reset` with destructive actions in dashboard button ordering.
- Added command metadata entry and new template: `templates/generic/commands/research-reset.md`.
- Updated `AGENTS.md` reset guidance to include research reset flows.
- Validation:
  - `node --check lib/commands/research.js` passed
  - `node --check lib/workflow-core/engine.js` passed
  - `node --check templates/dashboard/js/actions.js` passed
  - `npm test` failed in pre-existing `tests/integration/pro-gate.test.js` assertions unrelated to this feature change (same result across two runs).

## Decisions
- Reused existing shared session teardown by invoking `sessions-close` from `research-reset` instead of re-implementing tmux/process cleanup.
- Kept reset semantics entity-specific: `research-reset` does not touch feature branches/worktrees and does not call `feature-reset`.
- Implemented workflow cleanup via engine API (`wf.resetResearch`) instead of manually deleting workflow paths inside CLI command logic.
- Treated reset as idempotent no-op where artifacts do not exist (files missing, spec already in backlog, absent engine state).
- For heartbeat cleanup safety, removed heartbeat files only for known research agents (derived from findings/state/snapshot), avoiding broad deletion by ID alone.
- Conversation summary: user asked whether implementation was already done mid-run; status was reported accurately and work proceeded through full implementation/validation.

## Code Review

**Reviewed by**: cc (Claude Code Opus)
**Date**: 2026-04-14

### Findings
- **Bug**: `research-reset` was added to `TRANSITION_ACTIONS` in `lib/workflow-snapshot-adapter.js`, but it is a destructive lifecycle action, not a state transition. `feature-reset` is correctly absent from `TRANSITION_ACTIONS`. Including `research-reset` there would classify it as `type:'transition'` with `to:null`, potentially confusing the frontend drag-drop system.

### Fixes Applied
- `63f2cc51` — fix(review): remove research-reset from TRANSITION_ACTIONS

### Notes
- Overall implementation is solid and well-structured. Good decisions around entity-specific cleanup, idempotency, and using the workflow-core API rather than hardcoding paths.
- All acceptance criteria are covered. Session teardown reuse via `createAllCommands()['sessions-close']` is heavier than the internal `closeSessionsForFeature` helper used by `feature-reset`, but `closeSessionsForFeature` is local to `feature.js` so this is the correct available path from `research.js`.
- Dashboard wiring (action candidate, confirmation dialog, danger styling, sort ranking) is complete and consistent with the `feature-reset` pattern.
