# Feature: conductor-web-dashboard

## Summary

A local web dashboard (`aigon dashboard`) that serves a self-contained HTML/JS page showing live agent status across all watched repos. No build step, no external dependencies — just `node aigon-cli.js dashboard` and open `localhost:4321`. Polls log file front matter every few seconds and renders a premium dark-themed dashboard inspired by Linear, Vercel, and modern AI agent orchestration tools. Slash commands are shown next to each waiting agent and copy to clipboard on click.

**Marketing note**: This dashboard doubles as a flagship visual for the aigon website. It must look screenshot-ready — professional enough to feature on aigon-site landing pages.

## User Stories

- [ ] As a developer, I want to open a browser tab and see a live view of all my agents' status across all my repos without touching a terminal
- [ ] As a developer, I want to click a waiting agent's slash command in the dashboard and have it copied to my clipboard ready to paste
- [ ] As a developer, I want the dashboard to auto-refresh so I never need to reload the page
- [ ] As a developer, I want the dashboard to feel like a premium tool (Linear/Vercel quality) not a dev prototype
- [ ] As a potential user, I want to see the dashboard on the aigon website and immediately understand what aigon does

## Acceptance Criteria

### Core functionality
- [ ] `aigon dashboard` starts an HTTP server on `localhost:4321` (configurable with `--port`)
- [ ] A browser tab opens automatically when the server starts
- [ ] The dashboard serves a single self-contained HTML page (no external CDN, no build step)
- [ ] The page shows one section per registered repo (from `~/.aigon/config.json`)
- [ ] Each repo section shows in-progress features with per-agent status rows
- [ ] Status indicators with CSS animations: `implementing` (blue pulsing dot), `waiting` (amber solid dot + glow), `submitted` (green static checkmark), `error` (red static dot)
- [ ] Waiting agents show their slash command (e.g. `/afd 30`) with a copy-to-clipboard button
- [ ] Page auto-refreshes agent data every 10 seconds via stale-while-revalidate polling
- [ ] `Ctrl+C` stops the server cleanly
- [ ] `aigon dashboard --port <N>` overrides the default port
- [ ] `aigon dashboard --no-open` starts the server without opening a browser tab
- [ ] Works correctly even when conductor-daemon is not running (reads log files directly)
- [ ] `node --check aigon-cli.js` passes

### Visual design
- [ ] Dark theme with near-black backgrounds (`#0a0a0b` root, `#111113` surface, `#1a1a1f` elevated)
- [ ] Subtle borders using `rgba(255,255,255,0.06)` — the Linear/Vercel "barely there" technique
- [ ] System font stack (no external fonts): `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`
- [ ] Monospace font for agent IDs and slash commands: `"SF Mono", "Cascadia Code", ui-monospace, monospace`
- [ ] 13px base font size (developer-tool density, not consumer 16px)
- [ ] Tight letter-spacing on headings (`-0.02em`) for premium feel
- [ ] `-webkit-font-smoothing: antialiased` for crisp macOS text rendering
- [ ] Single accent color: blue (`#3b82f6`) used sparingly for interactive elements
- [ ] Semantic colors: success green (`#22c55e`), warning amber (`#f59e0b`), error red (`#ef4444`)
- [ ] Cards with `border-radius: 12px`, subtle borders, hover state transitions (120ms ease)
- [ ] Cards with waiting agents get amber left-border accent and sort to top
- [ ] Uppercase section headers with wide letter-spacing (`0.04em`)
- [ ] `@media (prefers-reduced-motion: reduce)` disables all animations
- [ ] All CSS uses custom properties (`--bg-root`, `--text-primary`, etc.) for theming
- [ ] Total inline CSS under 6KB

### Premium UX features
- [ ] Global summary bar below header: `[N implementing] [N waiting] [N submitted]` with waiting count highlighted in amber
- [ ] Relative timestamps on all status rows ("2m ago", "just now") auto-updating every 30s
- [ ] Connection health indicator in header: green dot "Connected" / amber "Reconnecting..." / red "Disconnected"
- [ ] Document title badge: `(1) Aigon Dashboard` showing count of waiting agents
- [ ] Favicon badge: canvas-drawn count of waiting agents on the favicon (Chrome/Firefox)
- [ ] Toast notifications (bottom-right, auto-dismiss 5s) when an agent transitions to "waiting" or "error"
- [ ] Collapsible repo sections with state persisted in localStorage
- [ ] Empty states: helpful messages when no repos registered or no features in progress
- [ ] Copy-to-clipboard shows a brief "Copied!" toast confirmation

### Screenshot automation
- [ ] `aigon dashboard --screenshot` starts the server, waits for page load, captures a full-page screenshot, then exits
- [ ] Screenshot saved to `./docs/assets/dashboard-screenshot.png` (or configurable path with `--output`)
- [ ] Uses Puppeteer-style headless capture if available, or falls back to AppleScript-based macOS screenshot
- [ ] Screenshot dimensions: 1280x800 default (configurable with `--width` and `--height`)

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Server

