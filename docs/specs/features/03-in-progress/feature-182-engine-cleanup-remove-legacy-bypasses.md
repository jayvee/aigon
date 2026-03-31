# Feature: Engine Cleanup — Remove Legacy Bypasses

## Summary

After features 178 (unified engine) and 179 (subtraction sprint), several legacy code paths still bypass the workflow engine: `entitySubmit()` writes status files directly instead of emitting events, `feature-close` reads raw events instead of using `showFeatureOrNull()`, the dashboard imports `writeAgentStatusAt` it no longer calls, `state-queries.js` still exports feature/research action logic that's no longer consumed for those entity types, and `worktree.js` calls `state-queries` where it should check the engine. This feature removes every remaining bypass so the engine is actually the single authority it was designed to be.

## User Stories

- [ ] As a developer, I want every agent status change to appear in the workflow event log so I can trace what happened
- [ ] As a developer, I want dead code removed so the codebase is smaller and easier to understand

## Acceptance Criteria

### 1. entitySubmit emits a workflow event
- [ ] `entity.js` line 754: add `wf.emitSignal()` call for `signal.agent_submitted` before the existing `writeAgentStatus` (keep the write as a derived cache for shell traps)
- [ ] `workflow-core/projector.js`: handle `signal.agent_submitted` event — sets `agents[agentId].status = 'ready'`

### 2. feature-close uses engine API, not raw events
- [ ] `feature.js` lines 1768-1770: replace `readEvents()` + `projectContext()` with `wf.showFeatureOrNull()` to check if already closed/closing
- [ ] `feature.js` lines 2110-2111: replace `readEvents()` check with `wf.showFeatureOrNull()` — if null, run migration; if not null, use the snapshot

### 3. Remove dead imports
- [ ] `dashboard-server.js` line 47: remove `writeAgentStatusAt` import (imported but never called after 179)

### 4. Strip state-queries.js of feature/research action logic
- [ ] Remove feature and research cases from `getAvailableActions()` — keep feedback only
- [ ] Remove feature and research cases from `getValidTransitions()` — keep feedback only
- [ ] Delete any functions that become unreferenced after this removal
- [ ] `worktree.js` line 439: replace `stateMachine.getAvailableActions()` call with engine snapshot check (read snapshot, check if lifecycle is terminal)
- [ ] Clean up re-exports in `lib/utils.js` and `lib/dashboard.js` if no remaining callers need them for features/research

### 5. Net line count goes down
- [ ] Total lines in `lib/` after this feature is lower than before

## Validation

These commands must all pass. The implementing agent MUST run every one of these before submitting. If any fail, the implementation is not done.

```bash
# Syntax checks on every modified file
node -c aigon-cli.js
node -c lib/commands/feature.js
node -c lib/entity.js
node -c lib/dashboard-server.js
node -c lib/state-queries.js
node -c lib/worktree.js
node -c lib/workflow-core/projector.js

# Verify entitySubmit now emits a workflow event
grep -q 'emitSignal\|emitResearchSignal' lib/entity.js || { echo "FAIL: entitySubmit must emit a workflow event"; exit 1; }

# Verify no raw event reads in feature commands
if grep -q 'readEvents\|projectContext' lib/commands/feature.js; then echo "FAIL: feature.js still bypasses engine with readEvents/projectContext"; exit 1; fi

# Verify dead import is gone
if grep -q 'writeAgentStatusAt' lib/dashboard-server.js; then echo "FAIL: dead writeAgentStatusAt import still in dashboard-server.js"; exit 1; fi

# Verify state-queries has no feature/research action derivation
if grep -q "entityType.*===.*'feature'" lib/state-queries.js; then echo "FAIL: state-queries.js still has feature action logic"; exit 1; fi
if grep -q "entityType.*===.*'research'" lib/state-queries.js; then echo "FAIL: state-queries.js still has research action logic"; exit 1; fi

# Verify projector handles the new event
grep -q 'agent_submitted\|agent-submitted' lib/workflow-core/projector.js || { echo "FAIL: projector must handle signal.agent_submitted"; exit 1; }

# Net reduction check
echo "Line counts (verify reduction against pre-feature baseline):"
wc -l lib/state-queries.js lib/entity.js lib/commands/feature.js lib/dashboard-server.js lib/worktree.js
```

## Technical Approach

Each change is a few lines replaced or deleted. No new files. No new abstractions. No new tests.

### Change 1: entitySubmit (entity.js)

Add a workflow event emission before the existing status file write. The status file write stays as a derived cache for shell traps.

### Change 2: feature-close engine bypass (feature.js)

Replace `readEvents()` + `projectContext()` at two locations with `showFeatureOrNull()`. The snapshot provides the same `currentSpecState` / `lifecycle` field the projected context did.

### Change 3: Dead import (dashboard-server.js)

Delete the `writeAgentStatusAt` import line.

### Change 4: state-queries.js

Delete the feature/research branches from `getAvailableActions()` and `getValidTransitions()`. For `worktree.js`, replace the `stateMachine.getAvailableActions()` call with a snapshot read — if snapshot exists and lifecycle is terminal, return no actions.

## Dependencies

- depends_on: unified-workflow-engine (178, done)
- depends_on: single-source-of-truth-for-agent-status (179, done)

## Out of Scope

- Feedback workflow (stays on state-queries)
- Removing agent status files entirely (they're a derived cache for shell traps)
- Dashboard visual changes
- New features or capabilities

## Open Questions

- None — scope is fully defined by the grep checks in Validation

## Related

- Feature 178: Unified Workflow Engine (done)
- Feature 179: Complete the Engine Migration (done)
