# Feature: github-create-pr-action

## Summary
Add a small GitHub utility action to the Aigon Pro dashboard that can create a pull request for the current feature branch on demand. This is intentionally narrow: it is a user-triggered convenience action for branch-to-PR handoff, not a full PR lifecycle manager. It should help users who already pushed a feature branch avoid dropping into a terminal just to run `gh pr create`.

## User Stories
- [ ] As a user who has finished implementation in a feature worktree, I want a simple “Create PR” action in Aigon so I can publish the branch review object without leaving the dashboard workflow.
- [ ] As a user who has already created a PR, I want the UI to avoid creating duplicates and instead show me the existing PR.
- [ ] As a user on a non-GitHub repo or a machine without working `gh`, I want the action to fail clearly and safely without affecting the feature state.

## Acceptance Criteria
- [ ] A feature with a pushed GitHub branch can expose a `Create PR` utility action in the feature card menu, detail drawer, or similar low-prominence UI.
- [ ] The action is only available when the repo `origin` is GitHub and the feature branch exists remotely.
- [ ] Triggering the action performs a one-shot PR creation attempt using `gh`; it does not change feature stage or workflow state by itself.
- [ ] If no PR exists, Aigon creates one against the repo default branch and returns the PR number and URL.
- [ ] If a PR already exists for the feature branch, Aigon does not create a duplicate; it returns the existing PR instead.
- [ ] If the branch has not been pushed yet, the UI blocks with a clear message telling the user to run `feature-push` first.
- [ ] If `gh` is missing, unauthenticated, or the remote is not GitHub, the UI shows a clear non-fatal error.
- [ ] The UI can open the created/existing PR URL or surface it clearly to the user.
- [ ] No background polling, webhook handling, auto-merge, review-state gating, or PR close/finalize logic is added in this feature.
- [ ] Documentation is updated to describe the new dashboard action and its relationship to `feature-push`.

## Validation
```bash
node -c lib/dashboard-server.js
node -c lib/dashboard-status-collector.js
npm test
```

## Technical Approach

### Product model

This feature sits between:

- `feature-push` in core Aigon
- optional GitHub-aware status/finalize features in Pro

It is just a convenience handoff:

1. branch already exists on `origin`
2. user clicks `Create PR`
3. Aigon opens or creates the PR
4. user continues review/merge on GitHub

### Scope boundaries

Keep v1 deliberately narrow:

- no auto-push
- no auto-PR on submit
- no PR merge from Aigon
- no persistent PR metadata in workflow-core
- no polling loop
- no provider abstraction beyond what is needed for GitHub

### UX shape

Preferred v1:

- add `Create PR` to the feature card overflow menu or feature detail drawer
- if a PR already exists, label can switch to `Open PR`
- on success:
  - show toast like `Created PR #17`
  - include a clickable GitHub URL

### Backend/API shape

Add a small dashboard endpoint, for example:

```text
POST /api/repos/:repoPath/features/:featureId/create-pr
```

The handler should:

1. resolve feature branch and repo context
2. verify GitHub remote
3. verify `gh` availability/auth
4. verify the branch exists on `origin`
5. check whether a PR already exists for that branch
6. if yes, return it
7. if no, create one with a sensible default title/body and return it

Example normalized response:

```json
{
  "provider": "github",
  "created": true,
  "prNumber": 17,
  "url": "https://github.com/jayvee/brewboard/pull/17"
}
```

or:

```json
{
  "provider": "github",
  "created": false,
  "existing": true,
  "prNumber": 17,
  "url": "https://github.com/jayvee/brewboard/pull/17"
}
```

### Implementation notes

- Reuse existing branch/feature target resolution where possible.
- Reuse or share GitHub lookup code with any future PR-status feature instead of duplicating `gh pr list` behavior.
- Keep PR title/body generation simple in v1; a minimal default is enough.
- If the branch is remote-tracked already, do not infer that a PR must exist.

### Suggested tasks

1. Add GitHub helper for:
   - existing PR lookup by branch
   - PR creation when none exists
2. Add dashboard endpoint for create/open PR.
3. Add UI affordance on feature card or drawer.
4. Add success/error states and PR URL surfacing.
5. Add tests for:
   - non-GitHub remote
   - branch not pushed
   - existing PR
   - create new PR
   - `gh` unavailable/auth failure
6. Update docs/product copy.

## Dependencies
- Core `feature-push`
- GitHub remote repository
- `gh` CLI

## Out of Scope
- PR merge or close
- PR status polling
- review/approval visualization
- GitLab/Bitbucket support
- auto-create PR on submit

## Related
- Feature: `github-pr-status-dashboard`
