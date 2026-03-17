# Feature: proxy-caddy-api-routes

## Summary

Switch from generating a Caddyfile and running `caddy reload` to using Caddy's JSON admin API (`POST /config/apps/http/servers/...`) with per-route `@id` tags. This eliminates the entire class of desync bugs where the Caddyfile is written but the reload fails silently because Caddy's admin socket isn't ready. Each route gets a stable `@id` derived from the serverId, enabling atomic add/remove without touching other routes.

## User Stories

- [ ] As a developer, when I run `aigon dashboard` or start a dev server, the proxy route is added instantly without affecting other running services
- [ ] As a developer, when I stop a dev server, only that specific route is removed — other routes remain unaffected
- [ ] As a developer, I never see stale routes in Caddy that point to stopped servers

## Acceptance Criteria

- [ ] `generateCaddyfile()` (lib/utils.js:853) is replaced by `addCaddyRoute(hostname, port, routeId)` that POSTs to Caddy's admin API
- [ ] `reloadCaddy()` (lib/utils.js:876) is replaced by per-route `addCaddyRoute()` / `removeCaddyRoute()` — no full config reload
- [ ] Each route uses `@id` tag format: `aigon-{appId}-{serverId}` (e.g., `aigon-aigon-cc-74`)
- [ ] `registerDevServer()` calls `addCaddyRoute()` instead of `reloadCaddy()`
- [ ] `deregisterDevServer()` calls `removeCaddyRoute()` instead of `reloadCaddy()`
- [ ] If Caddy admin API is unreachable, fall back to Caddyfile generation + reload (graceful degradation)
- [ ] `DEV_PROXY_CADDYFILE` is still written as a backup/reference but is no longer the primary mechanism
- [ ] All existing tests pass; `node -c lib/utils.js` exits 0

## Validation

```bash
node -c lib/utils.js && node -c aigon-cli.js && npm test
```

## Technical Approach

### Caddy Admin API

Caddy exposes a JSON admin API on `localhost:2019` by default. Routes can be added/removed individually:

```
# Add a route with @id
POST http://localhost:2019/config/apps/http/servers/srv0/routes
{
  "@id": "aigon-aigon-cc-74",
  "match": [{"host": ["cc-74.aigon.test"]}],
  "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "localhost:4102"}]}]
}

# Remove a route by @id
DELETE http://localhost:2019/id/aigon-aigon-cc-74
```

### New Functions in lib/utils.js

- `addCaddyRoute(hostname, port, routeId)` — POST route to admin API; on failure, fall back to Caddyfile
- `removeCaddyRoute(routeId)` — DELETE route by @id; on failure, regenerate Caddyfile
- `isCaddyAdminAvailable()` — GET `localhost:2019/config/` to check if admin API is live
- `getCaddyRouteId(appId, serverId)` — returns `aigon-${appId}-${serverId}` string

### Migration Path

1. Add new admin API functions alongside existing Caddyfile functions
2. Update `registerDevServer()` and `deregisterDevServer()` to prefer admin API
3. Keep `generateCaddyfile()` as fallback — called only when admin API is unreachable
4. `proxy-setup` command ensures Caddy starts with admin API enabled (default behavior)

### HTTP Client

Use Node.js built-in `http.request()` — no new dependencies. All admin API calls are to `localhost:2019`.

## Dependencies

- Caddy must be running with admin API enabled (default; no config change needed)
- No external npm dependencies required

## Out of Scope

- Replacing dnsmasq (stays as-is per research-12 decision)
- Replacing Caddy with a Node.js proxy (evaluated but rejected in research-12)
- HTTPS/TLS configuration for local dev
- pfctl port 80 forwarding (future enhancement)

## Open Questions

- Should we verify the route was actually applied by GET-ing it back after POST? (Adds latency but increases confidence)
- Should `proxy-setup` seed Caddy with all existing servers.json entries via the admin API on first run?

## Related

- Research: research-12-local-dev-proxy-reliability (synthesis + CC/GG findings)
- Upstream: feature-76-proxy-health-check (depends on this)
- Upstream: feature-77-proxy-crash-recovery (depends on this)
