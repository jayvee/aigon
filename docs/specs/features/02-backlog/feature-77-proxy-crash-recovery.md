# Feature: proxy-crash-recovery

## Summary

On startup (any `aigon` command that touches the proxy), reconcile `servers.json` with Caddy's live config. If routes exist in servers.json but not in Caddy (e.g., after a crash or reboot), re-add them. If routes exist in Caddy but not in servers.json (orphans), remove them. This ensures the proxy always reflects the actual state of running dev servers.

## User Stories

- [ ] As a developer, after rebooting my Mac, running any aigon command automatically restores my proxy routes without manual intervention
- [ ] As a developer, if Caddy crashes and restarts, my existing dev servers become reachable again automatically
- [ ] As a developer, orphan routes from deleted worktrees are cleaned up automatically

## Acceptance Criteria

- [ ] New `reconcileProxyRoutes()` function in lib/utils.js that:
  - Reads `servers.json` for expected routes
  - GETs Caddy's live routes via admin API
  - Adds missing routes (in servers.json but not in Caddy)
  - Removes orphan routes (in Caddy with `aigon-` prefix but not in servers.json)
  - Returns a summary: `{ added: N, removed: N, unchanged: N }`
- [ ] `reconcileProxyRoutes()` validates each servers.json entry's process is still alive (check PID) before re-adding
- [ ] Dead entries (PID not running) are cleaned from servers.json and NOT re-added to Caddy
- [ ] Reconciliation runs automatically on:
  - `aigon dashboard` startup
  - `aigon proxy-setup`
  - `aigon doctor`
- [ ] Reconciliation is idempotent — running it twice produces the same state
- [ ] Console output shows what was reconciled: `"Proxy reconciled: 2 routes added, 1 orphan removed, 5 unchanged"`
- [ ] `node -c lib/utils.js` exits 0; all tests pass

## Validation

```bash
node -c lib/utils.js && node -c aigon-cli.js && npm test
```

## Technical Approach

### New Function: `reconcileProxyRoutes()`

```javascript
async function reconcileProxyRoutes() {
  const registry = loadProxyRegistry();
  const liveRoutes = await getCaddyLiveRoutes();  // GET localhost:2019/config/apps/http/servers/srv0/routes
  const results = { added: 0, removed: 0, unchanged: 0, cleaned: 0 };

  // 1. Check each servers.json entry
  for (const [appId, servers] of Object.entries(registry)) {
    for (const [serverId, info] of Object.entries(servers)) {
      const routeId = getCaddyRouteId(appId, serverId);
      const isLive = liveRoutes.has(routeId);
      const isProcessAlive = info.pid > 0 && isRunning(info.pid);

      if (!isProcessAlive) {
        // Dead process — clean from registry, remove from Caddy
        delete servers[serverId];
        if (isLive) await removeCaddyRoute(routeId);
        results.cleaned++;
      } else if (!isLive) {
        // Process alive but route missing — re-add
        const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
        const port = info.dashboard ? info.dashboard.port : info.port;
        await addCaddyRoute(hostname, port, routeId);
        results.added++;
      } else {
        results.unchanged++;
      }
    }
    // Clean empty app entries
    if (Object.keys(servers).length === 0) delete registry[appId];
  }

  // 2. Remove orphan Caddy routes (aigon-* prefix but not in registry)
  for (const routeId of liveRoutes.keys()) {
    if (routeId.startsWith('aigon-') && !registryHasRoute(registry, routeId)) {
      await removeCaddyRoute(routeId);
      results.removed++;
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
async function getCaddyLiveRoutes() {
  // GET localhost:2019/config/apps/http/servers/srv0/routes
  // Returns Map<routeId, routeConfig>
  // Filters to only routes with @id starting with "aigon-"
}
```

### Integration Points

- Called at the top of `dashboard` command startup (before rendering status)
- Called during `proxy-setup` (after ensuring Caddy is running)
- Called during `doctor` (as part of proxy diagnostics)
- Optionally exposed as `aigon proxy-reconcile` standalone command

## Dependencies

- Feature 75: proxy-caddy-api-routes (`addCaddyRoute()`, `removeCaddyRoute()`, `getCaddyRouteId()`)
- Feature 76: proxy-health-check (`proxyDiagnostics()` for stale route detection)

## Out of Scope

- Auto-restarting dead dev servers (reconciliation only fixes the proxy layer, not the servers themselves)
- Watching for Caddy crashes in real-time (reconciliation is on-demand, not a daemon)
- Handling dnsmasq state (dnsmasq is stateless for wildcard domains — no reconciliation needed)

## Open Questions

- Should reconciliation run on every `aigon` command or only on proxy-related commands? (Every command adds latency; proxy-only is safer)
- Should we log reconciliation events to a file for debugging? (e.g., `~/.aigon/dev-proxy/reconcile.log`)
- Timeout for admin API calls during reconciliation? (Suggest 2s to avoid blocking CLI startup)

## Related

- Research: research-12-local-dev-proxy-reliability
- Depends on: feature-75-proxy-caddy-api-routes
- Depends on: feature-76-proxy-health-check
