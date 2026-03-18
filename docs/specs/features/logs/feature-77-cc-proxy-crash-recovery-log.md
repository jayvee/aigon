---
status: submitted
updated: 2026-03-17T03:40:55.503Z
startedAt: 2026-03-17T03:20:32.779Z
completedAt: 2026-03-17T03:40:55.503Z
events:
  - { ts: "2026-03-17T03:20:32.779Z", status: implementing }
  - { ts: "2026-03-17T03:26:23.654Z", status: implementing }
  - { ts: "2026-03-17T03:30:56.521Z", status: waiting }
  - { ts: "2026-03-17T03:35:42.305Z", status: submitted }
---

# Implementation Log: Feature 77 - proxy-crash-recovery
Agent: cc

## Plan

All proxy helper functions (`addCaddyRoute`, `removeCaddyRoute`, `getCaddyRouteId`, `isCaddyAdminAvailable`) already existed in `lib/utils.js` from feature 75. The approach was to build directly on those:

1. Add `getCaddyLiveRoutes()` to fetch the current Caddy route table via `GET /config/apps/http/servers/srv0/routes`
2. Add `registryHasRoute()` as a lookup helper
3. Add `reconcileProxyRoutes()` that diffs `servers.json` against Caddy's live state and fixes discrepancies
4. Wire reconciliation into `dashboard` startup and `doctor` command in `lib/commands/shared.js`

## Progress

**`lib/utils.js` — 3 new exported functions:**

- `getCaddyLiveRoutes()` (line ~940): Uses `execSync` with curl (consistent with existing codebase pattern) to GET Caddy's admin API routes endpoint. Returns `Map<routeId, routeConfig>`. Returns empty Map if Caddy unavailable or no HTTP config — graceful no-op.

- `registryHasRoute(registry, routeId)` (line ~963): Iterates registry to check if a given `getCaddyRouteId()`-style ID is present. Used for orphan detection.

- `reconcileProxyRoutes()` (line ~974): Core reconciliation logic:
  - Guard: returns `{added:0, removed:0, unchanged:0, cleaned:0}` if `isProxyAvailable()` is false (Caddy not installed/running or proxy-setup not done)
  - Phase 1: For each servers.json entry, check PID aliveness (handles both radar nested entries and regular entries). Dead → clean from registry + remove from Caddy if live. Alive but missing route → re-add via `addCaddyRoute()`. Both alive and live → `unchanged++`
  - Phase 2: Remove `aigon-*` Caddy routes that aren't in the registry (orphans from deleted worktrees)
  - Saves cleaned registry and returns counts

**`lib/commands/shared.js` — integration:**

- Added `getCaddyLiveRoutes, registryHasRoute, reconcileProxyRoutes` to the destructured imports
- `dashboard` startup: calls `reconcileProxyRoutes()` before `runDashboardServer()` when proxy is available; prints `🔄 Proxy reconciled: N routes added, N orphans removed, N unchanged` only when something changed
- `doctor` command: new "Proxy Health" section before "Model Health Check"; shows `✅ Proxy reconciled: N routes unchanged` when clean, or lists what was fixed; shows warning if proxy unavailable

**`aigon-cli.test.js` — 7 new tests:**
- `getCaddyLiveRoutes` returns a Map (type check, works in no-Caddy CI)
- `registryHasRoute` returns correct true/false results
- `registryHasRoute` returns false on empty registry
- `reconcileProxyRoutes` returns object with correct shape when proxy unavailable
- `reconcileProxyRoutes` cleans dead registry entries (with real DEV_PROXY_REGISTRY swap)
- `reconcileProxyRoutes` is idempotent (second call returns added=0, removed=0)

## Decisions

**Synchronous vs async**: The spec shows `async function reconcileProxyRoutes()` but all existing proxy helper functions use `execSync` (curl, pgrep, caddy). Made `reconcileProxyRoutes` synchronous to be consistent. This avoids making the `doctor` command async and matches the existing `gcDevServers` pattern.

**Early return on `!isProxyAvailable()`**: Returns zeros immediately if Caddy isn't installed, running, or proxy-setup hasn't been done. This is correct because: (a) if Caddy isn't running there's nothing to reconcile; (b) if proxy-setup hasn't been run, there's no Caddyfile and reconciliation isn't meaningful. Post-reboot with Caddy configured to auto-start (launchd), `isProxyAvailable()` returns true, so reconciliation runs correctly.

**Radar entry handling**: The `gcDevServers` function already handles both radar entries (`info.service && info.dashboard`) and regular entries (`info.pid`). Mirrored that pattern exactly in `reconcileProxyRoutes`. For radar entries, both service AND dashboard PIDs must be alive to keep the entry (partial-dead = clean).

**Console output threshold**: Only prints the `🔄 Proxy reconciled:` message in dashboard when something actually changed (parts.length > 0). In doctor, always shows the section (useful diagnostic even when nothing changed).

**`proxy-setup` command**: Listed in `lib/commands/setup.js` COMMAND_NAMES but no handler exists in `shared.js` (the filter silently drops undefined handlers). Did not implement `proxy-setup` — out of scope for this feature. When/if it's added, it can call `reconcileProxyRoutes()` the same way.

**Test for idempotency**: The test calls reconcile twice and checks the second call returns `added=0, removed=0`. This correctly captures the key invariant (stable state) without relying on the first call's counts (which vary depending on whether Caddy is running in the test environment).
