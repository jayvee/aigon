# Feature: Aigon Radar

## Summary

Once you start using aigon on multiple repositories with multiple features in parallel, you need a radar to work out what's happening where and to be able to intercept and take over as required. Today that monitoring is fragmented across four overlapping components — the `conductor` daemon, the `conductor menubar-render` plugin, the `dashboard` HTTP server, and `conductor status` — all reading the same log-file front matter independently with duplicated code paths. Aigon Radar rationalizes this into one background service, one API, and many thin views.

## User Stories

- [ ] As a user running agents across multiple repos, I want a single AIGON server process that tracks all agent activity, so I don't have to start separate daemons and UI-serving processes.
- [ ] As a user, I want a clean HTTP API for all monitoring data, so that the menubar plugin, web dashboard, VS Code extension, and future native apps all consume the same source of truth.
- [ ] As a user, I want `aigon radar start` to give me everything (daemon + web dashboard + API) in one process, so setup is simple and there's only one thing to manage.
- [ ] As a user transitioning from `conductor`/`dashboard`, I want the old commands to keep working with deprecation warnings, so nothing breaks when I upgrade.

## Acceptance Criteria

- [ ] `aigon radar start` launches a single background process that combines the current `conductor` daemon polling and `dashboard` HTTP server
- [ ] `aigon radar stop` cleanly shuts down the unified service
- [ ] `aigon radar status` shows service state, registered repos, listening port, and current agent statuses (combines current `conductor status` and dashboard data)
- [ ] `aigon radar install` creates a launchd plist so the service starts automatically on login
- [ ] `aigon radar uninstall` removes the launchd plist
- [ ] `aigon radar add [path]` / `aigon radar remove [path]` manage the repo registry (replacing `conductor add`/`remove`)
- [ ] `aigon radar open` opens the web dashboard in the default browser
- [ ] `GET /api/status` returns the same data currently produced by `collectDashboardStatusData()` (line 1137 of `aigon-cli.js`)
- [ ] `GET /api/repos` returns the registered repo list
- [ ] `POST /api/attach` continues to work for terminal attachment (currently at line 9067)
- [ ] The menubar plugin (`menubar-render`) calls Radar's HTTP API instead of reading log files directly
- [ ] Running `aigon conductor start` prints a deprecation notice and delegates to `aigon radar start`
- [ ] Running `aigon dashboard` prints a deprecation notice and delegates to `aigon radar open`
- [ ] All four current data-reading code paths converge on one: the AIGON server's internal `collectStatus()` function

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Naming rationale

The word "conductor" is currently overloaded:
- `aigon conduct` — orchestrates multi-agent feature work (arena mode, pipeline mode). This stays as-is.
- `aigon conductor` — monitors agent status across repos. This becomes `aigon radar`.

"Radar" conveys the right mental model: a persistent scan of the environment that surfaces what needs attention. It complements `conduct` (active orchestration) without colliding with it.

### Architecture: One service, one API, many views

```
                     ┌──────────────────────────┐
                     │       AIGON Server        │
                     │  (single Node.js process)  │
                     │                            │
                     │  ┌──────────┐ ┌─────────┐ │
                     │  │ Poller   │ │  HTTP    │ │
                     │  │ (30s)    │ │  Server  │ │
                     │  └────┬─────┘ └────┬────┘ │
                     │       │            │       │
                     │  ┌────▼────────────▼────┐ │
                     │  │  collectStatus()     │ │
                     │  │  (single code path)  │ │
                     │  └──────────────────────┘ │
                     └──────────┬─────────────────┘
                                │
              ┌─────────┬───────┼────────┬──────────┐
              │         │       │        │          │
          Menubar    Web UI   VS Code  macOS      CLI
          (HTTP)    (HTML)   (HTTP)   notifs    status
```

### Unified service

Merge `runConductorDaemon()` (line 8386) and the `dashboard` HTTP server (line 9062) into a single process: `runRadarService()`. This process:

1. **Polls** every 30 seconds (existing daemon behavior from lines 8412–8519)
2. **Serves HTTP** on `127.0.0.1:4321` (existing dashboard behavior from lines 9062–9130)
3. **Sends macOS notifications** on status transitions (existing notification logic from lines 8404–8410, 8489–8510)
4. **Caches** the last poll result in memory so API responses are instant

The poller and HTTP server share a single `collectStatus()` function that replaces:
- `collectDashboardStatusData()` (line 1137) — full status with features, agents, eval state
- `parseFrontMatterStatus()` (line 8377) — lean status-only parser used by daemon
- Inline regex parsing in `conduct` monitor loop (line 8272)
- Inline parsing in `menubar-render` (line 8713)

### Command structure

```
aigon radar start [--port N]    # Start the AIGON server (default port 4321)
aigon radar stop                # Stop the AIGON server
aigon radar status              # Show service state + agent summary
aigon radar install             # Install launchd plist for auto-start on login
aigon radar uninstall           # Remove launchd plist
aigon radar add [path]          # Register a repo (default: cwd)
aigon radar remove [path]       # Unregister a repo
aigon radar list                # List registered repos
aigon radar open                # Open web dashboard in browser
```

### HTTP API specification

All endpoints return JSON with `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

| Method | Path | Description | Current equivalent |
|--------|------|-------------|-------------------|
| `GET` | `/api/status` | Full status data (repos, features, agents, summary counts) | `collectDashboardStatusData()` |
| `GET` | `/api/repos` | Registered repo list | `readConductorReposFromGlobalConfig()` |
| `POST` | `/api/attach` | Attach terminal to agent tmux session | Dashboard `/api/attach` (line 9067) |
| `GET` | `/` | Web dashboard HTML | Dashboard `buildDashboardHtml()` (line 1322) |

The `/api/status` response shape remains backwards-compatible with the current dashboard client-side `poll()` function (line 1612).

### Menubar migration

The menubar plugin (`menubar-render`, line 8713) currently reads log files directly using `parseFrontMatterStatus()`. After Radar:

1. `menubar-render` makes a single `GET http://127.0.0.1:4321/api/status` call
2. If the service is unreachable, it renders `⚙ offline` with a "Start Radar" action item
3. The rendering logic (SwiftBar/xbar format output, lines 8899–8941) stays the same — only the data source changes

