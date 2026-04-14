# Feature: dashboard-feature-push-action

## Summary
Add a "Push" action to the feature card overflow dropdown (⋯) on the Aigon dashboard. When clicked, it runs `aigon feature-push <ID>` for that feature, pushing the worktree branch to origin. This saves the user from attaching to the tmux session just to push — a common step before creating a PR or checking PR status.

## User Stories
- [ ] As a user who has finished implementation, I want to push the feature branch from the dashboard card so I don't have to switch to the terminal and find the right tmux session.
- [ ] As a user about to check PR status on a feature card, I want a quick way to push first so the PR status endpoint has something to query.

## Acceptance Criteria
- [ ] A "Push" button appears in the overflow dropdown (⋯) for features in the `implementing` lifecycle state when at least one agent has status `submitted` or `ready`.
- [ ] "Push" does NOT appear for features in `backlog`, `paused`, `done`, or other non-implementing states.
- [ ] Clicking "Push" shows a confirmation dialog: "Push feature branch to origin?" with confirm/cancel buttons. This is not destructive-styled (no red/danger) — it's a caution confirmation since the action is visible to others.
- [ ] On confirm, the dashboard dispatches `feature-push <ID>` via the existing `/api/action` endpoint.
- [ ] The server resolves the correct feature branch and worktree path, runs the push from the main repo context (using `resolveCloseTarget` delegation, same as the CLI).
- [ ] On success, the dashboard shows a brief success toast or inline feedback ("Pushed to origin").
- [ ] On failure (no remote, push rejected, etc.), the dashboard shows the error message inline.
- [ ] For Fleet mode features with multiple agents, the push targets all worktree branches (same as `feature-push <ID>` CLI behavior).
- [ ] The Push button is disabled while a push is in flight (prevents double-push).
- [ ] The action does not change workflow engine state — it is a `bypassMachine` infra action, not a lifecycle transition.

## Validation
```bash
node -c lib/feature-workflow-rules.js
node -c lib/workflow-core/types.js
node -c lib/dashboard-server.js
npm test
```

## Technical Approach

### Action registry (backend)

1. Add `FEATURE_PUSH: 'feature-push'` to `ManualActionKind` in `lib/workflow-core/types.js`.
2. Add a candidate to `FEATURE_ACTION_CANDIDATES` in `lib/feature-workflow-rules.js`:
   ```js
   {
       kind: ManualActionKind.FEATURE_PUSH,
       label: 'Push',
       eventType: null,
       recommendedOrder: 35, // before Pause (40), after session actions
       bypassMachine: true,
       category: 'lifecycle',
       guard: ({ context }) => {
           // Only in implementing state, and at least one agent is ready/submitted
           if (context.currentSpecState !== 'implementing') return false;
           const agents = Object.values(context.agents || {});
           return agents.some(a => a.status === 'ready' || a.status === 'submitted');
       },
       metadata: {
           confirmationMessage: 'Push feature branch to origin?',
       },
   }
   ```
3. Add `'feature-push'` to `DASHBOARD_INTERACTIVE_ACTIONS` in `lib/dashboard-server.js`.

### Dashboard dispatch (frontend)

4. In `templates/dashboard/js/actions.js`, add a `case 'feature-push'` in `handleFeatureAction`:
   - Show confirmation dialog (non-destructive style, using `metadata.confirmationMessage`).
   - On confirm, call `requestAction('feature-push', [id], repoPath, btn)`.
   - Disable button while in flight.

### Server execution

5. The existing `/api/action` → `runDashboardInteractiveAction()` path handles this. `feature-push <ID>` runs from the main repo cwd. The CLI's `feature-push` handler already supports being called from main repo with an ID argument — it uses `resolveCloseTarget` to find the right branch.

### Scope

The action scope in `action-scope.js` is already `'feature-local'`, but for dashboard dispatch it runs from main repo with the ID argument. This is the same pattern as `feature-close` and `feature-reset` — the CLI resolves the target internally.

## Dependencies
- None (all infrastructure already exists)

## Out of Scope
- Per-agent push selection in Fleet mode (CLI handles this — push targets all branches)
- Auto-push after implementation completes (would be a separate feature)
- PR creation from dashboard (future feature)
- Changing the action scope from `feature-local` (CLI already handles delegation from main repo)

## Open Questions
- None.

## Related
- Feature: `feature-github-pr-status-ui` (push is a natural precursor to checking PR status)
- Feature: `feature-github-pr-status-endpoint` (needs pushed branch to query)
