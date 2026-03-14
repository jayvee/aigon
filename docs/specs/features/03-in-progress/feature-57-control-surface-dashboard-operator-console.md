# Feature: control-surface-dashboard-operator-console

## Summary

Add an operator console to the Aigon Radar dashboard as a second view alongside the existing monitor view. The dashboard becomes a two-view app: the **Monitor** view (existing) shows real-time agent statuses for in-progress work, while the new **Pipeline** view provides a Kanban-style board where the operator can see all features across every stage and act on them — moving features between stages, setting up worktrees for agents, opening terminal sessions, and triggering evaluations — all without leaving the browser.

## User Stories

- [ ] As an operator, I want to switch between a Monitor view (agent statuses) and a Pipeline view (Kanban board) in the same web app, so I don't context-switch between tools
- [ ] As an operator, I want to see all features laid out as a Kanban board with columns for each pipeline stage (inbox, backlog, in-progress, evaluation, done), so I can see the full picture at a glance
- [ ] As an operator, I want to drag a feature card from one stage column to the next to advance it through the pipeline (e.g. inbox → backlog triggers `feature-prioritise`)
- [ ] As an operator, I want to set up a feature for one or many agents (e.g. cc, cx, gg) from the pipeline view, choosing which agents participate in the Fleet
- [ ] As an operator, I want to open worktree terminal sessions for a feature's agents directly from the dashboard, so I can jump straight into an agent's work
- [ ] As an operator, I want to trigger feature evaluation from the dashboard when all agents have submitted
- [ ] As an operator, I want contextual action buttons on each feature card based on its current stage

## Acceptance Criteria

### Two-view navigation
- [ ] Dashboard has a tab/toggle at the top to switch between "Monitor" and "Pipeline" views
- [ ] Monitor view is the existing dashboard (agent statuses, waiting notifications, attach buttons) — unchanged
- [ ] Pipeline view is the new Kanban board
- [ ] Both views share the same data source (`/api/status`) and poll cycle
- [ ] Active view preference is persisted in localStorage

### Pipeline view — Kanban board
- [ ] Features are displayed as cards in columns: Inbox | Backlog | In-Progress | Evaluation | Done
- [ ] Done column shows only the most recent N features (e.g. last 10) to avoid clutter
- [ ] Each card shows: feature ID, name, agent badges (if set up), and stage-appropriate action buttons
- [ ] Dragging a card between adjacent columns triggers the appropriate CLI action:
  - Inbox → Backlog: `feature-prioritise <name>`
  - Backlog → In-Progress: prompts agent picker, then `feature-setup <id> <agents...>`
  - In-Progress → Evaluation: `feature-eval <id>`
  - Other transitions are blocked (can't skip stages or move backwards)

### Stage-aware action buttons
- [ ] **Inbox** cards: "Prioritise" button
- [ ] **Backlog** cards: "Setup" button with agent picker (multi-select: cc, cx, gg, cu)
- [ ] **In-progress** cards: "Open worktree" button per agent to launch terminal sessions; "Evaluate" button when all agents have submitted
- [ ] **Evaluation** cards: status badge showing eval progress; "Close" button with winner picker (Fleet mode)

### Agent picker
- [ ] Appears as a modal or inline popover when "Setup" is clicked or a card is dragged to In-Progress
- [ ] Shows checkboxes for available agents (cc, cx, gg, cu)
- [ ] Selecting one agent = Drive mode; multiple = Fleet mode
- [ ] Submitting calls `POST /api/action` with `{ action: "feature-setup", args: ["<id>", ...selectedAgents] }`

### Worktree opening
- [ ] "Open worktree" calls `POST /api/worktree-open` (or equivalent) to create a tmux session and open iTerm2
- [ ] If the tmux session already exists, attaches to it instead of creating a duplicate

### Action feedback
- [ ] Dashboard shows loading/disabled state on buttons while an action is in flight
- [ ] Dashboard auto-refreshes via `POST /api/refresh` after an action completes
- [ ] Errors from actions are shown as toast notifications with the error message

### Data expansion
- [ ] `collectDashboardStatusData()` returns features from all pipeline stages (inbox, backlog, in-progress, evaluation, done) — not just in-progress and evaluation
- [ ] Each feature includes a `stage` field so the frontend can place it in the correct column

## Validation

```bash
node --check lib/utils.js
npm test
```

## Technical Approach

### Two-view architecture

Add a simple tab bar at the top of the dashboard (Monitor | Pipeline). Both views render into the same `#repos` container — the active view's render function runs on each poll cycle. State stored in `state.view` and persisted to localStorage.

### Expand collectDashboardStatusData()

Extend the function to also scan `01-inbox/` and `02-backlog/` feature specs. These stages don't have agent logs or tmux sessions, so they return minimal data: `{ id, name, stage: 'inbox'|'backlog', agents: [] }`.

For `05-done/`, return only the most recent N specs by modification time.

### Kanban rendering

Render five columns in CSS grid. Feature cards are rendered into columns based on their `stage` field. Cards use the same styling as existing feature cards but with stage-specific action buttons.

### Drag-and-drop

Use the native HTML5 Drag and Drop API (no library needed for simple column-to-column moves):
- `dragstart` stores feature ID and current stage
- `dragover`/`drop` on column elements validates the transition is allowed (adjacent stages only, forward only)
- On valid drop, fire the appropriate `POST /api/action` call
- For backlog → in-progress drops, intercept to show the agent picker before executing

### Action routing

Most actions route through `POST /api/action` (feature 55). For terminal-opening actions:
- Add `worktree-open` to `RADAR_INTERACTIVE_ACTIONS` allowlist
- Or add a dedicated `POST /api/worktree-open` endpoint that spawns a detached tmux session

### Asynchronous actions

Some actions (feature-setup, feature-eval) take several seconds. The `POST /api/action` endpoint currently uses `spawnSync` which blocks the HTTP server. For long-running actions:
- Run the action in a detached tmux session (like auto-eval already does)
- Return immediately with a session name
- Dashboard polls `/api/refresh` to pick up the resulting state change

## Dependencies

- Feature 55 (control-surface-radar-interactive-api) — provides `POST /api/action` and `POST /api/attach` endpoints ✅ merged
- Existing CLI commands: `feature-prioritise`, `feature-setup`, `feature-eval`, `feature-close`, `worktree-open`

## Out of Scope

- Live terminal streaming in the browser (see: feature-control-surface-radar-session-stream)
- Feature creation from the dashboard (creating specs requires writing markdown content)
- Multi-repo pipeline management (actions target one repo at a time)
- Reordering features within a column (priority ordering)

## Open Questions

- Should the agent picker remember the last selection?
- Should there be confirmation dialogs for destructive actions (e.g. feature-close)?
- Should the Done column be collapsible or hidden by default?

## Related

- Feature 55: control-surface-radar-interactive-api (provides the backend action API)
- Feature: control-surface-radar-session-stream (live terminal output — complementary)
- Research 09: control-surface-strategy
