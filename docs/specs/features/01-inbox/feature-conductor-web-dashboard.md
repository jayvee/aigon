# Feature: conductor-web-dashboard

## Summary

A local web dashboard (`aigon dashboard`) that serves a self-contained HTML/JS page showing live agent status across all watched repos. No build step, no external dependencies — just `node aigon-cli.js dashboard` and open `localhost:4321`. Polls log file front matter every few seconds and renders a Kanban-style view per repo. Slash commands are shown next to each waiting agent and copy to clipboard on click.

## User Stories

- [ ] As a developer, I want to open a browser tab and see a live view of all my agents' status across all my repos without touching a terminal
- [ ] As a developer, I want to click a waiting agent's slash command in the dashboard and have it copied to my clipboard ready to paste
- [ ] As a developer, I want the dashboard to auto-refresh so I never need to reload the page

## Acceptance Criteria

- [ ] `aigon dashboard` starts an HTTP server on `localhost:4321` (configurable with `--port`)
- [ ] A browser tab opens automatically when the server starts
- [ ] The dashboard serves a single self-contained HTML page (no external CDN, no build step)
- [ ] The page shows one section per registered repo (from `~/.aigon/config.json`)
- [ ] Each repo section shows in-progress features with per-agent status rows
- [ ] Status indicators: `implementing` (grey), `waiting` (amber), `submitted` (green)
- [ ] Waiting agents show their slash command (e.g. `/afd 30`) with a copy-to-clipboard button
- [ ] Page auto-refreshes agent data every 10 seconds via polling
- [ ] `Ctrl+C` stops the server cleanly
- [ ] `aigon dashboard --port <N>` overrides the default port
- [ ] `aigon dashboard --no-open` starts the server without opening a browser tab
- [ ] Works correctly even when conductor-daemon is not running (reads log files directly)
- [ ] `node --check aigon-cli.js` passes

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

`/api/status` uses the same logic as `aigon status` — globs for log files in each registered repo, parses front matter, and returns the result as JSON. Reads `~/.aigon/config.json` for the repos list.

### Frontend

The dashboard HTML is a single self-contained template string. It uses:

- Plain CSS (no framework) — dark-ish theme, clean cards per repo
- `setInterval` polling `GET /api/status` every 10 seconds
- `navigator.clipboard.writeText()` to copy slash commands on click
- No React, no build, no CDN — zero external dependencies

### Layout

```
┌─ ~/src/aigon ──────────────────────────────────────┐
│ #30 board-action-hub                                │
│   cc  ● waiting    [/afd 30 cc]                     │
│   gg  ○ implementing                                │
│   cx  ✓ submitted                                   │
├─ ~/src/my-web-app ─────────────────────────────────┤
│ #12 dark-mode                                       │
│   solo  ● waiting  [/afd 12]                        │
└────────────────────────────────────────────────────┘
```

### Repo registry

Uses `~/.aigon/config.json` `repos` array (same as conductor-daemon). If no repos are registered, shows a message with the `aigon conductor add` command.

### Port conflict

If port 4321 is in use, prints a clear error and exits. Does not silently try another port.

## Dependencies

- Feature: log-status-tracking (required — dashboard reads log front matter)
- Feature: conductor-daemon (optional — daemon populates the same data; dashboard is independent)

## Out of Scope

- Authentication or multi-user access (local tool only)
- Persistent server / launchd registration (manual start only for now)
- Native macOS app (conductor-menubar covers the lightweight always-on case)
- WebSocket-based push updates (polling is sufficient for this use case)
- Windows/Linux (macOS first, though the Node.js server would work cross-platform)

## Open Questions

- Should `aigon dashboard` register the repo automatically if cwd is an Aigon project not yet in `~/.aigon/config.json`?

## Related

- Feature: log-status-tracking (prerequisite)
- Feature: conductor-daemon (shares the same data source and repo registry)
- Feature: conductor-menubar (lightweight always-visible alternative)
