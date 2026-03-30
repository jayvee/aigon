# Feature: Single Source of Truth for Agent Status

## Summary

Agent status is currently stored in two independent locations: the workflow engine snapshot (`context.agents[agentId].status`) and agent status files (`.aigon/state/{prefix}-{id}-{agent}.json`). These are updated by different code paths and can drift apart. This feature makes the workflow engine snapshot the single authority for agent status, with status files becoming a derived cache written as a side-effect of snapshot updates.

The main architectural goal is to make agent runtime state explainable: one authority, one event history, one reconciliation model, and zero ambiguity about whether a status file is authoritative or just cached output.

## User Stories

- [ ] As a developer, I want one place to check agent status so I don't have to wonder which source is correct
- [ ] As a user, I want `feature-submit` and `research-submit` to update the workflow engine so the dashboard reflects the change immediately
- [ ] As a user, I want dashboard flag actions to flow through the workflow engine so they're auditable in the event log
- [ ] As a maintainer, I want stale status files and shell-written flags to reconcile cleanly so external tooling does not silently override engine truth

## Acceptance Criteria

- [ ] `entitySubmit()` emits a workflow event (`signal.agent_submitted`) instead of directly writing a status file
- [ ] Research autopilot reads agent status from the engine snapshot, not from `.aigon/state/` files
- [ ] Agent status files are written as a derived side-effect after each snapshot update (read-through cache for external tools and shell trap handlers)
- [ ] Dashboard `/api/agent-flag-action` emits a workflow event instead of mutating a status file directly
- [ ] Dashboard `/api/spec` PUT endpoint is removed or routed through a CLI command (no direct spec mutation from dashboard)
- [ ] `readAgentStatus()` prefers snapshot data when a workflow exists and only falls back to the status file for pre-workflow entities or cache-only consumers
- [ ] All agent status transitions appear in the workflow event log
- [ ] The cache contract is documented clearly: engine snapshot is authoritative, `.aigon/state/` is derived and may be regenerated
- [ ] Reconciliation behavior is explicit for shell trap writes, stale status files, and missing cache files
- [ ] `node -c aigon-cli.js` passes
- [ ] No regressions in feature-submit, research-submit, dashboard agent display
- [ ] The end state is structurally simpler than the start state: one authority for agent status, fewer direct status-file mutation paths, and superseded status-reconciliation branches deleted or clearly marked as temporary migration logic

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

Define the cache contract explicitly:
- Snapshot/event log are authoritative
- Status files are derived cache plus a temporary ingestion surface for shell traps
- Engine reconciliation must be idempotent and must not let stale cache overwrite newer engine state

### 4. Dashboard mutations → workflow events

- `/api/agent-flag-action`: Instead of `writeAgentStatus()`, emit a workflow event (`signal.agent_flagged` or similar) that the projector records
- `/api/spec` PUT: Remove this endpoint. Spec editing should happen through the CLI or editor, not the dashboard

### 5. Simplify `readAgentStatus()`

Make it check the workflow snapshot first, fall back to the status file only if no snapshot exists (pre-workflow entities). This handles the transition period where old entities may not have snapshots.

### 6. Clarify reconciliation rules

Document and implement how shell trap writes, lost sessions, `needs_attention`, and other runtime signals enter the engine. The system should prefer direct workflow events where possible and reserve status-file reconciliation for cases where the engine is not directly reachable.

### Key files to modify:

- `lib/workflow-core/projector.js` — handle `signal.agent_submitted` event
- `lib/workflow-core/engine.js` — write derived status files after `persistEvents()`
- `lib/entity.js` — `entitySubmit()` calls engine instead of writing files
- `lib/agent-status.js` — `readAgentStatus()` prefers snapshot data
- `lib/commands/research.js` — research autopilot reads from snapshot
- `lib/dashboard-server.js` — remove `/api/spec` PUT, change `/api/agent-flag-action` to emit events
- `lib/dashboard-status-collector.js` — read agent status from snapshots only
- `docs/architecture.md` — document status authority vs cache behavior

## Dependencies

- depends_on: unified-workflow-engine

## Out of Scope

- Removing agent status files entirely (they serve as a cache for shell scripts and external tools)
- Replacing every shell trap integration in one pass
- Action derivation changes (that's Feature 3)

## Open Questions

- Should the shell trap handler (`trap EXIT`) emit a workflow event directly, or continue writing status files that the engine reconciles on next read?
- What's the migration path for existing entities that have status files but no workflow snapshots?
- Which runtime-only flags belong in the snapshot vs in a separate derived field set for UI hints?

## Related

- Feature: Unified Workflow Engine (prerequisite)
- Feature: Backend-Driven Action Derivation (depends on this)
