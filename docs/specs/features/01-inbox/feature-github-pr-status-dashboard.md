# Feature: github-pr-status-dashboard

## Summary
Add an on-demand GitHub PR status indicator to Aigon’s feature UI so users can see whether a feature branch has an associated pull request and whether that PR is open, draft, merged, or unavailable before they try to close the feature. This is intentionally a visibility feature, not a sync engine: no polling loop, no webhooks, no background watcher, no PR merge execution, and no workflow state written from GitHub. The dashboard should fetch PR status only when the user asks for it or when the feature card/detail view is actively opened, giving users a clean “what is GitHub saying right now?” check without turning Aigon into a remote orchestration system.

## User Stories
- [ ] As a user who has pushed a feature branch and opened a GitHub PR, I want to see from inside Aigon whether that PR exists and what state it is in, so I do not have to guess whether `feature-close` will succeed.
- [ ] As a user following a GitHub-first merge workflow, I want a manual “refresh PR status” affordance on the feature card or drawer, so I can update the status on demand without Aigon polling forever in the background.
- [ ] As a user with no PR for a feature, I want the UI to tell me clearly that no PR exists, rather than implying that GitHub integration is broken.
- [ ] As a maintainer, I want the GitHub-status UI to stay read-only and best-effort, so it improves usability without dragging Aigon back into full PR sync or notification complexity.

## Acceptance Criteria
- [ ] Active feature cards in the dashboard can show a GitHub PR status summary when the repo’s `origin` remote is GitHub and the feature branch is known.
- [ ] The UI exposes a manual refresh affordance for PR status, such as a GitHub icon button or “Refresh PR status” action, on the feature card or in the feature detail/drawer.
- [ ] Refreshing PR status performs a one-shot GitHub lookup only for the targeted feature; it does not start a persistent polling loop.
- [ ] The returned status is displayed in a user-readable form with at least these outcomes: `No PR`, `Open`, `Draft`, `Merged`, and `Remote unavailable`.
- [ ] When GitHub reports an open PR, the UI shows the PR number and URL if available.
- [ ] When GitHub reports a merged PR, the UI indicates that the feature can now be finalized in Aigon.
- [ ] When the GitHub remote is unavailable, `gh` is not installed, or `gh` auth fails, the UI shows a non-fatal “remote unavailable” status rather than breaking the feature card.
- [ ] The status check is read-only: it does not create PRs, merge PRs, close PRs, mutate workflow state, or change the feature stage.
- [ ] The existing `feature-close` behavior remains the authoritative final check. This feature only improves visibility before the user attempts close.
- [ ] The UI does not query GitHub for non-GitHub remotes.
- [ ] The UI does not run a timer-based infinite polling loop. Any background refresh in v1 must be bounded to card open/render events only; periodic polling is out of scope.
- [ ] Dashboard/backend tests cover the GitHub status endpoint or handler for the main states: GitHub remote unavailable, no PR, open PR, draft PR, merged PR, and `gh` failure.
- [ ] Frontend tests or manual test instructions cover that the refresh control updates the visible status and does not mutate workflow actions by itself.
- [ ] Documentation is updated for the new dashboard affordance, including any new API route or UI wording, and product-facing copy may mention “manual GitHub PR status checks” but must not imply webhooks, auto-merge, or real-time sync.

## Validation
```bash
node -c lib/dashboard-server.js
node -c lib/dashboard-status-collector.js
node -c lib/remote-gate-github.js
npm test
```

## Technical Approach

### Product model

This feature is intentionally a UI/read-path improvement, not a new workflow authority.

GitHub remains responsible for:

- PR existence
- review state
- merge state
- user notifications outside Aigon

Aigon remains responsible for:

- local feature workflow
- `feature-close` finalization
- deciding at close time whether to continue

This feature only adds visibility in the gap between those two systems.

### Scope boundaries

The design must stay narrow:

- no webhook receiver
- no background “wait for merge” worker
- no exponential backoff or retry engine
- no remote status stored as workflow-core state
- no new top-level config flag just to enable the UI
- no PR merge action from Aigon

The status is a read, not a subscription.

### UX shape

