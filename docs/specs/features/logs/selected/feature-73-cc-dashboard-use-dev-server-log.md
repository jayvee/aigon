---
status: submitted
updated: 2026-03-16T13:33:13.192Z
startedAt: 2026-03-16T13:24:31.444Z
completedAt: 2026-03-16T13:33:13.192Z
events:
  - { ts: "2026-03-16T13:24:31.444Z", status: implementing }
  - { ts: "2026-03-16T13:24:46.098Z", status: implementing }
  - { ts: "2026-03-16T13:31:28.969Z", status: waiting }
  - { ts: "2026-03-16T13:32:48.687Z", status: submitted }
---

# Implementation Log: Feature 73 - dashboard-use-dev-server
Agent: cc

## Plan

Straightforward replacement: swap the three `~/.aigon/instances/` functions with existing dev-server registry functions. Key insight: the existing `detectDevServerContext()` uses empty string `''` for main repo's `serverId` in the registry, not `null`. Dashboard must match this convention to avoid breaking Caddy config generation (which uses `serverId ? ...` truthiness checks).

## Progress

1. Added `deriveServerIdFromBranch()` helper — parses `feature-71-cc-name` → `cc-71`
2. Extended `detectDashboardContext()` to return `serverId` alongside existing fields
3. Updated `runDashboardServer(port, instanceName, serverId)` to:
   - Call `registerDevServer` on `server.listen`
   - Call `deregisterDevServer` on shutdown (idle timeout + SIGINT/SIGTERM)
   - Print proxy URL + localhost in startup message when Caddy available
4. Updated dashboard commands (`list`, `open`, `status`) to read from `loadProxyRegistry()` filtered to `appId`
5. Updated "already running" check in `dashboard` (no subcommand) to use proxy registry
6. Removed `writeDashboardInstance`, `removeDashboardInstance`, `listDashboardInstances` functions and `DASHBOARD_INSTANCES_DIR` constant
7. Cleaned up imports in `shared.js`

## Decisions

- Used `serverId || ''` (empty string) for registry key operations, matching the existing dev-server convention from `detectDevServerContext()`. Using `null` would create a `"null"` string key in JSON, which Caddy generation would incorrectly treat as a truthy serverId.
- Used `serverId || null` for `getDevProxyUrl()` calls since that function checks truthiness (`if (serverId)`), and `null` correctly routes to `appId.test`.
- The startup message (`🚀 Dashboard: ...`) was moved inside `runDashboardServer` (after `server.listen`) since it now has the proxy URL information available there.
- `gcDevServers` already handles plain `pid` entries (the `else if (info.pid)` branch) — no changes needed there.