A minimal `http.createServer()` in `aigon-cli.js` with two routes:

- `GET /` — serves the inline HTML/CSS/JS dashboard page
- `GET /api/status` — returns JSON: all repos, their in-progress features, and per-agent status

No npm dependencies. All HTML/CSS/JS is a template string inlined in `aigon-cli.js`.

### Data source

`/api/status` uses the same logic as `aigon conductor menubar-render` — globs for log files in each registered repo and worktree directories, parses front matter status, and returns structured JSON. Reads `~/.aigon/config.json` for the repos list.

### Frontend — Design System

The dashboard HTML is a single self-contained template string implementing a design system inspired by Linear and Vercel's Geist system, adapted for zero-dependency inline delivery.

#### CSS Architecture

Use `@layer` for cascade control:
```css
@layer reset, base, layout, components, utilities;
```

All values via CSS custom properties for consistency:
```css
:root {
  color-scheme: dark;
  --bg-root: #0a0a0b;        /* Near-black, not pure black (Linear technique) */
  --bg-surface: #111113;     /* Card backgrounds */
  --bg-elevated: #1a1a1f;    /* Hover/active states */
  --bg-hover: #222228;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.10);
  --text-primary: #ededef;
  --text-secondary: #a0a0a8;
  --text-tertiary: #6b6b76;
  --accent: #3b82f6;
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  /* ... plus spacing, radius, shadow, transition tokens */
}
```

#### Layout

Responsive CSS Grid: `grid-template-columns: repeat(auto-fit, minmax(360px, 1fr))` — automatically reflows from multi-column to single-column without media queries.

```
+====================================================================+
|  Aigon Dashboard         [Cmd+K]      * Connected    Updated: 8s   |
+====================================================================+
|                                                                      |
|  [3 implementing]   [!1 waiting]   [2 submitted]                     |
|                                                                      |
+----------------------------------------------------------------------+
|                                                                      |
|  ~/src/aigon  (4 agents)                                        [-]  |
|  ................................................................    |
|                                                                      |
|  +--------------------------------------------------------------+    |
|  | #55 conductor-web-dashboard                             3m   |    |
|  |                                                              |    |
|  |  (!) cc   WAITING        2m ago    [/afd 55 cc]  [Copy]      |    |
|  |  (*) gg   implementing   4m ago                              |    |
|  |  (v) cx   submitted      12m ago                             |    |
|  +--------------------------------------------------------------+    |
|                                                                      |
|  +--------------------------------------------------------------+    |
|  | #48 smart-validation                                   18m   |    |
|  |                                                              |    |
|  |  (*) cc   implementing   18m ago                             |    |
|  +--------------------------------------------------------------+    |
|                                                                      |
+----------------------------------------------------------------------+
|                                                                      |
|  ~/src/my-web-app  (1 agent)                                    [-]  |
|  ................................................................    |
|                                                                      |
|  +--------------------------------------------------------------+    |
|  | #12 dark-mode                                          7m    |    |
|  |                                                              |    |
|  |  (*) solo  implementing  7m ago                              |    |
|  +--------------------------------------------------------------+    |
|                                                                      |
+----------------------------------------------------------------------+
```

#### Status Animations (CSS-only)

- **Implementing**: Blue/cyan dot with `pulse` keyframe (scale + opacity, GPU-composited)
- **Waiting**: Amber solid dot — no animation but subtle glow `box-shadow`
- **Submitted**: Green static checkmark
- **Error**: Red static dot with subtle glow

```css
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(2.5); opacity: 0; }
}
```

All animations use only `transform` and `opacity` (GPU compositor, no layout thrashing).

#### Key Design Principles

1. **Near-black, not pure black** — `#0a0a0b` adds warmth vs harsh `#000`
2. **Barely-visible borders** — `rgba(255,255,255,0.06)` creates structure through subtlety
3. **Tight letter-spacing** — `-0.02em` on headings, `0.04em` on uppercase labels
4. **Single accent color** — one blue, used only for interactive elements and active status
5. **Color means status** — color is reserved for meaning, not decoration
6. **13px base font** — developer-tool density
7. **120ms transitions** — fast enough to feel instant, slow enough to be noticed
8. **Layered shadows** — two shadow layers for natural depth perception
9. **Monochrome + color-as-signal** — everything is grayscale except status indicators

### Polling / Real-time

Stale-while-revalidate pattern:
1. Page loads → render cached/initial data immediately (no full-page loading state)
2. Every 10s → `fetch('/api/status')`
3. Diff response against current DOM state
4. Only animate elements that changed (fade-in-up for new items)
5. Update relative timestamps and "Last updated" indicator

Track consecutive poll failures for connection health:
- 0 failures: green "Connected"
- 1 failure: amber "Reconnecting..."
- 3+ failures: red "Disconnected"

### Toast Notifications

Bottom-right positioned, max 3 visible, auto-dismiss after 5 seconds. Triggered on state transitions to "waiting" or "error" only (actionable states). Include "Copy command" action button on waiting toasts.

