# Feature: proxy-crash-recovery

## Summary

On dashboard startup, reconcile `servers.json` with Caddy's live config — clean up stale entries from dead processes, remove orphan Caddy routes, and re-add routes for any processes that are still alive but missing from Caddy. The primary use case is after a Mac reboot: running `aigon dashboard` (or `aigon dashboard start`) cleans up stale state before serving. Also adds `aigon dashboard start` as an alias for the bare `aigon dashboard` command for discoverability.

**Key insight:** After a reboot, the dashboard and dev servers are all dead — there's nothing to "restore". The real value is **cleaning up stale entries** from `servers.json` so the dashboard starts clean, and re-adding routes for any processes that happen to still be alive (e.g., after a Caddy-only restart mid-session).

## User Stories

- [ ] As a developer, after rebooting my Mac, running `aigon dashboard start` cleans up stale state and starts fresh
- [ ] As a developer, if Caddy crashes and restarts mid-session, my still-running dev servers become reachable again automatically
- [ ] As a developer, orphan routes from deleted worktrees are cleaned up automatically
- [ ] As a developer, I can type `aigon dashboard start` instead of bare `aigon dashboard` — it's more discoverable

## Acceptance Criteria

- [ ] New `reconcileProxyRoutes()` function in lib/utils.js that:
  - Reads `servers.json` for expected routes
  - GETs Caddy's live routes via admin API (graceful no-op if admin API is unreachable)
  - For each servers.json entry: checks if PID is alive
  - Dead entries: removed from servers.json AND from Caddy (if route exists)
  - Alive entries missing from Caddy: re-added via `addCaddyRoute()`
  - Orphan Caddy routes (aigon-* prefix, not in servers.json): removed
  - Returns a summary: `{ added: N, removed: N, cleaned: N, unchanged: N }`
- [ ] Reconciliation runs on `aigon dashboard` / `aigon dashboard start` startup, before the HTTP server starts
- [ ] Reconciliation is idempotent — running it twice produces the same state
- [ ] Console output shows what was reconciled (only when something changed): `"Proxy reconciled: 3 stale entries cleaned, 1 orphan route removed"`
- [ ] `aigon dashboard start` works as an alias for bare `aigon dashboard`
- [ ] `node -c lib/utils.js` exits 0; all tests pass

## Validation

```bash
node -c lib/utils.js && node -c aigon-cli.js && npm test
```

## Technical Approach

### New Function: `reconcileProxyRoutes()`

```javascript
function reconcileProxyRoutes() {
  const registry = loadProxyRegistry();
  const caddyAvailable = isCaddyAdminAvailable();
  const liveRoutes = caddyAvailable ? getCaddyLiveRoutes() : new Map();
  const results = { added: 0, removed: 0, cleaned: 0, unchanged: 0 };

  // 1. Check each servers.json entry
  for (const [appId, servers] of Object.entries(registry)) {
    for (const [serverId, info] of Object.entries(servers)) {
      const routeId = getCaddyRouteId(appId, serverId);
      const isLive = liveRoutes.has(routeId);
      const pid = info.dashboard ? info.dashboard.pid : info.pid;
      const isProcessAlive = pid > 0 && isRunning(pid);

      if (!isProcessAlive) {
        // Dead process — clean from registry, remove from Caddy
        delete servers[serverId];
        if (isLive && caddyAvailable) removeCaddyRoute(routeId);
        results.cleaned++;
      } else if (!isLive && caddyAvailable) {
        // Process alive but route missing — re-add
        const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
        const port = info.dashboard ? info.dashboard.port : info.port;
        addCaddyRoute(hostname, port, routeId);
        results.added++;
      } else {
        results.unchanged++;
      }
    }
    if (Object.keys(servers).length === 0) delete registry[appId];
  }

  // 2. Remove orphan Caddy routes (aigon-* prefix but not in registry)
  if (caddyAvailable) {
    for (const routeId of liveRoutes.keys()) {
      if (routeId.startsWith('aigon-') && !registryHasRoute(registry, routeId)) {
        removeCaddyRoute(routeId);
        results.removed++;
      }
    }
  }

  saveProxyRegistry(registry);
  return results;
}
```

### Helper: `isRunning(pid)`

```javascript
function isRunning(pid) {
  try {
    process.kill(pid, 0);  // Signal 0 = existence check, doesn't kill
    return true;
  } catch (e) {
    return false;  // ESRCH = no such process
  }
}
```

### Helper: `getCaddyLiveRoutes()`

```javascript
function getCaddyLiveRoutes() {
  // GET localhost:2019/config/apps/http/servers/srv0/routes
  // Returns Map<routeId, routeConfig>
  // Filters to only routes with @id starting with "aigon-"
  // Synchronous (uses execSync + curl) to match existing patterns
}
```

### `aigon dashboard start` alias

In the dashboard command handler, treat `start` subcommand the same as no subcommand — both start the foreground server. Update the help text to show `start` as an option.

### Integration Points

- Called at the top of `dashboard` / `dashboard start` before the HTTP server starts
- Optionally called during `aigon doctor` for diagnostics

## Dependencies

- Feature 75: proxy-caddy-api-routes (`addCaddyRoute()`, `removeCaddyRoute()`, `getCaddyRouteId()`, `isCaddyAdminAvailable()`) — DONE

## Out of Scope

- Auto-restarting dead dev servers (reconciliation only cleans up the proxy layer)
- Daemonising the dashboard (LaunchAgent etc.) — user starts it manually in a terminal
- Watching for Caddy crashes in real-time (reconciliation is on-demand at dashboard startup)
- Handling dnsmasq state (dnsmasq is stateless for wildcard domains)
- Feature 76 (proxy-health-check) — not required for this feature, can be done independently later

## Open Questions

- Should `aigon doctor` also run reconciliation, or just report stale entries without fixing them?

## Related

- Research: research-12-local-dev-proxy-reliability
- Depends on: feature-75-proxy-caddy-api-routes (done)
- Independent of: feature-76-proxy-health-check (nice-to-have, not a dependency)
