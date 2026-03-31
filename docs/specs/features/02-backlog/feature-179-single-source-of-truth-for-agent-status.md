# Feature: Complete the Engine Migration (Subtraction Sprint)

## Summary

Feature 178 unified the workflow engine internals, but the layers above it — commands, dashboard, state-queries — still work the old way. The result is two systems running in parallel: the new engine plus the old code paths. This feature finishes the migration by wiring the engine's output to the dashboard and commands, then deleting the old paths. Success is measured by lines removed, not added.

## User Stories

- [ ] As a user, I want the dashboard to show actions that come from the workflow engine so clicking them never fails
- [ ] As a developer, I want one code path for "what actions are available" so I can change rules in one place
- [ ] As a user, I want `feature-submit` and `research-submit` to update the engine so the dashboard reflects changes immediately
- [ ] As a developer, I want fewer modules and less code to understand when debugging workflow issues

## Acceptance Criteria

### Wire engine actions to dashboard (replace state-queries for features/research)
- [ ] Dashboard reads available actions from engine snapshots (`snapshot.availableActions`), not from `state-queries.js`
- [ ] `state-queries.js` action derivation removed for features and research (kept only for feedback)
- [ ] The "no snapshot" fallback path in `workflow-snapshot-adapter.js` is removed
- [ ] `workflow-read-model.js` references to `stateMachine.getAvailableActions()` for features/research are removed
- [ ] Frontend `actions.js` `buildFeatureActions()` is removed — frontend renders what the backend sends

### Unify command formatting
- [ ] `formatDashboardActionCommand()` and `formatBoardActionCommand()` merged into single `formatActionCommand()`
- [ ] Dashboard and board show identical commands for the same action

### Stop bypassing the engine from commands
- [ ] `feature.js` no longer calls `readEvents()` + `projectContext()` directly — uses `showFeature()` / `showFeatureOrNull()`
- [ ] `entitySubmit()` emits a workflow event instead of directly writing a status file
- [ ] Research autopilot reads agent status from engine snapshot, not `.aigon/state/` files

### Remove dashboard mutations that bypass engine
- [ ] `/api/agent-flag-action` emits a workflow event instead of writing status files directly
- [ ] `/api/spec` PUT removed (specs edited through editor/CLI, not dashboard)

### Clean up
- [ ] Remove stale worktrees from previous features
- [ ] `node -c aigon-cli.js` passes
- [ ] Board view (`aigon board`) shows correct actions
- [ ] Net line count of `lib/` is lower after this feature than before

## Validation

```bash
node -c aigon-cli.js
node -c lib/workflow-core/actions.js
node -c lib/state-queries.js
node -c lib/action-command-mapper.js
node -c lib/dashboard-server.js
# Verify net reduction
echo "Target: fewer lines in lib/ than before this feature"
```

## Technical Approach

**Guiding principle: subtract, don't add.** No new modules. No new test files. No new abstractions. Wire existing engine output to existing consumers, then delete the old paths.

### Phase 1: Wire engine actions to dashboard

The engine already computes `availableActions` in every snapshot. The dashboard already receives snapshots. The gap is that `dashboard-status-collector.js` and `workflow-read-model.js` ignore the snapshot's actions and recompute them via `state-queries.js`.

1. In `workflow-read-model.js`: where it calls `stateMachine.getAvailableActions()` for features/research, replace with reading `snapshot.availableActions` directly
2. In `dashboard-status-collector.js`: same — use snapshot actions, not state-queries
3. Remove the "no snapshot" fallback in `workflow-snapshot-adapter.js` — feature 178 ensures all entities get snapshots via migration.js
4. In `state-queries.js`: delete the feature/research action cases. Keep feedback cases only. Delete any functions that are now unreferenced.
5. In frontend `actions.js`: remove `buildFeatureActions()` ranking logic. The backend already ranks actions in the snapshot's `availableActions` array — render them in order.

### Phase 2: Unify command formatting

1. Merge `formatDashboardActionCommand()` and `formatBoardActionCommand()` in `action-command-mapper.js` into one `formatActionCommand()`. Resolve the inconsistency (dashboard says `feature-open 01`, board says `feature-do 01` for solo) by picking one.
2. Update callers in `dashboard-status-collector.js`, `dashboard-server.js`, and board rendering.

### Phase 3: Stop command-layer engine bypass

1. In `feature.js` (line ~704): replace `wf.readEvents()` + `wf.projectContext()` with `wf.showFeatureOrNull()`. The engine already has this API.
2. In `entity.js` `entitySubmit()` (line 754): replace `writeAgentStatus()` with `wf.emitSignal()` to emit `signal.agent_submitted`. Add this event type to the projector (small change — sets agent status to 'ready').
3. In `research.js` autopilot (lines 552, 640, 686): replace `readAgentStatus()` calls with snapshot reads via `wf.showResearch()`.

### Phase 4: Remove dashboard direct mutations

1. `/api/agent-flag-action` in `dashboard-server.js` (line ~2508): replace `writeAgentStatusAt()` with a workflow event emission.
2. `/api/spec` PUT: delete the endpoint. Spec editing happens in the editor.

### Phase 5: Clean up

1. Remove the 6 stale worktrees: `git worktree prune` + manual cleanup
2. Remove any `require('./state-queries')` lines that are now dead
3. Verify `node -c` on all modified files
4. Count lines before and after — the number must go down

### Key files to modify (modify, not create):

- `lib/workflow-read-model.js` — use snapshot actions instead of state-queries
- `lib/dashboard-status-collector.js` — use snapshot actions
- `lib/workflow-snapshot-adapter.js` — remove fallback path
- `lib/state-queries.js` — strip feature/research action logic
- `lib/action-command-mapper.js` — merge two formatters
- `lib/dashboard-server.js` — remove /api/spec PUT, change flag action
- `lib/commands/feature.js` — use showFeatureOrNull() instead of raw events
- `lib/entity.js` — entitySubmit emits workflow event
- `lib/commands/research.js` — autopilot reads from snapshot
- `lib/workflow-core/projector.js` — handle signal.agent_submitted (small addition)
- `templates/dashboard/js/actions.js` — remove buildFeatureActions()

### Files to NOT create:

No new modules. No new test files. No migration.js additions. If something needs a new file, reconsider.

## Dependencies

- depends_on: unified-workflow-engine (feature 178, done)

## Out of Scope

- Feedback workflow (stays on state-queries as-is)
- New action types or changing which actions are valid
- Dashboard visual redesign
- Agent status file removal (they stay as a derived cache)
- Adding debugging/inspection commands (do that later if needed)
- Adding verification/parity test infrastructure (do that later if needed)

## Open Questions

- Should the engine's `availableActions` include the formatted command string, or should the dashboard format it? (Prefer: engine returns action kind + context, dashboard formats the command — keeps engine UI-unaware)

## Related

- Feature 178: Unified Workflow Engine (done, prerequisite)
