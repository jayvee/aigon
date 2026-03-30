# Feature: Single Source of Truth for Agent Status

## Summary

Agent status is currently stored in two independent locations: the workflow engine snapshot (`context.agents[agentId].status`) and agent status files (`.aigon/state/{prefix}-{id}-{agent}.json`). These are updated by different code paths and can drift apart. This feature makes the workflow engine snapshot the single authority for agent status, with status files becoming a derived cache written as a side-effect of snapshot updates.

## User Stories

- [ ] As a developer, I want one place to check agent status so I don't have to wonder which source is correct
- [ ] As a user, I want `feature-submit` and `research-submit` to update the workflow engine so the dashboard reflects the change immediately
- [ ] As a user, I want dashboard flag actions to flow through the workflow engine so they're auditable in the event log

## Acceptance Criteria

- [ ] `entitySubmit()` emits a workflow event (`signal.agent_submitted`) instead of directly writing a status file
- [ ] Research autopilot reads agent status from the engine snapshot, not from `.aigon/state/` files
- [ ] Agent status files are written as a derived side-effect after each snapshot update (read-through cache for external tools and shell trap handlers)
- [ ] Dashboard `/api/agent-flag-action` emits a workflow event instead of mutating a status file directly
- [ ] Dashboard `/api/spec` PUT endpoint is removed or routed through a CLI command (no direct spec mutation from dashboard)
- [ ] `readAgentStatus()` falls back to snapshot data when no status file exists
- [ ] All agent status transitions appear in the workflow event log
- [ ] `node -c aigon-cli.js` passes
- [ ] No regressions in feature-submit, research-submit, dashboard agent display

## Validation

```bash
node -c aigon-cli.js
node -c lib/agent-status.js
node -c lib/entity.js
```

## Technical Approach

### 1. New workflow event: `signal.agent_submitted`

Add to the projector: when `signal.agent_submitted` is received, set `agents[agentId].status = 'ready'` (submitted agents are ready for eval/review). The XState machine already handles agent status transitions via guards — this event fits the existing pattern.

### 2. Update `entitySubmit()` in `entity.js`

Replace the direct `writeAgentStatus()` call with a workflow engine call:
```js
// Before
writeAgentStatus(id, agentId, { status: 'submitted', flags: {} }, def.prefix);

// After
await wf.emitSignal(repoPath, entityId, 'agent-submitted', agentId);
```

### 3. Derived status file writes

After each `persistEvents()` call in the engine, write derived status files for any agents whose status changed. This keeps `.aigon/state/` files in sync for external tools (shell trap handlers, tmux scripts) that can't call the engine API.

### 4. Dashboard mutations → workflow events

- `/api/agent-flag-action`: Instead of `writeAgentStatus()`, emit a workflow event (`signal.agent_flagged` or similar) that the projector records
- `/api/spec` PUT: Remove this endpoint. Spec editing should happen through the CLI or editor, not the dashboard

### 5. Simplify `readAgentStatus()`

Make it check the workflow snapshot first, fall back to the status file only if no snapshot exists (pre-workflow entities). This handles the transition period where old entities may not have snapshots.

### Key files to modify:

- `lib/workflow-core/projector.js` — handle `signal.agent_submitted` event
- `lib/workflow-core/engine.js` — write derived status files after `persistEvents()`
- `lib/entity.js` — `entitySubmit()` calls engine instead of writing files
- `lib/agent-status.js` — `readAgentStatus()` prefers snapshot data
- `lib/commands/research.js` — research autopilot reads from snapshot
- `lib/dashboard-server.js` — remove `/api/spec` PUT, change `/api/agent-flag-action` to emit events
- `lib/dashboard-status-collector.js` — read agent status from snapshots only

## Dependencies

- depends_on: unified-workflow-engine

## Out of Scope

- Removing agent status files entirely (they serve as a cache for shell scripts and external tools)
- Changing the shell trap signal mechanism (it will continue to write status files, which the engine can reconcile)
- Action derivation changes (that's Feature 3)

## Open Questions

- Should the shell trap handler (`trap EXIT`) emit a workflow event directly, or continue writing status files that the engine reconciles on next read? Direct events are cleaner but require the engine to be available from a bash trap.
- What's the migration path for existing entities that have status files but no workflow snapshots?

## Related

- Feature: Unified Workflow Engine (prerequisite)
- Feature: Backend-Driven Action Derivation (depends on this)
