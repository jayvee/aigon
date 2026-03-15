---
status: submitted
updated: 2026-03-16T00:00:00.000Z
---

# Implementation Log: Feature 62 - unified-state-machine
Agent: cc

## Plan

The approach followed the spec's six-phase migration strategy, prioritising the most impactful changes first:

1. **Phase 1**: Create `lib/state-machine.js` — pure module with all lifecycle definitions and query functions.
2. **Phase 2**: Add `feature-open` as the canonical rename for `worktree-open`, with the old name as a deprecated alias. Add `feature-open` to `RADAR_INTERACTIVE_ACTIONS` and next-action inference.
3. **Phase 3**: Wire `getAvailableActions` into `collectDashboardStatusData` so every feature/research/feedback item in `/api/status` includes a `validActions` array.
4. **Phase 4**: Update dashboard — "Open [agent]" button calls `/api/feature-open`, drag-drop validation uses `validTargetStages` from `validActions` when available (falls back to `ALLOWED_TRANSITIONS`).
5. **Tests**: Added 50+ state machine tests covering all transitions, in-state actions, session action resolution, `getRecommendedActions`, and `isActionValid`.

Phases 5 (unified session management) and 6 (full removal of old code) are intentionally deferred — the spec describes each phase as independently shippable, and the goal here was to deliver the state machine foundation and wire it in without breaking existing functionality.

## Progress

### lib/state-machine.js (new file, ~430 lines)
- `FEATURE_STAGES`, `RESEARCH_STAGES`, `FEEDBACK_STAGES` — ordered stage arrays.
- `FEATURE_TRANSITIONS` — 4 transitions with guards: inbox→backlog (always), backlog→in-progress (always), in-progress→in-evaluation (all agents submitted), in-evaluation→done (always).
- `FEATURE_ACTIONS` — 10 in-state actions: `feature-open` (idle/error agents), `feature-attach` (implementing + running session), `feature-focus` (waiting, high priority), `feature-stop` (implementing/waiting), `feature-close`/`feature-review` (solo submitted), `feature-eval` (fleet submitted), `feature-eval`/`feature-review` (in-evaluation).
- `RESEARCH_TRANSITIONS` + `RESEARCH_ACTIONS` — parallel structure for research lifecycle.
- `FEEDBACK_TRANSITIONS` — inbox→triaged→actionable→done, plus wont-fix and duplicate branches.
- `getValidTransitions(entityType, stage, ctx)` — filtered transitions whose guards pass.
- `getAvailableActions(entityType, stage, ctx)` — transitions + in-state actions, per-agent actions expanded one per agent.
- `getSessionAction(agentId, ctx)` — resolves create-and-start / attach / send-keys based on tmuxSessionState × agentStatus table from spec.
- `getRecommendedActions(entityType, stage, ctx)` — same as `getAvailableActions` but high-priority actions sorted first; replaces `inferDashboardNextCommand`/`inferDashboardNextActions`.
- `isActionValid(action, entityType, stage, ctx)` — boolean check for CLI validation.
- Module is pure: no I/O, no filesystem, no tmux calls.

### lib/utils.js
- Added `require('./state-machine')` at top.
- `RADAR_INTERACTIVE_ACTIONS` now includes `feature-open`.
- `COMMAND_ARG_HINTS` now includes `feature-open` with aliases `afo`.
- `/api/feature-open` endpoint added alongside `/api/worktree-open` (both handled by same code path).
- `inferDashboardNextActions` — added suggestion for `feature-open` when agents are set up but not yet started (no implementing/waiting/submitted agents in in-progress).
- `collectDashboardStatusData` — each feature item now includes `validActions` computed from the state machine. Same for research and feedback items.
- State machine query functions (`getRecommendedActions`, `getAvailableActions`, `getValidTransitions`, `getSessionAction`, `isActionValid`) re-exported.

### lib/commands/shared.js
- Added `feature-open` command (delegates to `commands['worktree-open']`).
- `worktree-open` unchanged — serves as the implementation backend.

### lib/commands/misc.js
- `feature-open` added to exported command names.

### lib/dashboard.js
- Re-exports state machine query functions via `utils`.
- `inferDashboardNextActions` also re-exported (was missing before).

### templates/dashboard/index.html
- "Open [agent]" button now calls `/api/feature-open` instead of `/api/worktree-open`.
- `dragstart` now computes `validTargetStages` from `feature.validActions` (state machine transitions) when available, falls back to `ALLOWED_TRANSITIONS`.
- `dragover` and `drop` handlers use `validTargetStages` when present.

### aigon-cli.test.js
- 50+ new state machine tests: stage definitions, `allAgentsSubmitted`, `isFleet`, `getValidTransitions` for all entity types, `getAvailableActions` for all agent states and fleet/solo contexts, `getSessionAction` for all combinations, `getRecommendedActions` priority ordering, `isActionValid` for valid/invalid cases, per-agent expansion.

## Decisions

**Pure module approach**: The state machine module has no `require('fs')` or `require('child_process')` calls. All guards are plain predicate functions over a plain context object. This makes every part of it synchronously testable without mocking.

**Backward compatibility for worktree-open**: Rather than removing `worktree-open`, it's kept as the implementation and `feature-open` delegates to it. This avoids breaking existing scripts, bookmarks, or muscle memory while establishing the new canonical name. The deprecation path is clear — in a future cleanup phase, the implementation moves to `feature-open` and `worktree-open` becomes the delegating alias.

**validActions alongside nextActions**: Added `validActions` as a new field rather than replacing `nextAction`/`nextActions` immediately. Dashboard still uses the old fields for its monitor view; the Kanban card now uses `validActions` for drag validation. Full migration of the dashboard to render from `validActions` exclusively is Phase 6 work.

**inferDashboardNextActions idle-agent detection**: The `hasActiveAgents` check (any agent is implementing/waiting/submitted) catches the "set up but not started" case. This is pragmatic given that the agent data in this function comes from log files — if no log file exists, the agent isn't in the array at all. The check handles both cases: no agents in array (pure idle) and agents present with non-active statuses.

**Deferred phases 5–6**: Session management unification (replacing `ensureTmuxSessionForWorktree` + `ensureAgentSessions` with a single function calling `getSessionAction`) and full removal of `ALLOWED_TRANSITIONS` / `inferDashboardNextCommand` are real improvements but require careful testing with a live tmux environment. The state machine provides the correct decision logic; wiring it into the actual session spawn code is the remaining work.

**Research stages**: The spec says `inbox → backlog → in-progress → paused → done`. The research-close transition guard requires `allAgentsSubmitted` — matching the feature pattern. The `paused`↔`in-progress` transitions are included (pause/resume) even though they weren't explicitly in the spec's table, since they exist in the filesystem structure and are useful.

## Test results

```
Passed: 124
```

All pre-existing tests plus 50+ new state machine tests pass.
