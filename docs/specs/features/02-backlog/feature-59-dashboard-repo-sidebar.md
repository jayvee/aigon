# Feature: Dashboard Repo Sidebar

## Summary

Replace the current scrollable 2-column grid of all repos with a master-detail layout: a narrow fixed sidebar on the left for repo selection, and a full-width detail area on the right showing the selected repo's features and research cards. A prominent repo header bar spans the full width of the detail area so the user always knows which project they're looking at.

## User Stories

- [ ] As a user with 10+ repos, I can instantly jump to any repo without scrolling through all of them.
- [ ] As a user, I can always see which repo I'm currently viewing via the prominent header bar, even after scrolling down through many feature cards.
- [ ] As a user, I can quickly scan the sidebar to see which repos need attention (waiting/error indicators) without clicking into each one.
- [ ] As a user, I can switch back to the "all repos" overview when I want to see everything at a glance.

## Acceptance Criteria

### Sidebar
- [ ] A 200px fixed-width sidebar appears on the left side of the dashboard, below the existing top bar (title, health, refresh).
- [ ] Each sidebar row shows: repo `displayPath` (truncated with `text-overflow: ellipsis`) and a numeric badge showing total active items (features + research).
- [ ] A warning dot (amber) appears on repos that have at least one agent in `waiting` status.
- [ ] An error dot (red) appears on repos that have at least one agent in `error` status.
- [ ] Full repo name is shown in a tooltip on hover.
- [ ] The active repo row has a 3px left accent border and a subtle background highlight (`--bg-elevated`).
- [ ] An "All" option at the top of the sidebar shows all repos in the current 2-column grid layout (backwards compatible default view).
- [ ] Selected repo is persisted in localStorage (`aigon.dashboard.selectedRepo`).
- [ ] The sidebar scrolls independently from the main content area (both have `overflow-y: auto`).

### Repo header bar
- [ ] When a specific repo is selected (not "All"), a header bar spans the full width of the detail area, pinned to the top of the detail scroll area.
- [ ] The header bar shows: the full repo name (no truncation), item counts (e.g. "3 features, 1 research"), and a waiting/error summary if applicable.
- [ ] The header bar uses a distinct background (`--bg-surface` with bottom border) to visually separate it from the cards below.
- [ ] The header bar is sticky (`position: sticky; top: 0`) so it remains visible when scrolling through feature cards.
- [ ] The header bar has sufficient visual weight (larger font, semi-bold) to be immediately scannable.

### Detail area
- [ ] When a specific repo is selected, feature and research cards render in a single-column full-width layout (not the 2-column grid).
- [ ] The existing filter pills (All/implementing/waiting/submitted/error) appear below the repo header bar and scope to the selected repo only.
- [ ] All existing card functionality is preserved: status dots, timestamps, Copy cmd, Attach, Copy next, eval/research badges.
- [ ] When "All" is selected, the current 2-column grid layout renders as it does today (no header bar, filters scope globally).

### Keyboard navigation
- [ ] Arrow Up/Down moves focus between sidebar repo items.
- [ ] Enter selects the focused repo.
- [ ] The sidebar list uses roving tabindex (`tabindex="0"` on container, `tabindex="-1"` on items) for a single tab stop.

### Responsive
- [ ] On viewports narrower than 768px, the sidebar collapses to a dropdown/select above the content area instead of a fixed sidebar.

## Technical Approach

### Layout structure

```
body
├── .top (title, health, refresh — full width, unchanged)
├── .dashboard-body (display: flex)
│   ├── .repo-sidebar (width: 200px, flex-shrink: 0, overflow-y: auto, height: calc(100vh - top height))
│   │   ├── .sidebar-item.all ("All" option)
│   │   └── .sidebar-item * N (one per repo)
│   └── .detail-area (flex: 1, overflow-y: auto, height: calc(100vh - top height))
│       ├── .repo-header-bar (sticky, only when specific repo selected)
│       ├── #summary (filter pills)
│       ├── #repos (cards — single column or 2-col grid depending on mode)
│       └── #empty
```

### State

Add to existing state object:

```javascript
state.selectedRepo = localStorage.getItem('aigon.dashboard.selectedRepo') || 'all';
```

### Sidebar rendering

Build sidebar in `render()` from `data.repos`:

```javascript
function renderSidebar(repos) {
  const sidebar = document.getElementById('repo-sidebar');
  sidebar.innerHTML = '';
  // "All" option
  const allItem = document.createElement('button');
  allItem.className = 'sidebar-item' + (state.selectedRepo === 'all' ? ' active' : '');
  allItem.textContent = 'All Repos';
  allItem.onclick = () => selectRepo('all');
  sidebar.appendChild(allItem);
  // Per-repo items
  repos.forEach(repo => {
    const item = document.createElement('button');
    const totalItems = (repo.features || []).length + (repo.research || []).length;
    const hasWaiting = [...(repo.features || []), ...(repo.research || [])].some(f => f.agents.some(a => a.status === 'waiting'));
    const hasError = [...(repo.features || []), ...(repo.research || [])].some(f => f.agents.some(a => a.status === 'error'));
    item.className = 'sidebar-item' + (state.selectedRepo === repo.path ? ' active' : '');
    item.title = repo.displayPath; // tooltip
    // ... render name, badge, status dot
    item.onclick = () => selectRepo(repo.path);
    sidebar.appendChild(item);
  });
}
```

### Repo header bar

When `state.selectedRepo !== 'all'`, render a sticky header at the top of the detail area:

```html
<div class="repo-header-bar">
  <h2 class="repo-header-name">farline</h2>
  <span class="repo-header-meta">3 features, 1 research · 1 waiting</span>
</div>
```

### Detail area rendering

When a specific repo is selected, filter `data.repos` to just that repo and render cards in single-column layout. When "All", render the existing 2-column grid.

### CSS additions

```css
.dashboard-body {
  display: flex;
  gap: 0;
  height: calc(100vh - 90px); /* below top bar */
}

.repo-sidebar {
  width: 200px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-root);
  padding: 8px 0;
}

.sidebar-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  border-left: 3px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s ease;
}

.sidebar-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-item.active {
  border-left-color: var(--accent);
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.detail-area {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 28px;
}

.repo-header-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 12px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-root);
}

.repo-header-name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.repo-header-meta {
  color: var(--text-secondary);
  font-size: 13px;
}

/* Single column when viewing one repo */
.detail-area .repos.single-repo {
  grid-template-columns: 1fr;
}

@media (max-width: 768px) {
  .repo-sidebar { display: none; }
  .repo-select-mobile { display: block; }
}
```

## Validation

```bash
node -c lib/utils.js
```

Manual checks:
- Load dashboard with 5+ repos — sidebar shows all repos with badges
- Click a repo — detail area shows only that repo's cards, header bar shows full name
- Scroll down through many cards — header bar stays pinned at top
- Click "All" — returns to 2-column grid, no header bar
- Refresh page — selected repo is restored from localStorage
- Hover truncated name in sidebar — full name tooltip appears
- Arrow keys navigate sidebar, Enter selects
- Resize to narrow viewport — sidebar collapses to dropdown

## Dependencies

- None (extends existing dashboard template)

## Out of Scope

- Drag-to-resize sidebar width
- Sidebar repo ordering/favourites
- Sidebar search/filter box
- Collapsible icon-only sidebar mode
- Repo grouping or folders

## Related

- Feature 57: control-surface-dashboard-operator-console (broader dashboard improvements)
- `feature-dashboard-notification-drawer` (inbox — also adds UI to the dashboard header area)
- `templates/dashboard/index.html` — the single-file dashboard template
