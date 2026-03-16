# Implementation Log: Feature 67 - Logs Tab

## Plan
Add a new "Logs" tab to the dashboard showing all features in a sortable, searchable, paginated table. Respects sidebar repo filter.

## Progress
- [x] Explored dashboard tab architecture and data model
- [x] Wrote spec
- [x] Extended `collectDashboardStatusData()` in `lib/utils.js` to add `createdAt`/`updatedAt` to feature objects
- [x] Added `allFeatures` (uncapped done list) to each repo in the status response
- [x] Added "Logs" tab button in HTML (after Statistics, before Settings)
- [x] Added `logs-view` container div
- [x] Added CSS for logs table, stage badges, pagination, search input
- [x] Added `logsState` object (sort, search, page)
- [x] Implemented `renderLogsView()` with sort, search, pagination, and sidebar repo filter
- [x] Updated `render()` switch to handle `logs` view and hide/show `logs-view` in all branches
- [x] Removed autonomy stat tile from Statistics (data not reliable enough to display)

## Decisions
- **allFeatures vs extending features**: Added a separate `allFeatures` array to the repo object rather than lifting the done-features cap for the existing `features` array. This avoids sending extra agent/nextAction data for all done features in every status poll — the Logs view only needs id/name/stage/specPath/createdAt/updatedAt.
- **No new API endpoint**: The Logs view uses `state.data` (already polled) rather than a separate fetch, so it renders instantly without a loading state.
- **Sidebar shown for Logs**: Unlike Statistics/Sessions, the sidebar remains visible on the Logs tab so the existing repo filter works naturally.
- **Autonomy tile removed**: User confirmed the data is not yet reliable enough to display publicly.
