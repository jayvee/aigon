# Feature: github-pr-status-endpoint

## Summary
Add a read-only dashboard API endpoint that returns the GitHub PR status for a given feature branch. This is the backend/data layer for PR visibility — no UI changes, no polling, no mutations. The endpoint shells out to `gh` on demand and returns a normalized status payload. It reuses existing logic in `remote-gate-github.js` to avoid duplicating `gh pr list` parsing.

## User Stories
- [ ] As a dashboard frontend (or script/curl user), I want to request the current GitHub PR status for a feature by ID, so I can display or act on it without re-implementing `gh` CLI parsing.
- [ ] As a developer extending Aigon, I want a single source of truth for "what does GitHub say about this feature's PR?" so that both `feature-close` and the dashboard use the same logic.

## Acceptance Criteria
- [ ] A new API route (e.g. `GET /api/repos/:repoPath/features/:featureId/pr-status`) returns a JSON payload with the PR status.
- [ ] The payload includes: `provider`, `status`, `prNumber` (if applicable), `url` (if applicable), and `message`.
- [ ] `status` is one of: `none`, `open`, `draft`, `merged`, `unavailable`.
- [ ] For non-GitHub remotes, the endpoint returns `{ "provider": null, "status": "unavailable", "message": "Not a GitHub remote" }` without calling `gh`.
- [ ] When `gh` is not installed or auth fails, the endpoint returns `status: "unavailable"` with an explanatory message, not an HTTP error.
- [ ] The endpoint does not create, merge, close, or mutate any PR or workflow state.
- [ ] The endpoint does not cache results or persist status to `.aigon/`.
- [ ] Shared PR query logic is extracted from (or added to) `remote-gate-github.js` so that `feature-close` and this endpoint use the same code path.
- [ ] Tests cover all five status outcomes: `none`, `open`, `draft`, `merged`, `unavailable` (both `gh` missing and non-GitHub remote).

## Validation
```bash
node -c lib/dashboard-server.js
node -c lib/remote-gate-github.js
npm test
```

## Technical Approach

### Pro gating
This feature is **not Pro-gated**. The endpoint is a thin read-only wrapper around `gh` CLI output that the user already has access to in their terminal. It fits the free tier: the dashboard is free, manual status checks are free. The follow-up UI feature is also free for the same reason.

Future *collaborative* GitHub features (e.g. shared PR status visibility across team members, PR merge notifications, assignment coordination) may be Pro/Teams-gated when that tier arrives. This basic single-user read path stays free — it's the foundation that Teams builds on top of.

### Provider future-proofing
This feature only implements GitHub. However, the payload shape and endpoint design should make it straightforward to add GitLab or Bitbucket later without refactoring:
- The `provider` field in the response payload already identifies the backend (`"github"`, or `null` for unsupported).
- The shared query function should be GitHub-specific (e.g. `queryGitHubPrStatus()`) rather than a generic `queryPrStatus()` with an internal switch. When a second provider arrives, add a second function and a thin dispatcher — don't build the dispatcher now.
- The endpoint route is provider-agnostic (`/pr-status`, not `/github-pr-status`), so the same route can dispatch to different providers based on the detected remote.

No provider abstraction layer, no plugin interface, no config for selecting providers. Just enough structure that the second provider is an addition, not a rewrite.

### Reuse existing helper
`lib/remote-gate-github.js` already detects GitHub remotes, `gh` availability, `gh` auth state, and PR status. Extract or extend a function like `queryGitHubPrStatus(repoPath, branchName)` that returns the normalized payload. Both the new endpoint and the existing `feature-close` gate should call this shared function.

### Endpoint shape
```text
GET /api/repos/:repoPath/features/:featureId/pr-status
```

Handler steps:
1. Resolve feature branch name from feature ID using existing helpers.
2. Check `origin` remote — exit early for non-GitHub remotes.
3. Call shared `queryPrStatus()`.
4. Return normalized JSON.

### Example responses
```json
{ "provider": "github", "status": "open", "prNumber": 42, "url": "https://github.com/org/repo/pull/42", "message": "Open PR #42" }
```
```json
{ "provider": "github", "status": "unavailable", "message": "gh auth status failed" }
```
```json
{ "provider": null, "status": "unavailable", "message": "Not a GitHub remote" }
```

## Dependencies
- depends_on: feature-close-remote-review-gate
- `gh` CLI installed and authenticated (graceful fallback when missing)

## Out of Scope
- Any UI/frontend changes
- Caching or persisting PR status
- Creating, merging, or closing PRs
- Polling or background refresh
- Non-GitHub providers (GitLab, Bitbucket) — but the payload shape and route design should not prevent adding them later
- Pro gating — this is a free-tier feature
- Provider abstraction layer or plugin interface

## Open Questions
- None — this is a straightforward data endpoint.

## Related
- Research:
- Feature: `feature-close-remote-review-gate`
- Feature: `feature-github-pr-status-ui` (follow-up)
