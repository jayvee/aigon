---
commit_count: 5
lines_added: 1759
lines_removed: 1784
lines_changed: 3543
files_touched: 6
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 7078151
output_tokens: 46178
cache_creation_input_tokens: 0
cache_read_input_tokens: 6541952
thinking_tokens: 8562
total_tokens: 7124329
billable_tokens: 7132891
cost_usd: 15.8341
sessions: 3
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 280 - dashboard-route-table-extract-api-handlers
Agent: cx

## Plan
- Extract the inline dashboard `/api/...` request chain into a dedicated OSS route dispatcher module.
- Keep `lib/dashboard-server.js` as transport and server-state glue only.
- Validate with syntax checks, repo tests, dashboard restart, live HTTP smoke checks, and a dashboard screenshot.

## Progress
- Added `lib/dashboard-routes.js` with a route-table dispatcher and extracted OSS API handlers.
- Replaced the inline `/api/...` if/else chain in `lib/dashboard-server.js` with a single `dashboardRoutes.dispatchOssRoute(...)` call.
- Built an explicit dashboard server context so extracted handlers still use the same shared helpers and mutable server state.
- Restarted the dashboard service and smoke-tested live endpoints: `/api/status`, `/api/workflows`, and `/api/analytics?force=1`.
- Captured a post-change dashboard screenshot at `tmp/dashboard-route-extraction.png`.

## Decisions
- Used a dedicated OSS dispatcher in `lib/dashboard-routes.js` rather than changing `lib/pro-bridge.js`; this keeps Pro behavior isolated while making the OSS route shape visually match the Pro dispatch seam.
- Passed server-owned mutable state through context accessors instead of moving authority out of `dashboard-server.js`.
- Preserved dynamic route compatibility by allowing exact, regex, and predicate path matchers inside the route table.
- Updated `AGENTS.md` and `docs/architecture.md` in the same change because the extraction adds a new core module and changes dashboard-server responsibilities.
- `npm test` passed.
- `MOCK_DELAY=fast npm run test:ui` failed in this environment because Playwright Chromium could not launch (`MachPortRendezvousServer ... Permission denied (1100)`), so route behavior was validated with live HTTP smoke requests instead.

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-20

### Findings
- **Pro-bridge dispatch removed** — the inline request handler used to call `proBridge.dispatchProRoute(req.method, reqPath, req, res)` right after the OSS branches, followed by a `/api/insights` upgrade-payload fallback when Pro is unavailable. Both were dropped during extraction, so every `@aigon/pro`-owned route (`/api/insights`, `/api/insights/refresh`, etc.) fell through to static serving and 404'd. This violates AC2 (no behavior change) and AC4 (dispatcher shares shape with `proBridge.dispatchProRoute`).

### Fixes Applied
- `fix(review): restore pro-bridge dispatch and /api/insights fallback` — re-inserted both calls right after `dispatchOssRoute()` in `lib/dashboard-server.js`, preserving original ordering (OSS first, then Pro, then insights fallback, then static). Verified with `npm test`, `MOCK_DELAY=fast npm run test:ui` (7/7 passed), and live smoke: `curl /api/insights` now returns the Pro payload through the bridge instead of 404.

### Notes
- The two spec-file deletions in the `main..HEAD` diff (`feature-add-opencode-cli-coding-agent.md`, `feature-282-fix-entity-submit-silent-signal-loss.md`) are just newer main commits that weren't on this branch at worktree time — not a review concern, they'll merge back in cleanly.
- E2e Playwright suite runs fine in this environment; the implementer's Chromium launch failure was environmental.
- The `/api/spec` predicate (`reqPath.startsWith('/api/spec')`, GET) is ordered safely after the POST `/api/spec-reconcile` and POST `/api/spec/create` entries; method filtering prevents cross-matches.

