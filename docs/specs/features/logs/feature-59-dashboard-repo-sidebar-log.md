---
status: submitted
updated: 2026-03-15T22:41:49.321Z
startedAt: 2026-03-15T20:14:38+11:00
completedAt: 2026-03-15T20:16:48+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 59 - dashboard-repo-sidebar

## Plan

Replace the scrollable 2-column repo grid with a master-detail layout: narrow sidebar on the left for repo selection, full-width detail area on the right. During implementation the scope expanded significantly based on user feedback to include a spec viewer/editor drawer, pipeline type toggle, create modal, settings tab, and various UX improvements.

## Progress

### Core sidebar (spec requirements)
- `templates/dashboard/index.html`: Added `.dashboard-body` flex container, `.repo-sidebar` (200px), `.detail-area`
- Sidebar renders repos sorted by activity (implementing agents first, then active item count, then recency)
- Badge shows total items excluding done — indicates work remaining
- Active repo has 3px left accent border + background highlight
- "All" option at top restores 2-column grid layout
- Selection persisted in localStorage (`aigon.dashboard.selectedRepo`)
- Independent scroll regions for sidebar and detail area
- Roving tabindex keyboard navigation (Arrow Up/Down, Enter, Home/End) with focus preservation across re-renders
- Mobile responsive: sidebar collapses to dropdown at <768px

### Repo header bar (spec requirements)
- Sticky header spanning detail area when a specific repo is selected
- Shows full repo name, item counts, waiting/error summary
- Uses `--bg-root` background with bottom border

### Pipeline enhancements (user-requested beyond spec)
- Features/Research/Feedback three-way toggle with per-type stage columns
- Features: inbox → backlog → in-progress → evaluation → done
- Research: inbox → backlog → in-progress → paused → done
- Feedback: inbox → triaged → actionable → done → won't fix
- Done column capped at 6 cards with "N more — open in Finder" button showing real total from disk

### Spec drawer (user-requested beyond spec)
- Slide-out drawer from right (55vw/720px max) for viewing/editing spec files
- Read mode: markdown rendered via marked.js CDN
- Edit mode: textarea with debounced undo/redo (100 levels), dirty tracking
- Font size controls (A−/A+, range 10-24px, persisted to localStorage)
- Save button + Cmd+S keyboard shortcut
- Undo/Redo buttons
- Fullscreen toggle (button + Cmd+Shift+F)
- Cmd+Shift+E toggles read/edit mode
- "Open in Editor" button launches file in default macOS editor
- Click-to-open on kanban cards and monitor cards (drag-aware: doesn't trigger on drag)
- Escape to close, unsaved changes confirmation

### Create modal (user-requested beyond spec)
- Styled modal (not browser prompt) to create new feature/research/feedback specs
- Repo dropdown when "All" is selected with multiple repos
- Contextual placeholder text per type
- Creates file in inbox with appropriate template, opens drawer in edit mode
- Enter to submit, Escape to cancel

### Settings tab (user-requested beyond spec)
- Third tab alongside Monitor/Pipeline
- Lists registered repos with remove buttons
- Add repo form with path input and tilde expansion

### API endpoints added to `lib/utils.js`
- `GET /api/spec?path=` — read a spec file
- `PUT /api/spec` — write/save a spec file
- `POST /api/spec/create` — create new spec in inbox with template
- `POST /api/open-in-editor` — open file in default editor
- `POST /api/repos/add` — add repo to registry
- `POST /api/repos/remove` — remove repo from registry
- `POST /api/open-folder` — open folder in Finder

### Data collection enhancements in `collectDashboardStatusData()`
- Now collects features, research, and feedback from all stages (inbox, backlog, in-progress, evaluation, done, etc.)
- `doneTotal`, `researchDoneTotal`, `feedbackDoneTotal` fields for real counts
- `specPath` included on all items for drawer integration
- Done items capped at 10 most recent by mtime in API, 6 displayed in UI

### UX polish
- Drag tilt: 6-degree rotated drag ghost with drop shadow on kanban cards
- Source card fades to 30% opacity during drag
- `#null` IDs hidden for unprioritised inbox items
- Research items from non-active stages filtered out of Monitor view

### Testing
- `tests/dashboard-pipeline.spec.js`: 14 Playwright tests covering API data, pipeline columns, inbox/done counts, sidebar rendering, repo selection, localStorage persistence, settings view, keyboard navigation, pipeline toggle, research/feedback views
- `@playwright/test` added as devDependency

## Decisions

- **marked.js via CDN** over bundled: no build step in this project, CDN is simplest. Falls back to plain text if CDN fails.
- **Slide-out drawer over modal** for spec viewing: allows seeing dashboard context behind the drawer, more natural for reading long specs.
- **Browser `setDragImage()` for tilt** rather than CSS on source card: the browser renders a bitmap of the drag ghost, so CSS on the source card only affects what stays behind. Custom ghost clone with rotation applied before capture.
- **Debounced undo snapshots** (500ms) rather than per-keystroke: prevents hundreds of undo steps for a paragraph of typing.
- **Activity-based repo sorting** rather than config order: repos with implementing agents surface first, matching the user's attention priority.
- **Sidebar badge excludes done items**: shows work remaining, not total history.
- **AIGON server required restart** to pick up code changes: the old daemon was running stale code that didn't collect inbox/backlog/done stages. This was the root cause of the empty Pipeline columns the user reported.
