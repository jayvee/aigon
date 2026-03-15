---
status: submitted
updated: 2026-03-15T10:40:00.000Z
---

# Implementation Log: Feature 57 - control-surface-dashboard-operator-console
Agent: cc

## Plan

Explored the existing codebase before implementing:
- `lib/utils.js` contains all server-side logic: `collectDashboardStatusData()`, `runRadarServiceDaemon()`, `RADAR_INTERACTIVE_ACTIONS`
- `templates/dashboard/index.html` contains the full dashboard (CSS + JS inline)
- Much of the backend had already been pre-implemented: inbox/backlog/done stage scanning, `/api/worktree-open` endpoint, `worktree-open` in the actions allowlist, and tests

Focused implementation effort on: the two-view frontend architecture in the dashboard HTML template, plus three post-testing bug fixes discovered during user testing.

## Progress

All acceptance criteria implemented and verified:

**Backend (lib/utils.js) — pre-implemented:**
- `collectDashboardStatusData()` scans all 5 stages: inbox, backlog, in-progress, in-evaluation, done (last 10 by mtime for done)
- `/api/worktree-open` endpoint finds worktree dir, creates/attaches tmux session, opens iTerm2
- `worktree-open` added to `RADAR_INTERACTIVE_ACTIONS`

**Frontend (templates/dashboard/index.html):**
- Tab bar (Monitor | Pipeline) with localStorage persistence
- Monitor view unchanged — existing agent status cards
- Pipeline/Kanban view: 5 columns × per-stage feature cards
- Stage-aware action buttons: Prioritise (inbox), Setup with agent picker (backlog), Open worktree per agent + Evaluate when all submitted (in-progress), eval status badge + Close (evaluation)
- Agent picker modal: checkboxes for cc/cx/gg/cu, Drive vs Fleet based on count
- Drag-and-drop via HTML5 DnD API: only forward adjacent transitions allowed; drag-blocked visual feedback for invalid targets; backlog→in-progress intercepts to show agent picker
- Action feedback: buttons disabled with `...` indicator during requests, toast notifications, auto-refresh after each action via `POST /api/refresh`

**Tests (aigon-cli.test.js):**
- 4 new tests for `collectDashboardStatusData` covering inbox, backlog, done limiting, and in-progress agent data preservation
- All 67 tests pass

**Post-testing bug fixes (discovered during user testing):**

1. **Silent CLI stderr failures surfaced as HTTP 422** (`lib/utils.js`): CLI commands like `feature-prioritise` exit code 0 but print `❌ ...` to stderr when they fail. The dashboard showed a false "Done" toast. Fixed by detecting `❌`-prefixed stderr output and returning HTTP 422 with the error message. Also added `log()` calls so every action result appears in `~/.aigon/radar.log`.

2. **Inbox features without ID not shown in Kanban** (`lib/utils.js`): `collectDashboardStatusData` used regex `/^feature-\d+-.+\.md$/` to scan all stages including inbox. Un-prioritized inbox files (`feature-name.md`, no ID) were silently dropped. Fixed by using a relaxed pattern (`/^feature-.+\.md$/`) for the inbox stage only.

3. **`parseFeatureSpecFileName` rejected ID-less filenames** (`lib/utils.js`): Even after passing the inbox scan filter, files without an ID were dropped by `parseFeatureSpecFileName` (required `\d+`). Fixed by adding a fallback match that returns `{ id: null, name }` for ID-less files.

## Decisions

- Kept Monitor and Pipeline views sharing the same `#repos` div (cleared and re-rendered per view) and `#empty` div — simpler than adding new DOM elements
- Used CSS `className = ''` to strip the `.repos` grid layout when switching to pipeline (pipeline uses its own `.kanban` grid)
- Drag-and-drop uses `drag-blocked` class on invalid drop targets as visual feedback — clearer UX than silently ignoring bad drops
- Agent picker returns a Promise via resolve pattern, allowing async/await flow in drag-drop handlers
- `feature-prioritise` receives the feature name slug (not ID) — consistent with how the CLI resolves inbox features by name
- In-progress "Open" buttons call `/api/worktree-open` which handles both existing-session attach and new-session creation
- Stderr `❌` detection chosen over exit-code checking because the Aigon CLI uses exit 0 broadly; the emoji prefix is the reliable failure signal
- Inbox pattern relaxed per-stage rather than globally to avoid matching stale/partial files in backlog/done columns where IDs are always present
