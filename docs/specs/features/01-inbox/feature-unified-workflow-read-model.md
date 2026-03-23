# Feature: unified-workflow-read-model

## Summary

Create a single authoritative workflow read layer that returns current stage, agent states, valid actions, and recommended actions for a feature. The dashboard, board, and command surfaces should consume this shared read model instead of independently reconstructing workflow state and action availability from folders, tmux sessions, logs, and ad hoc heuristics.

## User Stories

- As a maintainer, I want one workflow read path so action logic does not drift between dashboard, board, and command code.
- As a user, I want the dashboard and board to agree on what the next valid actions are.
- As an AI agent working in the codebase, I want workflow state and available actions to be discoverable from one module instead of scattered across multiple files.

## Acceptance Criteria

- A shared workflow read module exists and is used by at least the dashboard and board layers.
- The shared read model returns:
  - current stage
  - per-agent status
  - valid actions
  - recommended action(s)
- Dashboard-specific and board-specific workflow/action heuristics are reduced or removed in favor of the shared module.
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

- Compare a feature’s available actions in the dashboard and board views.
- Verify they come from the same underlying workflow read path and remain consistent across stages.

## Technical Approach

- Introduce a module such as `lib/workflow-read-model.js` or equivalent.
- Move shared logic for:
  - current feature stage
  - agent discovery/status resolution
  - valid actions
  - recommended actions
  into that module.
- Make the dashboard consume the shared read model instead of duplicating action derivation.
- Make the board consume the shared read model instead of using its own stage/worktree heuristics for next actions.
- Keep this refactor compatible with the current state machine and manifest system as an incremental stabilization step.

## Dependencies

- Should align with `lib/state-machine.js` and existing manifest reads.
- Pairs well with making dashboard reads side-effect free.

## Out of Scope

- Full workflow-engine replacement.
- Full XState migration.
- Redesigning feature lifecycle semantics.

## Open Questions

- Should command surfaces also use the shared read model immediately, or should this start with dashboard and board only?
- Should “recommended action” remain a simple priority ordering, or become a richer policy layer later?

## Related

- `lib/board.js`
- `lib/dashboard-server.js`
- `lib/state-machine.js`
- `docs/architecture.md`

