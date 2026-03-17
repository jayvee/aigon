---
status: submitted
updated: 2026-03-17T03:05:10.385Z
startedAt: 2026-03-17T02:57:30.826Z
events:
  - { ts: "2026-03-17T02:57:30.826Z", status: implementing }
  - { ts: "2026-03-17T03:00:13.992Z", status: implementing }
  - { ts: "2026-03-17T03:02:25.018Z", status: waiting }
  - { ts: "2026-03-17T03:05:10.385Z", status: submitted }
---

# Implementation Log: Feature 75 - proxy-caddy-api-routes
Agent: cc

## Plan

Switch the Caddy proxy integration from full Caddyfile regeneration + reload to atomic per-route operations via Caddy's JSON admin API (`localhost:2019`). Each route gets a stable `@id` tag derived from `aigon-{appId}-{serverId}`, enabling individual ADD/REMOVE without affecting other routes. Full Caddyfile fallback retained for when the admin API is unreachable.

## Progress

**`lib/utils.js`** — added 5 new functions before `generateCaddyfile()`:
- `getCaddyRouteId(appId, serverId)` — returns `aigon-{appId}-{serverId}` (or `aigon-{appId}` for empty serverId)
- `isCaddyAdminAvailable()` — `curl -sf --max-time 1 http://localhost:2019/config/`
- `writeCaddyfileBackup(registry)` — writes Caddyfile without reloading (backup reference only)
- `addCaddyRoute(hostname, port, routeId)` — POSTs route JSON via temp file to `/config/apps/http/servers/srv0/routes`; falls back to `reloadCaddy()` on failure
- `removeCaddyRoute(routeId)` — DELETEs route at `/id/{routeId}`; falls back to `reloadCaddy()` on failure

**Updated callers:**
- `registerDevServer()` — calls `addCaddyRoute()` instead of `reloadCaddy()`
- `deregisterDevServer()` — calls `removeCaddyRoute()` instead of `reloadCaddy()`
- `gcDevServers()` — tracks removed route IDs and calls `removeCaddyRoute()` per route

**`aigon-cli.test.js`** — added 3 unit tests for `getCaddyRouteId()`:
- Non-empty serverId format (`aigon-aigon-cc-74`)
- Empty serverId format (`aigon-aigon`)
- Uniqueness across all appId/serverId pairs

All 140 previously-passing tests still pass (2 pre-existing unrelated failures unchanged).

## Decisions

**Sync HTTP via curl + temp file** — `http.request()` is async but `registerDevServer`/`deregisterDevServer` are synchronous. Using `execSync` with a curl command keeps the sync interface without refactoring call sites. A temp file is used for the JSON body to avoid shell quoting issues with single quotes in JSON.

**`loadProxyRegistry()` in fallback** — both `addCaddyRoute` and `removeCaddyRoute` call `loadProxyRegistry()` in the fallback path rather than accepting a registry parameter. By the time these functions are called, the registry has already been updated and saved, so loading fresh gives the correct current state. This keeps the function signatures clean (no registry parameter needed).

**`writeCaddyfileBackup` on success** — after each successful admin API call, the Caddyfile is written as a reference/backup. This satisfies the spec requirement that `DEV_PROXY_CADDYFILE` still be written, and keeps it in sync for operators who inspect it manually.

**Empty serverId route ID** — `getCaddyRouteId('aigon', '')` returns `aigon-aigon` (not `aigon-aigon-`). The trailing hyphen would be confusing; the conditional handles the empty case explicitly.

**`gcDevServers` per-route removal** — tracks `removedRouteIds` during the GC loop and calls `removeCaddyRoute()` for each. In the admin API failure case, each call falls back to a full reload — multiple reloads are wasteful but correct, and GC is an infrequent background operation.