### launchd integration

`aigon radar install` writes a launchd plist to `~/Library/LaunchAgents/com.aigon.radar.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aigon.radar</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/node</string>
        <string>/path/to/aigon-cli.js</string>
        <string>radar</string>
        <string>--daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>~/.aigon/radar.log</string>
    <key>StandardErrorPath</key>
    <string>~/.aigon/radar.log</string>
</dict>
</plist>
```

`aigon radar uninstall` runs `launchctl bootout` and removes the plist file.

### PID and log files

- PID file: `~/.aigon/radar.pid` (replaces `~/.aigon/conductor.pid`)
- Log file: `~/.aigon/radar.log` (replaces `~/.aigon/conductor.log`)

### Migration and deprecation

The following commands become aliases with deprecation warnings:

| Old command | New command | Behavior |
|-------------|-------------|----------|
| `aigon conductor start` | `aigon radar start` | Prints deprecation notice, then delegates |
| `aigon conductor stop` | `aigon radar stop` | Prints deprecation notice, then delegates |
| `aigon conductor status` | `aigon radar status` | Prints deprecation notice, then delegates |
| `aigon conductor add` | `aigon radar add` | Prints deprecation notice, then delegates |
| `aigon conductor remove` | `aigon radar remove` | Prints deprecation notice, then delegates |
| `aigon conductor list` | `aigon radar list` | Prints deprecation notice, then delegates |
| `aigon conductor menubar-install` | `aigon radar menubar-install` | Prints deprecation notice, then delegates |
| `aigon conductor menubar-uninstall` | `aigon radar menubar-uninstall` | Prints deprecation notice, then delegates |
| `aigon conductor vscode-install` | `aigon radar vscode-install` | Prints deprecation notice, then delegates |
| `aigon conductor vscode-uninstall` | `aigon radar vscode-uninstall` | Prints deprecation notice, then delegates |
| `aigon dashboard` | `aigon radar open` | Prints deprecation notice, then delegates |

The deprecation message format:

```
⚠ 'aigon conductor start' is deprecated — use 'aigon radar start' instead.
```

`aigon conduct` (orchestration) is **not affected** — it remains as-is.

### Implementation steps

1. **Create `radar` command handler** — register `'radar': (args) => { ... }` with subcommands `start`, `stop`, `status`, `install`, `uninstall`, `add`, `remove`, `list`, `open`
2. **Create `runRadarService()`** — merge `runConductorDaemon()` (line 8386) and dashboard HTTP server (line 9062) into one function. Use `collectDashboardStatusData()` as the single data source for both polling/notifications and API responses
3. **Refactor data reading** — make `collectDashboardStatusData()` (or a renamed `collectRadarStatus()`) the single code path. Remove `parseFrontMatterStatus()` (line 8377) and inline regex parsers
4. **Update `menubar-render`** — replace direct file reading with `GET /api/status` HTTP call, with fallback rendering when service is unavailable
5. **Add launchd support** — implement `install`/`uninstall` subcommands writing the plist
6. **Wire deprecation aliases** — update `conductor` command handler to delegate monitoring subcommands to `radar` with warnings. Update `dashboard` handler similarly
7. **Update VS Code extension** — point the extension's data source at Radar's HTTP API instead of direct file reading
8. **Update help/usage text** — update `usageArgs` and usage strings to reflect new command names

## Dependencies

- Feature: log-status-tracking (feature-31) — the front matter status contract that Radar reads
- Feature: conductor-daemon (feature-32) — being superseded by Radar
- Feature: conductor-vscode (feature-33) — view layer, will consume Radar's API
- Feature: conductor-menubar (feature-39) — view layer, will consume Radar's API
- Feature: conductor-web-dashboard (feature-41) — being merged into Radar

## Out of Scope

- Native macOS app (future view — would be a separate repo consuming Radar's API)
- iOS companion app (future view — separate repo)
- watchOS complication (future view — separate repo)
- Remote/cloud Radar (this is local-only, `127.0.0.1`)
- Changes to `aigon conduct` (orchestration) — that system is unaffected
- WebSocket push (polling is sufficient for current scale; can be added later)

## Open Questions

- Should the web dashboard auto-open on `aigon radar start`, or require explicit `aigon radar open`? Recommend: don't auto-open (the service is meant to run persistently in the background)
- Should Radar serve the VS Code extension data via the same HTTP API, or should the extension continue using file watching? Recommend: HTTP API for consistency, but file watching is acceptable since the extension already works
- Should `aigon radar status` include the web dashboard URL in its output? Recommend: yes, always show `Dashboard: http://127.0.0.1:4321` when running

## Supersedes

- Feature: conductor-daemon (feature-32) — daemon functionality absorbed into AIGON server
- Feature: conductor-web-dashboard (feature-41) — dashboard functionality absorbed into AIGON server
- Feature: conduct-daemon-integration (inbox) — the integration goals are achieved by Radar's unified architecture

## Related

- Feature: log-status-tracking (feature-31) — data contract
- Feature: conductor-vscode (feature-33) — view layer
- Feature: conductor-menubar (feature-39) — view layer
- Feature: conductor (feature-42) — `conduct` orchestration, unaffected
- Research: research-06-tmux-conductor — original monitoring research
