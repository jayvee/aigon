---
status: submitted
updated: 2026-03-16T04:50:26.960Z
completedAt: 2026-03-16T04:50:26.960Z
events:
  - { ts: "2026-03-16T04:25:56.799Z", status: waiting }
  - { ts: "2026-03-16T04:49:46.325Z", status: submitted }
---

# Implementation Log: Feature 67 - Logs Tab

## Plan
Add a "Logs" tab to the dashboard showing all features across all stages as a sortable, searchable, paginated table with an inline repo filter dropdown. Clicking any row opens the spec in the existing drawer.

## Progress
- [x] Extended `collectDashboardStatusData()` in `lib/utils.js`:
  - Added `createdAt` / `updatedAt` (file mtime/birthtime) to every feature object
  - Added `allDoneSpecFiles` to capture full uncapped done list
  - Added `allFeatures` per repo — lightweight objects (id, name, stage, specPath, dates) with no done-cap, used exclusively by the Logs view
- [x] Added "Logs" tab button in HTML nav (after Statistics, before Settings)
- [x] Added `logs-view` container div to detail area
- [x] Added CSS: `.logs-table`, `.logs-row`, `.logs-stage` stage badges, `.logs-toolbar`, `.logs-pagination`, `.logs-search`
- [x] Added `logsState` object: `{ sort, search, repoFilter, page, pageSize }`
- [x] Added `slugToTitle()` utility to convert hyphenated slugs to title-case display names
- [x] Added `logsDateFmt()` utility: relative (<1d), date+time (<7d), full date (older)
- [x] Implemented `renderLogsView()`:
  - Collects from `repo.allFeatures` (falls back to `repo.features`)
  - Repo filter dropdown (all repos or specific repo)
  - Name search (matches slug or title-cased form)
  - Sort by ID, Name, Stage, Repo, Created, Last Changed — clicking header toggles asc/desc
  - 50 rows per page with Prev/Next pagination
  - Clicking a row calls `openDrawer(specPath, title, stage)` to show the spec
  - Row hover highlight
- [x] Updated `render()` switch: hides sidebar for Logs (matches Statistics pattern), hides/shows `logs-view` in all branches
- [x] Removed Autonomy stat tile and block from Statistics view

## Decisions
- **`allFeatures` separate from `features`**: The existing `features` array caps done items at 10 for monitor/pipeline performance. Rather than lift that cap globally, added a parallel `allFeatures` array with only the fields the Logs view needs. No agent/nextAction data, keeping the payload lean.
- **No new API endpoint**: Logs view uses `state.data` from the existing poll — renders instantly with no loading state.
- **Sidebar hidden, inline dropdown**: Initially kept the sidebar visible, but user feedback clarified they wanted an explicit filter control. Switched to hiding the sidebar (matching Statistics) and adding a Repo dropdown directly in the toolbar — more discoverable and gives the table more width.
- **`slugToTitle` for display names**: Feature names from the filesystem are slugs. Rather than read each spec file for the H1 title (expensive at scale), convert hyphens to spaces and title-case — good enough for a log view.
- **`logsDateFmt` over `relTime`**: User requested context-appropriate date formatting rather than always showing relative time. "16h ago" is useful; "Mar 8, 2025" is more useful than "5040h ago".
- **Radar restart issue**: Initial test showed missing data because `aigon radar stop/start` only restarts the process tracked in the current PID file. The main AIGON server (port 4100) was a separate process that needed to be killed explicitly. Verified with `ps aux | grep "node.*aigon"` before/after.
- **Autonomy tile removed**: User confirmed the autonomy ratio data is not yet reliable enough to surface in the dashboard.
