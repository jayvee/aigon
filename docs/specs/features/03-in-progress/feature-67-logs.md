# Feature 67: Logs Tab

## Summary
Add a "Logs" tab at the far right of the dashboard that shows every feature (across all stages) as a sortable, filterable table — a line-by-line complement to the Statistics charts view.

## User Stories
- [ ] As a user, I can click the Logs tab and see every feature in a table with columns for ID, name, stage, repo, and dates
- [ ] As a user, I can sort the table by name, repo, stage, date created, or date last changed
- [ ] As a user, when I select a repo in the left sidebar, the Logs table filters to only show features from that repo
- [ ] As a user, I can click a column header to toggle sort direction

## Acceptance Criteria
- [ ] A "Logs" tab exists to the right of "Statistics" (left of "Settings")
- [ ] The table shows all features from all stages (inbox → done) when "All Repos" is selected
- [ ] Columns: ID, Name, Stage, Repo, Created, Last Changed
- [ ] Clicking a column header sorts ascending; clicking again sorts descending; active sort column is visually indicated
- [ ] Default sort: Last Changed descending (most recently modified first)
- [ ] Selecting a repo in the sidebar filters the table to that repo's features only
- [ ] Stage values are styled with the same colour coding used elsewhere in the dashboard
- [ ] Dates are displayed as relative times ("2h ago") consistent with the rest of the dashboard
- [ ] The table is responsive — scrolls horizontally on narrow viewports

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach
- **Data source**: `/api/status` already returns features per repo with `id`, `name`, `stage`, `specPath`. Extend feature objects in `collectDashboardStatusData()` in `lib/utils.js` to include `createdAt` and `updatedAt` (file mtime via `fs.statSync`).
- **Done feature cap**: Done features are currently capped at 10 in status. Add `allDoneFeatures` array (no cap) alongside the existing `features` array, used only by the Logs view.
- **Tab**: Add `data-view="logs"` tab button after `statistics`, before `settings`. Add `renderLogsView()` and call it in the `render()` switch.
- **Filtering**: Reuse `state.selectedRepo` — same pattern as Statistics view.
- **Sorting**: Client-side only. Store `state.logsSort = { col: 'updatedAt', dir: 'desc' }` in state. Column header clicks toggle dir or change col.
- **Table**: Plain `<table>` inside `.view-content`, styled with existing CSS variables. Sticky header.
- **No new API endpoint** — extend existing feature objects.

## Dependencies
- `collectDashboardStatusData()` in `lib/utils.js`
- Dashboard HTML tab list and `render()` switch
- `relTime()` utility already in dashboard JS

## Out of Scope
- Research and feedback items (features only for v1)
- Pagination
- Click-to-open spec
- Export to CSV

## Open Questions
- Done features currently capped at 10 for monitor/pipeline views — Logs needs all of them. Resolved: add `allFeatures` (uncapped) to repo data, used only by Logs view.

## Related
- Feature 63: Statistics view (same repo filtering pattern)
