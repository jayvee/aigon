# Implementation Log: Feature 199 - feature-status-panel-deep-status-on-demand
Agent: cc

## Plan

Replaced the polling/heartbeat approach with a pull-based deep status system:
1. New `lib/feature-status.js` — single collector function
2. New `/api/feature-status/:id` endpoint
3. New Status tab in the spec drawer
4. New `aigon feature-status <ID>` CLI command

## Progress

- Created `lib/feature-status.js` with `collectFeatureDeepStatus(repoPath, featureId)` — gathers session, progress, cost, spec data on demand
- Added API endpoint to `lib/dashboard-server.js` following existing route patterns
- Added Status tab to `templates/dashboard/js/detail-tabs.js` with dedicated fetch from new endpoint (not shared with other tabs' payload)
- Added CSS for deep-status grid sections in `templates/dashboard/styles.css`
- Added Status tab button to `templates/dashboard/index.html`
- Added `feature-status` CLI command to `lib/commands/feature.js` with formatted grid and `--json` output
- Registered command in `lib/templates.js` COMMAND_REGISTRY and `templates/help.txt`
- Updated CLAUDE.md module map

## Decisions

- **Separate fetch for Status tab**: The Status tab fetches from `/api/feature-status/:id` independently rather than reusing the detail payload. This keeps the deep status computation on-demand and avoids bloating the existing detail endpoint.
- **Section-based architecture**: Each data section (session, progress, cost, spec) has its own collector function, making it trivial to add new sections later.
- **Tmux for session liveness**: Uses `safeTmuxSessionExists()` from dashboard-status-helpers rather than heartbeat files, per spec.
- **Telemetry from .aigon/telemetry files**: Cost data reads normalized telemetry records rather than parsing raw transcripts, which is faster and already aggregated.
- **Git diff for progress**: Uses `git rev-list --count` and `git diff --numstat` against the default branch for commit/line stats.
- **Works for research entities**: The `entityType` option supports both features and research via the same collector.