Preferred v1 UX:

- show a small GitHub icon / badge on a feature card or in the feature detail drawer when the repo remote is GitHub
- clicking the icon triggers a status lookup
- the returned status is rendered inline on the card or drawer
- if a PR URL is known, the UI can offer a link to open it

Suggested status copy:

- `No PR`
- `Open PR #123`
- `Draft PR #123`
- `Merged PR #123`
- `GitHub unavailable`

Optional copy for merged state:

- “Merged on GitHub — you can finalize this feature in Aigon.”

### Backend shape

Add a small read-only API endpoint in the dashboard server, for example:

```text
GET /api/repos/:repoPath/features/:featureId/pr-status
```

or an equivalent POST route if that fits the existing API style better.

The handler should:

1. resolve the feature target and branch name using existing feature/workflow helpers
2. inspect `origin` and exit early for non-GitHub remotes
3. run a GitHub PR lookup using existing helper logic where possible
4. normalize the result to a small UI-focused status payload

Example payload:

```json
{
  "provider": "github",
  "status": "merged",
  "prNumber": 14,
  "url": "https://github.com/jayvee/brewboard/pull/14",
  "message": "Merged on GitHub"
}
```

or:

```json
{
  "provider": "github",
  "status": "unavailable",
  "message": "gh auth status failed"
}
```

### Reuse of existing GitHub helper logic

`lib/remote-gate-github.js` already knows how to:

- detect GitHub remotes
- detect `gh` availability
- detect `gh` auth state
- distinguish between no PR, open PR, and merged PR

Do not fork a second GitHub PR interpretation unless it is necessary. Prefer either:

- extending the existing helper with a UI-facing read method, or
- extracting shared GitHub PR query logic into a small common function used by both `feature-close` and the dashboard endpoint

The important constraint is to avoid duplicating brittle `gh pr list` behavior in two places.

### Frontend shape

Likely touchpoints:

- `templates/dashboard/js/api.js`
  - add a helper to fetch PR status for one feature
- `templates/dashboard/js/pipeline.js` or the feature-card rendering path
  - add the GitHub status affordance and render state text/badge
- any feature drawer/detail surface if that is a cleaner place for the status link and URL

The refresh action should:

- disable itself while the request is in flight
- show a small loading state
- update only that feature’s displayed PR status
- fail softly with a toast or inline status rather than destabilizing the dashboard

### Data lifetime

The safest v1 is ephemeral UI state only:

- keep last fetched PR status in frontend memory for the current dashboard session
- do not persist it to `.aigon/`
- do not cache it into workflow snapshots

If the user reloads the page, the status can be fetched again on demand.

### Suggested implementation tasks

1. Add or extract a shared GitHub PR status query helper from the current close-time logic.
2. Add a dashboard API endpoint returning a normalized PR status payload for one feature.
3. Add a small GitHub status control to the feature card or drawer.
4. Render the normalized states and link out to the PR when available.
5. Add tests for the endpoint/helper state table.
6. Add a manual test section covering:
   - GitHub repo with no PR
   - open PR
   - draft PR
   - merged PR
   - `gh` missing/auth broken
   - non-GitHub repo
7. Update docs and product copy.

## Dependencies
- depends_on: feature-close-remote-review-gate
- GitHub remote repository
- `gh` CLI for live status reads in GitHub repos

## Out of Scope
- Automatic PR creation
- Automatic PR merge
- Webhooks or public internet callbacks
- Long-running background polling
- Merge queue support
- GitLab/Bitbucket provider UI
- Persisting PR status into workflow-core or spec frontmatter
- Changing the semantics of `feature-close`

## Open Questions
- Should the status affordance live directly on the card, in the spec drawer, or both?
- Should the dashboard perform one automatic status fetch when a feature card becomes visible, or should v1 be strictly manual refresh only?
- Should the UI expose raw GitHub detail such as `mergeStateStatus`, or keep the output deliberately simplified?
- If a feature has an open PR and the user clicks `Close`, should the close failure surface include a shortcut to refresh PR status or open the PR URL?

## Related
- Research:
- Feature: `feature-close-remote-review-gate`
