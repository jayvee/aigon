# Feature: dashboard-read-from-workflow-snapshots

## Summary

Make the Aigon dashboard and board consume the new internal workflow snapshot/action model when available, instead of independently reconstructing workflow state and recommended actions from manifests, tmux, logs, and ad hoc heuristics. This is the first selective integration of the Aigon Next workflow core into Aigon.

## User Stories

- As a dashboard user, I want feature state and available actions to come from one coherent source.
- As a maintainer, I want dashboard and board action logic to stop drifting apart.
- As an AI agent changing the dashboard, I want a read-only snapshot model instead of hidden write-on-read behavior and duplicated inference logic.

## Acceptance Criteria

- The dashboard can read feature state and available actions from the new workflow snapshot model when present.
- The board can read next actions from the same snapshot/action model when present.
- Existing fallback behavior remains available for features that do not yet have new-engine workflow state.
- Dashboard reads remain side-effect free.
- Tests cover consistency of actions and state between dashboard/board consumers using the new snapshot model.

## Validation

```bash
npm test
node -c aigon-cli.js
node -c lib/dashboard-server.js
node -c lib/board.js
```

Manual validation:

- Run the dashboard against a repo with new-engine workflow state.
- Verify rendered actions and state match the workflow snapshot.
- Verify dashboard refresh does not mutate workflow state.

## Technical Approach

- Introduce a read adapter from Aigon dashboard/board code into the new `lib/workflow/` module.
- Prefer workflow snapshots/actions when present.
- Keep a compatibility fallback for legacy features with no new-engine state yet.
- Remove or reduce duplicated dashboard/board action inference where the new snapshot model is available.

## Dependencies

- Depends on importing the Aigon Next workflow core into Aigon first.
- Aligns with the stabilization work around read-only dashboard behavior and unified workflow read models.

## Out of Scope

- Replacing feature mutation commands
- Full workflow migration of all features
- Dashboard UI redesign

## Open Questions

- What is the cleanest bootstrap/projection step for legacy features that have no new-engine state yet?
- Should the dashboard visibly indicate whether a feature is being served by legacy logic or the new workflow snapshot?

## Related

- `lib/dashboard-server.js`
- `lib/board.js`
- `docs/specs/features/01-inbox/feature-dashboard-read-only-workflow-state.md`
- `docs/specs/features/01-inbox/feature-unified-workflow-read-model.md`

