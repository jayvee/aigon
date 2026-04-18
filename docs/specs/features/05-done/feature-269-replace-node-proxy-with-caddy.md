# Feature: replace-node-proxy-with-caddy

## Summary
Replace the custom Node.js proxy daemon (`lib/aigon-proxy.js`) with Caddy for `.localhost` domain routing. The current proxy has a JSON registry with PID-based liveness checks, reconciliation logic, and registration/deregistration lifecycle that creates failure modes where routes disappear when the dashboard crashes or restarts ungracefully. Caddy uses a static config file — routes survive process crashes, no PID tracking, no reconciliation. Validated manually: Caddy returns 502 (not 404) when a backend is down and auto-recovers when it comes back.

## User Stories
- [ ] As a user, when my dashboard crashes or restarts, the `aigon.localhost` route keeps working (502 while down, auto-recovers)
- [ ] As a user, `aigon dev-server start` gives me a `.localhost` URL that works via Caddy
- [ ] As a user upgrading aigon, the migration from the old proxy to Caddy is handled automatically
- [ ] As a new user, `aigon proxy install` installs Caddy and sets up routing

## Acceptance Criteria
- [ ] `lib/aigon-proxy.js` is deleted — no custom proxy daemon
- [ ] `aigon proxy install` checks for Caddy (`which caddy`), prompts `brew install caddy` (macOS) or links to install docs (Linux) if missing
- [ ] `aigon server start` writes a dashboard route to the Caddyfile and calls `caddy reload`
- [ ] `aigon dev-server start` appends a dev server route to the Caddyfile and calls `caddy reload`
- [ ] `aigon dev-server stop` removes the dev server route from the Caddyfile and calls `caddy reload`
- [ ] When the dashboard is down, Caddy returns 502 (not 404)
- [ ] When the dashboard restarts, the route works immediately without re-registration
- [ ] `servers.json` registry is no longer used — delete the file and all registration/deregistration/reconciliation code
- [ ] `aigon proxy start/stop/status` manages Caddy lifecycle (not the old Node.js daemon)
- [ ] WebSocket upgrade works through Caddy (required for dashboard terminal relay)
- [ ] The proxy is optional — without Caddy installed, everything works on raw `localhost:PORT`
- [ ] Migration: `aigon update` detects old Node.js proxy, stops it, removes its launchd plist, cleans up `servers.json` and `proxy.pid`

## Validation
```bash
node --check aigon-cli.js
npm test
# Manual: stop dashboard, verify aigon.localhost returns 502, restart, verify it recovers
```

## Technical Approach

### Caddyfile management
- Single Caddyfile at `~/.aigon/dev-proxy/Caddyfile` (same location, replaces old artifact)
- Written by aigon — one `reverse_proxy` block per route
- `aigon server start` and `aigon dev-server start/stop` rewrite the Caddyfile and call `caddy reload`
- Port assignments still come from `~/.aigon/ports.json` (unchanged)

### Caddyfile format
```
{
    auto_https off
    http_port 4080
}

# Dashboard
http://aigon.localhost:4080 {
    reverse_proxy localhost:4100
}

# Dev server: cc-119.brewboard
http://cc-119.brewboard.localhost:4080 {
    reverse_proxy localhost:3021
}
```

### Port 80 vs 4080
- Without sudo/root: Caddy listens on 4080, URLs are `http://aigon.localhost:4080`
- With `aigon proxy install` (sudo): launchd runs Caddy on port 80, URLs are `http://aigon.localhost`
- Same Caddyfile either way — only `http_port` changes

### Code deletion
- Delete `lib/aigon-proxy.js` (~109 lines)
- Delete from `lib/proxy.js`: `registerDevServer()`, `deregisterDevServer()`, `reconcileProxyRoutes()`, `gcDevServers()`, `loadProxyRegistry()`, `saveProxyRegistry()`, `isProcessAlive()`, `isPortInUseSync()` (~250 lines)
- Delete from `lib/server-runtime.js`: `reconcileProxyRoutesSafely()` call and related logic
- Delete from `lib/dashboard-server.js`: `registerDevServer()`/`deregisterDevServer()` calls in startup and shutdown handlers
- Delete from `lib/commands/infra.js`: old proxy start/stop/install (replace with Caddy equivalents)
- Remove `http-proxy` from `package.json` dependencies

### New code
- `writeCaddyfile()` — reads current routes from ports.json + dashboard config, writes Caddyfile
- `reloadCaddy()` — calls `caddy reload --config <path>`
- `addRoute(hostname, port)` / `removeRoute(hostname)` — modify Caddyfile and reload
- Updated `aigon proxy install/start/stop/status/uninstall` — manages Caddy instead of Node daemon

### Migration path (aigon update)
1. Detect old proxy: check for `~/.aigon/dev-proxy/proxy.pid` or old launchd plist `/Library/LaunchDaemons/com.aigon.proxy.plist`
2. Stop old proxy: kill PID, unload launchd plist
3. Clean up: delete `servers.json`, `proxy.pid`, `proxy.log`, old launchd plist
4. Keep: `~/.aigon/dev-proxy/logs/` (dev server logs are still useful), `~/.aigon/ports.json` (port allocations)
5. Generate new Caddyfile from ports.json + known dashboard port
6. If Caddy is installed: start it. If not: print "run `brew install caddy` for .localhost URLs"

## Dependencies
- Caddy (`brew install caddy`) — optional runtime dependency

## Out of Scope
- Changing port allocation logic (ports.json stays as-is)
- Changing dev server spawn/health-check logic
- HTTPS / TLS (auto_https stays off — local dev only)
- Docker/container proxy routing

## Open Questions
- Should `aigon proxy install` run `brew install caddy` automatically, or just check and prompt?
- Should the Caddyfile include health checks or just rely on Caddy's default 502 behavior?

## Related
- Feature 89 (replace-caddy-with-node-proxy) — this reverses that decision, having learned that the custom proxy's lifecycle complexity outweighs Caddy's install friction
- Incident: dashboard route disappeared on 2026-04-18 due to reconciliation deleting a stale registry entry
