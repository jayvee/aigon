# Feature: github-pr-status-ui

## Summary
Add a GitHub PR status badge and close-button warning to the feature card on the Aigon dashboard. When the user clicks a GitHub icon on the card, it fetches the PR status from the existing endpoint and displays it inline. When the PR is not yet merged, the Close button gets a warning border to signal that closing may fail — but the button remains enabled, since the PR could be merged between the status check and the click.

## User Stories
- [ ] As a user who has pushed a feature branch, I want to see from the feature card whether a PR exists and what state it is in, so I don't have to leave Aigon to check GitHub.
- [ ] As a user about to close a feature, I want a visual warning on the Close button when the PR is not merged, so I know closing is likely to fail without being blocked from trying.
- [ ] As a user with a merged PR, I want the card to tell me I can finalize, so I know the feature is ready to close.

## Acceptance Criteria
- [ ] Feature cards for GitHub-backed repos show a dedicated "github" section below the agent sections, styled consistently with agent sections (bordered box, monospace header, left accent border).
- [ ] The GitHub section header shows `github` (monospace) on the left and a `[refresh]` button on the right.
- [ ] Before first refresh, the section shows placeholder text: "Click to check PR status".
- [ ] Clicking `[refresh]` triggers a one-shot fetch to the `pr-status` endpoint for that feature.
- [ ] While the fetch is in flight, the refresh button shows a brief loading indicator (e.g. pulse/opacity).
- [ ] After fetch, the status is rendered in the GitHub section's status row: `No PR`, `Open #123`, `Draft #123`, `Merged #123`, or `Unavailable`.
- [ ] `Open` and `Draft` statuses include a clickable link (↗) to the PR URL on GitHub.
- [ ] `Merged` status shows helper text below: "Ready to close".
- [ ] When the last-fetched status is `none`, `open`, `draft`, or `unavailable`, the Close button (if visible) renders with a warning border (orange/amber) to signal that closing may not succeed.
- [ ] The Close button is never disabled by PR status — it always remains clickable. The warning is advisory only.
- [ ] When the last-fetched status is `merged` or not yet fetched, the Close button renders normally (no warning).
- [ ] PR status is ephemeral frontend state only — not persisted to `.aigon/` or workflow snapshots. Page reload clears it.
- [ ] The GitHub section does not appear for non-GitHub remotes.
- [ ] No polling loop or timer. Status updates only on manual refresh click.

## Validation
```bash
node -c lib/dashboard-server.js
npm test
```

## Technical Approach

### Card layout — GitHub as a dedicated section

The GitHub section sits below the agent sections, before the card-level action buttons. It mirrors the agent section visual language: bordered box with a left accent border, monospace header, status row below. This keeps it visually consistent with the rest of the card while being clearly demarcated.

```
Before first refresh:
┌──────────────────────────────────┐
│ #234                             │
│ my-feature-name                  │
│ ┌──────────────────────────────┐ │
│ │ cc        ● Running          │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ github              [refresh]│ │
│ │   — Click to check PR status │ │
│ └──────────────────────────────┘ │
│ ─────────────────────────────── │
│ [Close & Merge cc]         [⋯] │
└──────────────────────────────────┘

After refresh — PR is open:
┌──────────────────────────────────┐
│ #234                             │
│ my-feature-name                  │
│ ┌──────────────────────────────┐ │
│ │ cc        ● Running          │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ github              [refresh]│ │
│ │   ● Open #42 ↗               │ │
│ └──────────────────────────────┘ │
│ ─────────────────────────────── │
│ [Close & Merge cc]         [⋯] │
│  ^^^ orange border warning       │
└──────────────────────────────────┘

After refresh — PR is merged:
┌──────────────────────────────────┐
│ #234                             │
│ my-feature-name                  │
│ ┌──────────────────────────────┐ │
│ │ cc        ● Submitted        │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ github              [refresh]│ │
│ │   ✓ Merged #42               │ │
│ │   Ready to close             │ │
│ └──────────────────────────────┘ │
│ ─────────────────────────────── │
│ [Close & Merge cc]         [⋯] │
│  ^^^ normal style                │
└──────────────────────────────────┘

After refresh — no PR:
┌──────────────────────────────────┐
│ #234                             │
│ my-feature-name                  │
│ ┌──────────────────────────────┐ │
│ │ cc        ● Running          │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ github              [refresh]│ │
│ │   — No PR                    │ │
│ └──────────────────────────────┘ │
│ ─────────────────────────────── │
│ [Close & Merge cc]         [⋯] │
│  ^^^ orange border warning       │
└──────────────────────────────────┘
```

