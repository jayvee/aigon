# Feature: unified-workflow-read-model

## Summary

Create a single authoritative workflow read layer that returns current stage, agent states, valid actions, and recommended actions for workflow entities. The recent Claude work already unified much of the lifecycle logic in `lib/entity.js` and `lib/state-machine.js`, so this feature is no longer about unifying feature and research semantics. It is now about consolidating the remaining read-side duplication across the dashboard and board, which still reconstruct state and actions differently.

## User Stories

- As a maintainer, I want one workflow read path so action logic does not drift between dashboard, board, and command code.
- As a user, I want the dashboard and board to agree on what the next valid actions are.
- As an AI agent working in the codebase, I want workflow state and available actions to be discoverable from one module instead of scattered across multiple files and stale heuristics.

## Acceptance Criteria

- A shared workflow read module exists and is used by at least the dashboard and board layers.
- The shared read model returns:
  - current stage
  - per-agent status
  - valid actions
  - recommended action(s)
- Dashboard-specific and board-specific workflow/action heuristics are reduced or removed in favor of the shared module.
- The board no longer derives next actions from `getBoardAction()` heuristics or stale research folder assumptions.
- The shared read model supports both feature and research entities.
- The read model does not mutate workflow state.
- Tests cover consistency of available actions across consumers.

## Validation

```bash
npm test
node -c aigon-cli.js
node -c lib/dashboard-server.js
node -c lib/board.js
```

Manual validation:

- Compare a feature’s and a research item’s available actions in the dashboard and board views.
- Verify they come from the same underlying workflow read path and remain consistent across stages.

## Technical Approach

- Introduce a module such as `lib/workflow-read-model.js` or equivalent.
- Move shared logic for:
  - current entity stage
  - agent discovery/status resolution
  - valid actions
  - recommended actions
  - evaluation/session metadata where needed
  into that module.
- Make the dashboard consume the shared read model instead of duplicating action derivation in `inferDashboardNextActions()` and surrounding scan logic.
- Make the board consume the shared read model instead of using its own stage/worktree heuristics and hand-maintained folder mappings.
- Keep this refactor compatible with the current state machine and manifest system as an incremental stabilization step, not a second workflow redesign.

## Dependencies

- Should align with the unified lifecycle work in `lib/entity.js`, `lib/state-machine.js`, and existing manifest reads.
- Pairs well with making dashboard reads side-effect free.

## Out of Scope

- Re-doing the already-landed feature/research lifecycle unification.
- Full workflow-engine replacement.
- Full XState migration.

## Open Questions

- Should command surfaces also use the shared read model immediately, or should this start with dashboard and board only?
- Should “recommended action” remain a simple priority ordering, or become a richer policy layer later?
- Should this feature also absorb `.board-map.json` generation, or keep that as a thin UI convenience layer on top of the shared read model?

## Related

- `lib/board.js`
- `lib/dashboard-server.js`
- `lib/state-machine.js`
- `docs/architecture.md`
