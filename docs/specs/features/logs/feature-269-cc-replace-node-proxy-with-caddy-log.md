# Implementation Log: Feature 269 - replace-node-proxy-with-caddy
Agent: cc

## Plan
Replace the custom Node.js proxy daemon (aigon-proxy.js + servers.json registry) with Caddy for .localhost domain routing. Key insight: routes written to a Caddyfile survive crashes. No PID tracking, no reconciliation.

## Progress
- Rewrote `lib/proxy.js`: deleted registry functions (loadProxyRegistry, saveProxyRegistry, registerDevServer, deregisterDevServer, reconcileProxyRoutes, gcDevServers, validateRegistry). Added Caddy management: isCaddyInstalled, parseCaddyRoutes, writeCaddyfile, addCaddyRoute, removeCaddyRoute, reloadCaddy, getCaddyPort, buildCaddyHostname, gcCaddyRoutes.
- Deleted `lib/aigon-proxy.js` (109 lines — standalone Node.js proxy daemon)
- Removed `http-proxy` from `package.json` dependencies
- Updated `lib/server-runtime.js`: replaced reconcileProxyRoutesSafely with ensureDashboardCaddyRoute
- Updated `lib/dashboard-server.js`: replaced registerDevServer/deregisterDevServer with addCaddyRoute. Dashboard route is now persistent (not removed on shutdown) — Caddy returns 502 while down and auto-recovers.
- Rewrote `lib/commands/infra.js`: proxy start/stop/install/uninstall/status now manage Caddy. dev-server start/stop/list use Caddyfile routes. Server commands pass Caddy deps instead of reconcileProxyRoutes.
- Updated `lib/dashboard-status-collector.js`: replaced loadProxyRegistry with parseCaddyRoutes + port-based liveness check
- Updated `lib/commands/feature.js`: feature-close server restart uses port check instead of registry. Preview dashboard cleanup uses Caddy routes.
- Updated `lib/commands/setup.js`: doctor shows Caddy status. Update restart uses port-based server detection.
- Updated `lib/devserver.js`, `lib/commands/misc.js`, `lib/feature-close.js`: replaced gcDevServers with gcCaddyRoutes

## Decisions
- **Dashboard route is permanent**: Unlike the old proxy where routes were deregistered on shutdown, Caddy routes persist. This means `aigon.localhost` returns 502 while the dashboard is down (not 404), and auto-recovers on restart. This is the core design goal.
- **Port-based liveness instead of PID tracking**: With no servers.json, we use `isPortInUseSync(port)` to check if backends are alive. This is simpler and more reliable than PID tracking.
- **Caddyfile is the single source of truth**: No separate route registry. Routes are parsed from the Caddyfile for status/list commands.
- **getCaddyPort()**: Reads `http_port` from the Caddyfile (defaults to 4080). Port 80 mode uses launchd with Caddy `run` command.
- **getDevProxyUrl() now includes port**: When Caddy runs on 4080, URLs include `:4080`. On port 80, URLs are clean.
- **isProxyAvailable() checks Caddy admin API**: Uses `curl -sf http://localhost:2019/` to check if Caddy is running (port 2019 is Caddy's default admin endpoint).

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-18

### Findings
- `gcCaddyRoutes()` and `aigon dev-server gc` were deleting persistent dashboard routes when the backend was down, breaking the required 502-and-recover behavior.
- `aigon dev-server stop` depended on a Caddy route existing, so localhost-only dev servers could keep running while the command reported success.
- The dashboard dev-server start API checked the wrong Caddy hostname after launch, so successful starts could return a missing URL.
- Preview cleanup matched feature hostnames too broadly and could remove non-dashboard routes for the same feature prefix.

### Fixes Applied
- `ed8fc1b31` — `fix(review): preserve caddy routing behavior`

### Notes
- Restarted the AIGON server after backend edits per repo instructions.
