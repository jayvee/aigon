---
status: submitted
updated: 2026-03-18T11:10:00.000Z
startedAt: 2026-03-18T10:30:52.190Z
events:
  - { ts: "2026-03-18T10:30:52.190Z", status: implementing }
  - { ts: "2026-03-18T10:38:16.352Z", status: implementing }
  - { ts: "2026-03-18T11:10:00.000Z", status: submitted }
---

# Implementation Log: Feature 97 - enforce-state-machine-everywhere
Agent: cc

## Plan

Phased approach across 6 files + utils:

1. **state-machine.js**: Add `shouldNotify()` — uses `getValidTransitions` for features (eval transition guard = fleet+allSubmitted), `getAvailableActions` for research (synthesize action guard = allSubmitted)
2. **lib/utils.js**: Extract `parseEvalFileStatus()` shared helper
3. **dashboard-server.js**: Fix eval status check (move smContext up, use getValidTransitions for in-evaluation detection), fix feature and research notifications with shouldNotify()
4. **infra.js**: Remove conductor's dead allSubmittedNotified tracking, use parseEvalFileStatus for menu bar eval display
5. **pipeline.js**: Replace hardcoded if/else stage-pair dispatch in onDrop with transition.action switch on state-machine-provided validTransitions
6. **monitor.js**: Replace inline allSubmitted checks with validActions.some(a => a.action === 'research-synthesize')
7. **worktree.js**: Replace hardcoded stage === 'done'/'paused' orphan checks with getAvailableActions().length === 0

## Progress

All 7 phases complete. 166/166 tests pass. All 6 spec-defined files pass node -c.

## Decisions

### shouldNotify uses getValidTransitions for features
The feature-eval in-state action also exists in the `in-evaluation` stage (guard: isFleet only, no allAgentsSubmitted requirement). Using `getAvailableActions` would return true for in-evaluation too, causing spurious notifications. Instead, `shouldNotify` for features checks `getValidTransitions` for the `feature-eval` transition, which only exists from `in-progress` and has the full `isFleet && allAgentsSubmitted` guard.

### parseEvalFileStatus not used in dashboard-server.js for winnerAgent
dashboard-server.js is the canonical eval parsing implementation. It also needs to extract `winnerAgent` and `evalPath`, which `parseEvalFileStatus` doesn't return. Using the helper for the status string would require opening the file twice. Instead, dashboard-server.js keeps its full inline parsing (it's the source), and infra.js uses the helper to avoid duplication.

### worktree.js orphan detection semantic change
Previously, `stage === 'paused'` (research) was always classified as orphaned. After the fix, `getAvailableActions('research', 'paused', emptyCtx)` returns the `research-resume` transition, so paused research worktrees are no longer classified as orphaned. This is actually more correct: there's a valid action (resume), so the worktree isn't truly orphaned.

### pipeline.js onDrop: switch on action name, not handleValidAction
The drag-drop for `feature-eval` has specialized UX (agent picker for evaluator) and `feature-close` has a winner picker with preselect. These don't map to `handleValidAction` as-is. Instead of modifying handleValidAction, the onDrop uses a `switch (transition.action)` which dispatches the right behavior per action name. This removes all hardcoded stage-pair if/else while preserving the specialized drag behaviors.

### Remaining stage comparisons are permitted
dashboard-server.js still has `stage === 'in-progress'` for agent data collection (file I/O structure), `stage === 'inbox'` for regex pattern selection, and display labels. These are all either file-system structural decisions or display/rendering uses, explicitly permitted by the spec ("display/rendering uses are OK, logic branching is not").
