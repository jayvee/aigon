# Feature: dashboard-read-only-workflow-state

## Summary

Make the dashboard strictly read-only with respect to workflow state. The recent feature/research unification removed a lot of workflow drift, but dashboard polling still mutates state by persisting inferred session-ended flags during `collectDashboardStatusData()`. Viewing the dashboard must not write manifests, agent status files, or any other workflow truth. Any inferred transitions should happen through explicit commands, signals, or an optional background reconciler.

## User Stories

- As a user running the dashboard, I want page refreshes and polling to be side-effect free so that viewing state does not change workflow behavior.
- As a maintainer, I want dashboard reads to be deterministic so race conditions and hidden state transitions are reduced.
- As an AI agent working on the codebase, I want workflow writes to happen in obvious places so the system is easier to reason about and modify safely.

## Acceptance Criteria

- Dashboard polling paths do not write agent status, manifests, or other workflow state files.
- `collectDashboardStatusData()` and related helpers are side-effect free.
- `lib/dashboard-server.js` no longer calls `writeAgentStatusAt()` from dashboard read/polling code.
- Any current write-on-read behavior is moved behind an explicit command, signal, or optional background operator process.
- Existing dashboard status views continue to render useful diagnostics even after write-on-read behavior is removed.
- Tests cover the key regression: loading or refreshing the dashboard does not mutate workflow state for either features or research.

## Validation

```bash
npm test
node -c aigon-cli.js
node -c lib/dashboard-server.js
```

Manual validation:

- Start the dashboard against a repo with an in-progress feature and an in-progress research item.
- Refresh the dashboard repeatedly.
- Verify no workflow state files change unless an explicit action is triggered.

## Technical Approach

- Audit `lib/dashboard-server.js` for any write-on-read behavior, especially `maybeFlagEndedSession()` inside `collectDashboardStatusData()`.
- Remove direct state writes from dashboard read paths and keep any "session appears to have ended" result as derived response data only.
- Preserve diagnostic detection, but return it as ephemeral read-only status data rather than persisting it.
- If reconciled flags are still useful, move them behind an explicit repair/reconcile command or a background coordinator loop rather than the dashboard poller.
- Keep the dashboard as a view/controller layer rather than a workflow authority.

## Dependencies

- Should align with the unified entity/state-machine work already landed in `lib/entity.js` and `lib/state-machine.js`.
- May depend on a shared workflow read model if one is introduced in parallel.

## Out of Scope

- Full XState migration.
- Redesigning the dashboard UI.
- Replacing the current workflow engine.

## Open Questions

- Should inferred session-loss or timeout behavior move to the existing conductor/background process, or should it remain fully manual until an explicit reconcile path exists?
- Do we want an explicit `aigon workflow-reconcile` style command for one-off repair/recovery?

## Related

- `lib/dashboard-server.js`
- `lib/state-machine.js`
- `docs/architecture.md`
