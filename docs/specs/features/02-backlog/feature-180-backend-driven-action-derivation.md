# Feature: Backend-Driven Action Derivation

## Summary

Actions ("what can you do next?") are currently computed independently in three places: `workflow-core/actions.js` (from XState snapshot), `state-queries.js` (its own guard system), and the frontend `actions.js` (UI-specific ranking/promotion logic). This means business rule changes require updating three files, and the frontend can show actions the engine would reject. This feature consolidates action derivation so the workflow engine is the single authority, the backend response includes UI ranking, and the frontend renders what it receives.

This feature also adds integrity and observability around action derivation so drift becomes detectable, testable, and explainable instead of being discovered only when the UI looks wrong.

## User Stories

- [ ] As a developer, I want to change an action rule in one place and have it apply everywhere — CLI board, dashboard monitor, and dashboard detail view
- [ ] As a user, I want the dashboard to never show me an action that would fail if I clicked it
- [ ] As a developer, I want the backend to tell the frontend which action is primary so I don't maintain ranking logic in two places
- [ ] As a maintainer, I want tooling that can explain why an action is shown or hidden so workflow rule changes are debuggable

## Acceptance Criteria

- [ ] `state-queries.js` action derivation is removed for features and research (retained only for feedback which doesn't use the workflow engine)
- [ ] `workflow-core/actions.js` `deriveAvailableActions()` returns actions with a `tier` field: `'primary'` | `'secondary'` | `'overflow'`
- [ ] Backend API response includes `primaryAction`, `secondaryActions`, `overflowActions` — pre-ranked
- [ ] Frontend `actions.js` `buildFeatureActions()` is removed — the frontend renders the backend's ranking directly
- [ ] `formatDashboardActionCommand()` and `formatBoardActionCommand()` unified into a single `formatActionCommand()` function
- [ ] The "no snapshot" fallback path is eliminated (Feature 1 ensures all entities have snapshots)
- [ ] Dashboard monitor and detail views show identical action sets for the same entity
- [ ] A verification surface exists that asserts parity between engine actions, dashboard actions, and board commands for fixture states
- [ ] Unknown or unmapped action guards/config fail loudly in tests rather than silently defaulting to permissive behavior
- [ ] A debugging surface exists to inspect why a given action is shown, hidden, or ranked where it is
- [ ] `node -c aigon-cli.js` passes
- [ ] Board view (`aigon board`) shows correct actions derived from the engine
- [ ] The end state is structurally simpler than the start state: one action-derivation path for feature/research workflow entities, fewer formatter/ranking codepaths, and superseded fallback logic removed rather than preserved in parallel

## Validation

```bash
node -c aigon-cli.js
node -c lib/workflow-core/actions.js
node -c lib/state-queries.js
node -c lib/action-command-mapper.js
node --test tests/unit/workflow-snapshot-adapter.test.js tests/unit/dashboard-server.test.js
```

## Technical Approach

### 1. Extend `deriveAvailableActions()` with UI ranking

Add tier assignment to `workflow-core/actions.js`. The ranking rules currently in the frontend's `buildFeatureActions()` move here:
- Close action promoted to `primary` when winner is selected
- Eval/review promoted when all agents are ready
- Stop/drop actions always `overflow`
- Default: first valid lifecycle action is `primary`, rest are `secondary`

### 2. Backend response format

The dashboard API (`/api/status` and `/api/detail`) returns:

```js
{
  primaryAction: { action: 'feature-close', command: 'aigon feature-close 178', label: 'Close' },
  secondaryActions: [...],
  overflowActions: [...],
}
```

### 3. Unify command formatters

Merge `formatDashboardActionCommand()` and `formatBoardActionCommand()` from `action-command-mapper.js` into a single `formatActionCommand(action, entityId, context)`. The inconsistency between dashboard (`feature-open 01`) and board (`feature-do 01` for solo) should be resolved — use the same command string everywhere.

### 4. Strip frontend action logic

Remove `buildFeatureActions()`, tier promotion/demotion, and modal-trigger logic from `templates/dashboard/js/actions.js`. The frontend reads `primaryAction` / `secondaryActions` / `overflowActions` from the API response and renders buttons directly.

### 5. Remove state-queries.js action derivation for features/research

Delete `getAvailableActions()` cases for features and research from `state-queries.js`. Keep it for feedback only (which doesn't use the workflow engine). The `getValidTransitions()` function can also be simplified.

### 6. Remove the "no snapshot" fallback

With Feature 1 complete, all features and research have workflow snapshots. The fallback path in `workflow-snapshot-adapter.js` (lines 125, 172 — "if no snapshot, use state-queries") is dead code and can be removed.

### 7. Add integrity checks

Add a verification path, ideally usable in CI, that compares action derivation across:
- engine `deriveAvailableActions()`
- snapshot adapter output
- dashboard API payload
- board command formatting

This is where bugs like missing guards or mismatched command formatters should fail fast.

### 8. Add observability for action decisions

Add a debugging surface such as `aigon workflow-inspect <entity> <id>` or equivalent backend detail output that explains:
- current lifecycle state
- agent/runtime inputs considered during derivation
- available actions before ranking
- final ranking and command mapping

### Key files to modify:

- `lib/workflow-core/actions.js` — add tier assignment to `deriveAvailableActions()`
- `lib/action-command-mapper.js` — merge two formatters into one
- `lib/state-queries.js` — remove feature/research action logic (keep feedback only)
- `lib/workflow-snapshot-adapter.js` — remove "no snapshot" fallback path
- `lib/dashboard-status-collector.js` — pass through ranked actions from engine
- `lib/dashboard-server.js` — return ranked action structure in API
- `tests/unit/workflow-snapshot-adapter.test.js` — parity and ranking coverage
- `tests/unit/dashboard-server.test.js` — API action consistency coverage
- `templates/dashboard/js/actions.js` — remove `buildFeatureActions()`, render backend response directly
- `templates/dashboard/index.html` — update action button rendering to use new structure

## Dependencies

- depends_on: unified-workflow-engine
- depends_on: single-source-of-truth-for-agent-status

## Out of Scope

- Feedback action derivation (stays in `state-queries.js` as-is)
- Dashboard visual redesign (just changing data flow, not UI layout)
- Adding new actions or changing which actions are valid (pure consolidation)
- Workflow engine migration for entities that do not yet have snapshots (handled by Feature 178)

## Open Questions

- Should the board view (`aigon board`) also use the engine's ranked actions verbatim, or derive a smaller presentation from the same ranked payload?
- Should the `tier` assignment be configurable per-entity or hardcoded in the engine?
- Should the action-inspection surface live as a CLI command, a dashboard detail panel, or both?

## Related

- Feature: Unified Workflow Engine (prerequisite)
- Feature: Single Source of Truth for Agent Status (prerequisite)