### Pro gating
This feature is **not Pro-gated**. It's a basic visibility improvement on the free dashboard, wrapping data from a free endpoint. Gating a read-only status check behind Pro would feel wrong when the user can already run `gh pr list` in their terminal.

Future *collaborative* GitHub features (e.g. shared PR status across team members, merge notifications, assignment coordination) may be Pro/Teams-gated. This basic single-user visibility stays free — it's the foundation that the collaborative layer builds on, and it helps sell the value of deeper integration.

### Provider future-proofing
The UI renders based on the `provider` field from the endpoint response, not a hardcoded GitHub assumption. The section header shows the provider name (`github`), the badge colors and link behavior are provider-specific, and the section only appears when the endpoint returns a recognized provider. When a second provider (e.g. GitLab) is added to the endpoint, the UI needs a new color/icon mapping but no structural changes — the card section pattern, refresh flow, and close-button warning logic all work identically regardless of provider.

No provider dropdown, no config UI, no "select your Git host" flow. The endpoint detects the provider from the remote; the UI just renders what comes back.

### Close button warning styling
- When PR status is fetched and is NOT `merged`: add class `kcard-va-btn--pr-warning` to the Close button, which applies an orange/amber border (`border-color: #FB923C`).
- When PR status is `merged` or not yet fetched: normal button styling.
- The button is never `disabled`. This is intentional — the PR could be merged between the status check and the click. The warning is a hint, not a gate.

### GitHub section styling
- Uses `kcard-agent` structural pattern: bordered box with left accent border.
- Left border color: `#8B949E` (GitHub's muted gray) to distinguish from agent colors (blue, purple, green, orange).
- Header: `github` in monospace (matching `.kcard-agent-name`), `[refresh]` button aligned right (same slot as dev-server link on agent sections).
- Status row: uses same `.kcard-agent-status-row` layout with status dot/icon + label.

### Frontend touchpoints
- `templates/dashboard/js/api.js` — add `fetchPrStatus(repoPath, featureId)` helper.
- `templates/dashboard/js/pipeline.js` — after agent section rendering, add the GitHub section using the same `kcard-agent` markup pattern. Add click handler for the refresh button.
- `templates/dashboard/styles.css` — add styles for `.kcard-agent.agent-github` (left border color), `.kcard-gh-refresh`, `.kcard-va-btn--pr-warning`, and status-specific badge colors.

### Badge color scheme
- `No PR` — gray (text-tertiary)
- `Open #N` — blue (#6B9EFF), clickable link
- `Draft #N` — yellow (#FCD34D), clickable link
- `Merged #N` — green (#4ADE80)
- `Unavailable` — gray (text-tertiary)

### State management
- Store fetched PR status in a JS Map keyed by feature ID, in memory only.
- On card re-render (e.g. after board refresh), re-apply cached status if available.
- No persistence. Page reload clears the map.

## Dependencies
- depends_on: feature-github-pr-status-endpoint

## Out of Scope
- Drawer/detail view integration (card only for v1)
- Toast notifications on failure (inline "Unavailable" text is sufficient)
- Loading spinner (icon pulse/opacity change is enough)
- Auto-fetch on card render (manual click only for v1)
- Disabling the Close button based on PR status
- Pro gating — this is a free-tier feature
- Non-GitHub provider UI (GitLab, Bitbucket) — but the rendering should be driven by the `provider` field so adding providers later is additive, not a refactor

## Open Questions
- None.

## Related
- Research:
- Feature: `feature-github-pr-status-endpoint` (prerequisite)
- Feature: `feature-github-pr-status-docs` (follow-up — public docs and Pro page update)
- Feature: `feature-close-remote-review-gate`
