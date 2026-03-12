---
status: submitted
updated: 2026-03-12T06:41:08.866Z
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
