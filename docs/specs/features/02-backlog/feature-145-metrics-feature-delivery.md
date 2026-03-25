# Feature: metrics-commit-analytics

## Summary

Add git commit data as a first-class analytics dimension in the Aigon dashboard. Parse the repo's git log to show commits over time, per-commit changeset stats (files, lines, authors), and — where branch naming allows — link commits to their originating feature ID. This enriches the existing feature reporting with a commit-level view: how many commits a feature took, how large each was, and what the overall commit activity looks like across the project.

## Motivation

The dashboard already tracks features completed over time, cycle time, and quality metrics. But the underlying git activity — the actual commits — is invisible. Commits are the raw signal of development effort. Surfacing them answers questions the feature-level view can't:

- "Was that 1-day feature a single big commit or 15 small ones?"
- "What does my commit activity look like on days I shipped zero features?" (research, refactoring, infra)
- "Which features had the biggest changesets?"
- "Are there clusters of unattributed commits that should have been features?"

## User Stories
- [ ] As a developer, I want to see a "Commits Over Time" chart in the dashboard showing daily/weekly commit counts
- [ ] As a developer, I want each commit linked to a feature ID (when possible) so I can see how many commits a feature required
- [ ] As a developer, I want to see per-commit stats (files changed, lines added/removed) to understand changeset size
- [ ] As a developer, I want to filter commits by feature, by agent, or by "unattributed" to understand where effort goes
- [ ] As a developer, I want to drill into a feature and see its commit timeline — when commits landed relative to start/close

## Acceptance Criteria
- [ ] Git log parsed and served via a new dashboard API endpoint (`GET /api/commits`)
- [ ] Each commit record includes: hash, author, date, message, files changed, lines added, lines removed, feature ID (nullable), agent (nullable)
- [ ] Feature ID attribution: match commit's branch (`feature-{id}-*`) or merge commit reference to extract feature ID
- [ ] Agent attribution: extract from Co-authored-by trailers or branch name (`feature-{id}-{agent}-*`)
- [ ] Dashboard "Commits" panel: commits-per-day bar chart (similar style to existing "Features Completed Over Time")
- [ ] Commits chart supports Daily/Weekly/Monthly toggle and date range navigation
- [ ] Commit list/table view with sortable columns: date, message, feature ID, agent, files, +lines, -lines
- [ ] Existing feature detail view enriched with commit count and total changeset size
- [ ] CLI command `aigon commits [--feature <id>] [--period 30d]` for terminal-based reporting

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

### Data extraction
- Parse `git log --all --format=...` with `--numstat` for per-commit file/line stats
- Extract feature ID from branch name: regex `feature-(\d+)-` on the commit's branch refs
- Extract agent from branch name: regex `feature-\d+-(\w+)-` or from Co-authored-by trailers
- Cache parsed commit data in `.aigon/cache/commits.json` with a last-parsed-commit marker for incremental updates

### Commit-to-feature linking
- **Primary**: branch name pattern `feature-{id}-*` via `git log --all --source`
- **Secondary**: merge commit messages referencing feature branches on main
- **Unattributed**: commits on main that don't match any feature branch (infra, docs, manual work)

### Dashboard integration
- New "Commits" tab or panel in the Analytics section
- Reuse existing chart infrastructure (same style as "Features Completed Over Time")
- Commit detail table below the chart
- On the existing per-feature view, add a "Commits" count badge and expandable commit list

### API shape
```
GET /api/commits?from=2026-03-01&to=2026-03-25&feature=144&agent=cc
→ { commits: [...], summary: { total, byFeature: {}, byAgent: {}, unattributed } }
```

## Dependencies
- None (uses git log data only)
- Enhanced-by: metrics-git-attribution (adds richer AI vs human classification to each commit)

## Out of Scope
- GitHub PR data (API integration) — future enhancement
- Diff-level analysis (which specific lines within a commit)
- Real-time commit streaming / webhooks
- Cross-repo commit aggregation

## Open Questions
- Should the commit chart be a new dashboard tab or a panel within the existing Analytics view?
- How far back should the default git log parse go? (all history vs last 90 days)
- Should squash-merge commits be expanded to show the original commit count from the feature branch?

## Related
- Research: research-19-ai-native-workflow-metrics
- Depends-on: none
- Enhanced-by: metrics-git-attribution (AI/human dimension per commit)
- Enriches: existing feature reporting (commit count, changeset size per feature)
