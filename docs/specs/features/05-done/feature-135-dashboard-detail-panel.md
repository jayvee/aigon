# Feature: Dashboard detail panel

## Summary
Add a tabbed detail panel to the dashboard spec drawer so users can drill into the low-level data behind a feature or research item — event timeline, per-agent status, timing statistics, and raw control files — without leaving the dashboard.

## User Stories
- [ ] As a user, I want to click a feature card and see its full event history (state transitions, reconciliations, manual fixes) so I can understand what happened and when
- [ ] As a user, I want to see per-agent status, flags, and session metadata in a structured view so I can diagnose stuck or failed agents
- [ ] As a user, I want to see timing statistics (created → started → submitted → evaluated durations) so I can understand throughput
- [ ] As a user, I want to inspect the raw coordinator manifest and agent status JSON so I can debug state issues

## Acceptance Criteria
- [ ] Spec drawer shows a tab bar with 5 tabs: Spec (default), Events, Agents, Stats, Control
- [ ] Spec tab preserves all current behavior (markdown preview, edit mode, undo/redo, font sizing)
- [ ] Events tab renders the coordinator manifest `events[]` array as a vertical timeline with timestamps, event types, and actors
- [ ] Agents tab shows a card per agent with: status, updatedAt, worktree path, session flags, and an excerpt from their implementation log (Plan/Progress sections)
- [ ] Stats tab shows computed durations: time-to-start, time-to-submit, time-to-evaluate, total lifecycle; plus agent count and winner
- [ ] Control tab shows raw JSON for the coordinator manifest and each agent status file, syntax-highlighted and copyable
- [ ] Drawer width expands (e.g. 70vw) when a non-Spec tab is active; snaps back to current width on Spec tab
- [ ] Tabs work for both features and research items (research uses findings files instead of implementation logs)
- [ ] Tab selection persists within a drawer session (closing and reopening resets to Spec)
- [ ] Data loads lazily per tab — no extra fetches until a tab is clicked

## Validation
```bash
node --check aigon-cli.js
node -c lib/dashboard-server.js
```

## Technical Approach

### Frontend (spec-drawer.js + new detail-tabs.js)
- Add a tab bar to the drawer header in `index.html` (between title row and content area)
- New `templates/dashboard/js/detail-tabs.js` module handles tab switching, data fetching, and rendering
- Each tab renders into a shared content container, replacing the current preview/editor area
- Spec tab delegates back to existing `drawerPreview`/`drawerEditor` logic unchanged
- Drawer width toggling: add/remove a CSS class (e.g. `.drawer-wide`) that sets `width: min(70vw, 960px)`

### Backend (dashboard-server.js)
- New endpoint `GET /api/detail/:type/:id` returns a unified payload:
  ```json
  {
    "manifest": { /* coordinator manifest JSON */ },
    "agentFiles": { "cc": { /* agent status JSON */ }, ... },
    "logExcerpts": { "cc": { "plan": "...", "progress": "..." }, ... },
    "evalPath": "...",
    "specPath": "..."
  }
  ```
- Reads from `.aigon/state/feature-{id}.json`, `.aigon/state/feature-{id}-{agent}.json`, and parses log markdown for section excerpts
- Falls back gracefully when files are missing (features without manifests, pre-manifest legacy features)

### Data sources
| Tab | Primary source | Fallback |
|-----|---------------|----------|
| Events | `manifest.events[]` | Empty state: "No events recorded" |
| Agents | Agent status JSON + log markdown sections | Log frontmatter `events:` array |
| Stats | Computed from manifest event timestamps | createdAt/updatedAt from spec file |
| Control | Raw JSON files | "No manifest found" message |

### CSS
- Timeline styles: vertical line with dot markers, timestamp left, description right
- Agent cards: status badge, monospace paths, collapsible log excerpts
- Stats: simple key-value grid with duration formatting (e.g. "2h 14m")
- Control: `<pre>` with monospace, copy button per block
- All dark-mode compatible using existing CSS variables

## Dependencies
- Existing spec drawer (`templates/dashboard/js/spec-drawer.js`)
- Existing AIGON server (`lib/dashboard-server.js`)
- Manifest module (`lib/manifest.js`)
- `marked.js` already loaded for markdown rendering

## Out of Scope
- Real-time WebSocket updates for detail tabs (polling on tab switch is sufficient)
- Editing manifests or agent status from the detail panel
- Research-specific finding diff views
- Mobile-optimised layout for detail tabs

## Open Questions
- Should the Events tab show outbox/pending transitions in addition to completed events?
- Should Stats include cross-feature comparisons (e.g. "faster than average")?

## Related
- Coordinator manifests: `lib/manifest.js`
- AIGON server status collection: `lib/dashboard-server.js` lines 629-760
- Spec drawer: `templates/dashboard/js/spec-drawer.js`