### Favicon Badge

Canvas-based dynamic favicon showing count of waiting agents. Update on each poll. Works in Chrome/Firefox (Safari degrades gracefully to static favicon).

```javascript
function updateFavicon(count) {
  if (!count) { resetFavicon(); return; }
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  // Draw badge circle in amber
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.arc(24, 8, 8, 0, Math.PI * 2); ctx.fill();
  // Draw count
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(String(count), 24, 12);
  document.querySelector('link[rel="icon"]').href = canvas.toDataURL();
}
```

### Screenshot Automation

`aigon dashboard --screenshot` flow:
1. Start HTTP server on ephemeral port
2. If Puppeteer is available (global or project): headless Chrome capture at 1280x800
3. If not: use `screencapture` (macOS) + AppleScript to open and capture
4. Save PNG to specified output path
5. Shut down server and exit

This enables automated screenshot generation for aigon-site content.

### Repo registry

Uses `~/.aigon/config.json` `repos` array (same as conductor-daemon). If no repos are registered, shows a friendly empty state with the `aigon conductor add` command.

### Port conflict

If port 4321 is in use, prints a clear error and exits. Does not silently try another port.

## Design References

- **Linear** — Near-black backgrounds, LCH color system, Inter Display headings, tight spacing, barely-visible borders, subtle elevated surfaces. [Linear UI Redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)
- **Vercel Geist** — Two background tokens (bg-100, bg-200), 10-step gray scale, semantic color scales (green/amber/red/blue), Geist Sans/Mono. [Geist Colors](https://vercel.com/geist/colors)
- **Mission Control** (builderz-labs) — Open-source AI agent orchestration dashboard with Kanban, WebSocket+SSE updates, 26 panels, SQLite. [GitHub](https://github.com/builderz-labs/mission-control)
- **Buildkite Build Canvas** — DAG visualization with Canvas/Table/Waterfall views, "Follow mode" for running builds, "Go to failure" shortcut. [Build Canvas](https://buildkite.com/resources/blog/visualize-your-ci-cd-pipeline-on-a-canvas/)
- **claude-code-monitor** — Real-time multi-session monitoring with mobile web UI. [GitHub](https://github.com/onikan27/claude-code-monitor)

## Competitor Landscape

| Tool | UI Type | Key Design Pattern |
|------|---------|-------------------|
| CrewAI AMP | Cloud dashboard | Workflow builder, dark theme, node-based visualization |
| AutoGen Studio | Local web | Build/Playground/Gallery tabs, drag-drop agent config |
| LangGraph Studio | Desktop app | Split panel: graph visualization + chat interaction |
| OpenHands | Local web | Monaco editor + terminal + chat, React frontend |
| Mission Control | Local web | 26-panel Kanban, WebSocket real-time, SQLite |
| Devin | Cloud IDE | Full IDE with terminal, browser, planner panel |
| Bolt.new / v0.dev | Cloud | Chat + live preview, shadcn/ui components |

**Aigon's differentiator**: Zero-dependency single-file dashboard that looks as good as these tools without requiring React, a build step, or external services. Start with `aigon dashboard`, done.

## Phase 2 Features (out of scope for v1, but designed for)

- Command palette (Cmd+K) for quick actions (copy commands, jump to repo, toggle settings)
- Browser Notification API (opt-in) for OS-level alerts when tab not focused
- Sound notifications (opt-in, mute toggle) — short chime on waiting transition
- Keyboard navigation (j/k to navigate agents, Enter to copy command)
- Light theme toggle (all CSS is custom-property based, so theme switching is trivial)

## aigon-site Feature Page

After the dashboard is implemented, create a feature page on aigon-site:

1. Run `aigon dashboard --screenshot` with sample data to capture a hero image
2. Create a page at `/features/dashboard` on aigon-site
3. Content: hero screenshot, feature bullets, "zero dependencies" callout, `aigon dashboard` install command
4. Use the same dark aesthetic for the page to match the dashboard screenshots

## Dependencies

- Feature: log-status-tracking (required — dashboard reads log front matter)
- Feature: conductor-daemon (optional — daemon populates the same data; dashboard is independent)

## Out of Scope

- Authentication or multi-user access (local tool only)
- Persistent server / launchd registration (manual start only for now)
- Native macOS app (conductor-menubar covers the lightweight always-on case)
- WebSocket-based push updates (polling is sufficient for this use case)
- React, Vue, or any JS framework (the whole point is zero dependencies)
- External CSS frameworks, CDN resources, or web fonts

## Open Questions

- Should `aigon dashboard` register the repo automatically if cwd is an Aigon project not yet in `~/.aigon/config.json`?
- Should the screenshot automation use a mock data mode for consistent marketing screenshots?

## Related

- Feature: log-status-tracking (prerequisite)
- Feature: conductor-daemon (shares the same data source and repo registry)
- Feature: conductor-menubar (lightweight always-visible alternative)
