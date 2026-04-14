# Feature: github-pr-status-docs

## Summary
Add public documentation for the GitHub PR status feature and update the main Aigon docs site to highlight deeper integration with external tools like GitHub. The GitHub PR status feature is free (not Pro-gated), so the integration guide lives in the main docs alongside other dashboard features. The Pro page (`aigon.build/pro`) gets a mention of integrations as part of Aigon's broader direction, but since this feature is free, it's not positioned as a Pro upsell.

## User Stories
- [ ] As a user discovering the GitHub PR status section on my feature card, I want to find docs explaining what it does, how to use it, and what the statuses mean.
- [ ] As a visitor to the Aigon docs site, I want to see that Aigon integrates with tools I already use (GitHub), so I understand the full scope of what the dashboard offers.
- [ ] As a visitor to `aigon.build/pro`, I want to see that Aigon is investing in deeper tool integrations, even if the current ones are free.

## Acceptance Criteria
- [ ] A new docs page (e.g. `site/content/guides/github-integration.mdx`) explains the GitHub PR status feature: what it shows, how to refresh, what each status means, and prerequisites (`gh` CLI + auth).
- [ ] The dashboard guide (`site/content/guides/dashboard.mdx`) references the GitHub section on feature cards and links to the new integration guide.
- [ ] The Pro page (`site/content/pro.mdx`) adds a brief "Integrations" mention noting that Aigon connects to tools like GitHub, framed as a platform direction rather than a Pro-specific upsell (since this feature is free). Leave room for future integrations (GitLab, CI status, etc.) without promising them.
- [ ] The Pro page maintains honest "Coming Soon" messaging — no implication that integrations or Pro features are purchasable today.
- [ ] Copy does not imply webhooks, auto-merge, real-time sync, or any behavior the feature doesn't have. Terms like "on-demand status check" and "manual refresh" are preferred.

## Validation
```bash
# Verify integration guide exists
test -f site/content/guides/github-integration.mdx
# Verify Pro page mentions integrations
grep -q -i "integration" site/content/pro.mdx
```

## Technical Approach

### New integration guide
Create `site/content/guides/github-integration.mdx` covering:
- **What it does**: on-demand PR status on the dashboard feature card
- **Prerequisites**: GitHub remote, `gh` CLI installed and authenticated
- **How to use**: click refresh on the GitHub section, read the status
- **Status reference table**: No PR, Open, Draft, Merged, Unavailable — what each means and what to do
- **Close button warning**: explain the orange border means PR isn't merged yet, button still works
- **Limitations**: manual only, no polling, no auto-merge, read-only

### Pro page update
Add a brief integrations mention to `site/content/pro.mdx`, before the Coming Soon banner. Since GitHub PR status is a free feature, this is about showing platform direction, not upselling:

```
## Integrations

Aigon's dashboard connects to the tools you already use — starting with
GitHub PR status directly on your feature cards. More integrations coming.
```

One sentence, not a full section. The detailed explanation lives in the integration guide, not the Pro page.

### Dashboard guide cross-reference
Add a short paragraph to the feature card section of `site/content/guides/dashboard.mdx`:
- "If your repo uses a GitHub remote, feature cards show a GitHub section where you can check PR status on demand. See the [GitHub Integration guide](./github-integration) for details."

## Dependencies
- depends_on: feature-github-pr-status-ui

## Out of Scope
- Documentation for integrations that don't exist yet (GitLab, Bitbucket, CI)
- New screenshots (use ASCII diagram from the UI spec or a post-implementation screenshot)
- Changes to the dashboard or endpoint code
- Pricing or purchase flow copy
- Pro gating documentation for this feature (it's free). Future collaborative/Teams GitHub features may be gated separately and documented when they ship.

## Open Questions
- Should the integration guide live under `/guides/` or get its own `/integrations/` section in the docs nav?

## Related
- Research:
- Feature: `feature-github-pr-status-ui` (prerequisite)
- Feature: `feature-github-pr-status-endpoint`
- Feature: `feature-153-pro-landing-page-and-docs` (existing Pro page)
