# Feature: dashboard-read-only-workflow-state

## Summary

Make the dashboard strictly read-only with respect to workflow state. Dashboard polling and status collection must never mutate manifests, agent status files, or any other workflow truth. Any status transitions currently inferred during reads should instead happen through explicit commands, signals, or an optional background orchestrator/coordinator process.

## User Stories

- As a user running the dashboard, I want page refreshes and polling to be side-effect free so that viewing state does not change workflow behavior.
- As a maintainer, I want dashboard reads to be deterministic so race conditions and hidden state transitions are reduced.
- As an AI agent working on the codebase, I want workflow writes to happen in obvious places so the system is easier to reason about and modify safely.

## Acceptance Criteria

- Dashboard polling paths do not write agent status, manifests, or other workflow state files.
- `collectDashboardStatusData()` and related helpers are side-effect free.
- Any current write-on-read behavior is moved behind an explicit command, signal, or optional background operator process.
- Existing dashboard status views continue to render useful diagnostics even after write-on-read behavior is removed.
- Tests cover the key regression: loading or refreshing the dashboard does not mutate workflow state.

## Validation

```bash
npm test
node -c aigon-cli.js
node -c lib/dashboard-server.js
```

Manual validation:

- Start the dashboard against a repo with an in-progress feature.
- Refresh the dashboard repeatedly.
- Verify no workflow state files change unless an explicit action is triggered.

## Technical Approach

- Audit `lib/dashboard-server.js` for any write-on-read behavior, especially in polling/status collection helpers.
- Remove direct state writes from dashboard read paths.
- Preserve diagnostic detection, but return it as read-only status data rather than persisting it.
- If needed, introduce a small explicit command or signal path for transitions that were previously inferred during polling.
- Keep the dashboard as a view/controller layer rather than a workflow authority.

## Dependencies

- May depend on a shared workflow read model if one is introduced in parallel.
- Should align with existing manifest/state-machine usage rather than inventing a second state source.

## Out of Scope

- Full XState migration.
- Redesigning the dashboard UI.
- Replacing the current workflow engine.

## Open Questions

- Should any inferred session-loss or timeout behavior move to the existing conductor/background process, or should it remain fully manual until the new engine exists?
- Do we want an explicit `aigon workflow-reconcile` style command for one-off repair/recovery?

## Related

- `lib/dashboard-server.js`
- `lib/state-machine.js`
- `docs/architecture.md`

