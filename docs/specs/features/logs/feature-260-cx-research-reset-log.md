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
