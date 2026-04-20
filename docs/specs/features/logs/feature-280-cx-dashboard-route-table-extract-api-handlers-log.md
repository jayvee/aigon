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
