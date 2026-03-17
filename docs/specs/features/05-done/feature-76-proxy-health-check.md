# Feature: proxy-health-check

## Summary

Replace the brittle `pgrep -x caddy` process check with a proper health check against Caddy's admin API (`GET localhost:2019/config/`). Add a `proxyDiagnostics()` function that returns structured, actionable diagnostics instead of the current binary yes/no check. When something is wrong, tell the user exactly what and how to fix it.

## User Stories

- [ ] As a developer, when I run `aigon dashboard` or `aigon doctor`, I see specific proxy health status (not just "Caddy is running / not running")
- [ ] As a developer, when the proxy is misconfigured, I get an actionable fix command — not a generic error
- [ ] As a developer, I can distinguish between "Caddy process exists but admin API is unresponsive" and "Caddy is not running at all"

## Acceptance Criteria

- [ ] `isProxyAvailable()` (lib/utils.js:667) uses `GET localhost:2019/config/` instead of `pgrep -x caddy`
- [ ] `proxyUnavailableReason()` (lib/utils.js:682) is replaced by `proxyDiagnostics()` returning a structured object
- [ ] `proxyDiagnostics()` returns: `{ healthy: boolean, caddy: { installed, running, adminApi }, dnsmasq: { installed, running }, routes: { total, stale }, fix: string | null }`
- [ ] Stale route detection: compare servers.json entries against Caddy's live routes (via admin API GET)
- [ ] Each diagnostic field includes a specific fix command when unhealthy (e.g., `"brew services start caddy"`, `"aigon proxy-setup"`)
- [ ] `aigon doctor` output includes proxy diagnostics section with pass/fail indicators
- [ ] All callers of `isProxyAvailable()` and `proxyUnavailableReason()` updated to use new API
- [ ] `node -c lib/utils.js` exits 0; all tests pass

## Validation

```bash
node -c lib/utils.js && node -c aigon-cli.js && npm test
```

## Technical Approach

### New Function: `proxyDiagnostics()`

```javascript
async function proxyDiagnostics() {
  return {
    healthy: true/false,  // all checks passed
    caddy: {
      installed: true/false,    // caddy version succeeds
      running: true/false,      // admin API responds
      adminApi: true/false,     // GET localhost:2019/config/ returns 200
    },
    dnsmasq: {
      installed: true/false,    // brew list dnsmasq
      running: true/false,      // brew services list | grep dnsmasq
    },
    routes: {
      total: N,                 // routes in servers.json
      live: N,                  // routes in Caddy's config
      stale: N,                 // in servers.json but not in Caddy
    },
    fix: "suggested command" | null
  };
}
```

### Updated `isProxyAvailable()`

```javascript
function isProxyAvailable() {
  // Quick synchronous check: can we reach admin API?
  try {
    execSync('curl -sf http://localhost:2019/config/ > /dev/null 2>&1', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}
```

### Diagnostic Priority (fix field)

1. Caddy not installed -> `"brew install caddy"`
2. Caddy not running -> `"sudo brew services start caddy"`
3. Admin API unreachable -> `"caddy start --config ~/.aigon/dev-proxy/Caddyfile"`
4. dnsmasq not running -> `"sudo brew services start dnsmasq"`
5. Stale routes found -> `"aigon proxy-reconcile"` (from feature-77)

### Integration Points

- `aigon doctor` — shows full diagnostics table
- `aigon dashboard` — uses `isProxyAvailable()` for status indicator
- `resolveDevServerUrl()` (lib/utils.js:4783) — uses `isProxyAvailable()` for URL resolution

## Dependencies

- Feature 75: proxy-caddy-api-routes (admin API functions must exist for health checks to use them)

## Out of Scope

- Auto-starting Caddy or dnsmasq (just diagnose and suggest commands)
- Fixing stale routes automatically (that's feature-77: proxy-crash-recovery)
- Network-level diagnostics (DNS resolution testing, etc.)

## Open Questions

- Should `proxyDiagnostics()` be async (using `http.get`) or sync (using `curl` via `execSync`)? Async is cleaner but requires updating callers.
- Should we add a `--json` flag to `aigon doctor` for machine-readable output?

## Related

- Research: research-12-local-dev-proxy-reliability
- Depends on: feature-75-proxy-caddy-api-routes
- Upstream: feature-77-proxy-crash-recovery (uses diagnostics to detect stale routes)
