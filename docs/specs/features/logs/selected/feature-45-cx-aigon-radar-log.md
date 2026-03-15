---
status: submitted
updated: 2026-03-15T22:41:45.859Z
startedAt: 2026-03-12T17:41:08+11:00
completedAt: 2026-03-12T17:48:27+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 45 - aigon-radar
Agent: cx

## Plan
- Add first-class `radar` command with lifecycle, API, repo registry, launchd, and menubar subcommands.
- Keep `collectDashboardStatusData()` as the single status data path and serve it via Radar.
- Deprecate `conductor` and `dashboard` by delegating to Radar.
- Move VS Code extension data source from direct filesystem parsing to Radar API.

## Progress
- Added Radar constants and service helpers:
  - PID/log/meta paths (`~/.aigon/radar.pid`, `~/.aigon/radar.log`, `~/.aigon/radar.json`)
  - background daemon runner (`runRadarServiceDaemon`)
  - `/api/status`, `/api/repos`, `/api/attach`, and dashboard HTML hosting
  - launchd plist writer for `radar install`
- Implemented `aigon radar` subcommands:
  - `start`, `stop`, `status`
  - `add`, `remove`, `list`
  - `open` (includes screenshot support for parity)
  - `install`, `uninstall` (launchd)
  - `menubar-install`, `menubar-uninstall`, `menubar-render`
  - `vscode-install`, `vscode-uninstall`
- Updated legacy command behavior:
  - `aigon conductor <subcommand>` now prints deprecation notice and delegates to `aigon radar <subcommand>`
  - `aigon dashboard` now prints deprecation notice and delegates to `aigon radar open`
- Updated VS Code extension:
  - replaced direct log/spec parsing as primary source with `GET /api/status`
  - reads Radar port from `~/.aigon/radar.json`
  - polls Radar API and renders repo/feature/agent tree from API payload
  - shows an explicit "Radar offline" state when service is unavailable
- Updated help/argument metadata to include Radar command surface.
- Validation run:
  - `node --check aigon-cli.js`
  - `node --check vscode-extension/extension.js`
  - `npm test -- --runInBand` (42 tests passed)
  - manual smoke checks for `radar start/status/stop`, `conductor status` delegation, and `/api/repos`

## Decisions
- Reused `collectDashboardStatusData()` as the canonical collector to avoid duplicate parsers and keep dashboard compatibility.
- Kept old `conductor` implementation code in place but unreachable for deprecated subcommands; this lowers migration risk while moving users to Radar.
- Implemented menubar rendering from Radar API payload so the plugin no longer needs direct filesystem status reads.

## Code Review

**Reviewed by**: cc (Claude Code, Opus 4.6)
**Date**: 2026-03-12

### Findings

1. **Dead code in `dashboard` handler** — After adding the deprecation `return`, the entire old dashboard handler body (~140 lines including HTTP server creation, screenshot logic, shutdown handlers) was left as unreachable dead code.
2. **`radar status` shows port/URL when stopped** — The status output showed `Port:` and `Dashboard:` lines even when the service wasn't running, which is misleading since the URL wouldn't be reachable.
3. **Menubar render missing "Needs Attention" section** — The old `menubar-render` had a prominent "Needs Attention" section at the top of the dropdown with actionable items (e.g. "All agents submitted", "Pick winner", agent waiting alerts with terminal-focus actions). The new `renderRadarMenubarFromStatus()` counts attention items for the title but doesn't render this section in the dropdown body. This is a functional regression from the old behavior but was not fixed in this review as it would require substantial new rendering logic.
4. **Menubar click-to-focus missing** — The old menubar rendered each agent row with `bash=` parameters to invoke `aigon terminal-focus` on click. The new version renders status text but the primary agent rows lack the `bash=` click action (only the alternate-click copy-command row has bash params).

### Fixes Applied

- `fix(review): remove dead code in dashboard handler and hide port/URL when stopped` — Removed 140 lines of unreachable code after the deprecation return in the `dashboard` handler. Wrapped the port/dashboard URL lines in `radar status` behind a `if (pid)` check so they only show when the service is running.

### Notes

- The implementation is architecturally solid — clean separation between the unified service (`runRadarServiceDaemon`), the HTTP API, and the command handler
- The VS Code extension migration from filesystem to HTTP API is well-done with proper fallback to "Radar offline" state
- The `conductor` deprecation delegation is smart about suppressing warnings for `menubar-render` (which is called by the SwiftBar plugin, not the user)
- Items 3 and 4 above (menubar attention section and click-to-focus) should be addressed in a follow-up iteration
