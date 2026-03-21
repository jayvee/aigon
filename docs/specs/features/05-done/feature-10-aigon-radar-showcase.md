# Feature: Aigon Radar Showcase

## Summary

Replace the existing `#menubar` section of the aigon website with a broader "Aigon Radar" section that showcases the full monitoring story: the unified background service, the web dashboard, and the macOS menubar — all powered by one API. Once you start using aigon on multiple repositories with multiple features in parallel, you need a radar to work out what's happening where and to be able to intercept and take over as required. This section should make that value proposition visceral.

## User Stories

- [ ] As a visitor, I want to understand what Aigon Radar is and why I'd need it, so I can see the value of monitoring multi-agent work.
- [ ] As a visitor, I want to see the web dashboard in action, so I can visualise what the monitoring experience looks like.
- [ ] As a visitor, I want to see the menubar integration, so I know there's always-on visibility without leaving my workflow.
- [ ] As a visitor, I want clear setup commands, so I know exactly how to get Radar running.

## Acceptance Criteria

- [ ] The `#menubar` section is replaced with a new `#radar` section
- [ ] The nav link updates from "Menubar" to "Radar"
- [ ] The section showcases three views: web dashboard, macOS menubar, and macOS notifications
- [ ] A dashboard screenshot or mockup is included (needs `img/aigon-radar-dashboard.png`)
- [ ] The existing menubar screenshot (`img/aigon-menubar.png`) is retained or updated
- [ ] Setup commands use `aigon radar` (not the deprecated `aigon conductor`)
- [ ] The eyebrow/heading conveys the "one service, many views" concept
- [ ] The four detail cards are updated to reflect Radar's capabilities (dashboard, menubar, notifications, auto-start)
- [ ] The section maintains the existing design language (warm palette, Sora headings, menubar-grid layout)

## Validation

```bash
# HTML syntax check (basic)
python3 -c "from html.parser import HTMLParser; HTMLParser().feed(open('index.html').read())"
```

## Technical Approach

### Section structure

Replace the `#menubar` section (lines 329–375 of `index.html`) with a new `#radar` section that follows the same layout pattern (`.menubar-grid` or a new `.radar-grid`):

**Left column (text):**
- Eyebrow: "Always-on visibility"
- H2: "Radar: one service, every view."
- Lead paragraph introducing Radar — the unified monitoring service that watches all repos, exposes an HTTP API, and powers the web dashboard, menubar, VS Code sidebar, and notifications
- Four detail cards:
  1. **Web Dashboard** — Live dashboard at `localhost:4321` showing all repos, features, agents with status badges, attention items, and one-click terminal attach
  2. **Menubar** — Persistent macOS menu bar icon with live counts, "Needs Attention" at the top, click to jump to terminal
  3. **Notifications** — macOS notifications when agents need input or all agents submit, so you can step away from the screen
  4. **Always Running** — `aigon radar install` sets up launchd auto-start, service runs in the background, survives reboots
- Setup code block:
  ```
  aigon radar add
  aigon radar start
  aigon radar install
  aigon radar open
  ```

**Right column (visuals):**
- Dashboard screenshot (`img/aigon-radar-dashboard.png`) — primary visual, larger
- Menubar screenshot (`img/aigon-menubar.png`) — secondary, smaller below

### Nav update

Change the nav link:
```html
<li><a href="#radar" class="nav-link">Radar</a></li>
```

### Screenshots needed

1. **Dashboard screenshot** — Capture using `aigon radar open --screenshot` from a repo with active features. This is the hero image for the section.
2. **Menubar screenshot** — The existing `img/aigon-menubar.png` may need updating if the menubar output has changed with Radar.

### CSS changes

Minimal — reuse the existing `.menubar-grid`, `.menubar-details`, `.menubar-detail`, `.menubar-screenshot` classes. If a second image is added, add a simple `.radar-visuals` wrapper to stack them vertically in the right column.

## Dependencies

- Aigon feature 45 (aigon-radar) must be released so the `aigon radar` commands exist
- A dashboard screenshot is needed — can be captured with `aigon radar open --screenshot`

## Out of Scope

- VS Code sidebar showcase (could be a separate section later)
- Interactive/animated dashboard demo (static screenshot is sufficient for now)
- Renaming CSS classes from `.menubar-*` to `.radar-*` (cosmetic, not user-facing)

## Open Questions

- Should the dashboard screenshot show a busy state (many features/agents) or a clean state (one or two features)? Recommend: busy state — it demonstrates the value of having a radar.
- Should the section include a brief mention of the VS Code sidebar as a fourth view? Recommend: yes, one line mentioning it exists, but don't make it a detail card since there's no screenshot for it yet.

## Related

- Feature: aigon feature-45 (aigon-radar) — the CLI/service implementation
- Feature: aigon-site feature-07 (menubar-showcase) — the section being replaced
