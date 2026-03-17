# Feature: replace-caddy-with-node-proxy-and-localhost-domains

## Summary
Replace the unreliable Caddy + dnsmasq + /etc/resolver proxy stack with a Node.js built-in reverse proxy in the dashboard process, using `.localhost` domains (RFC 6761 — automatic OS-level resolution, zero DNS configuration). This eliminates 3 external dependencies, removes ~600 lines of proxy/reconciliation code, and gives stable named URLs like `http://aigon.localhost` and `http://cc-85.aigon.localhost` that survive sleep/wake without route loss.

## User Stories
- [ ] As a user, I want `aigon dashboard` to give me a named URL I can use in my browser without configuring Caddy or dnsmasq
- [ ] As a user, I want my dashboard URL to still work after my laptop wakes from sleep
- [ ] As a user, I want to see which project I'm looking at from the browser URL bar (not `localhost:4100`)
- [ ] As a developer, I want zero external proxy dependencies to install or maintain

## Acceptance Criteria
- [ ] Dashboard acts as HTTP reverse proxy on port 80 (or 4100 fallback if port 80 unavailable)
- [ ] Routes based on Host header: `aigon.localhost` → dashboard, `cc-85.aigon.localhost` → worktree dashboard
- [ ] Dev server traffic routed: `cc-119.myapp.localhost` → allocated dev server port
- [ ] `http-proxy` npm package added as dependency
- [ ] All Caddy code removed: `generateCaddyfile()`, `reloadCaddy()`, `addCaddyRoute()`, `removeCaddyRoute()`, `isCaddyAdminAvailable()`, `reconcileProxyRoutes()` (Caddy parts), `getCaddyLiveRoutes()`, `getCaddyRouteId()`
- [ ] All dnsmasq code removed: detection, installation, `/etc/resolver/test` setup
- [ ] `proxy-setup` command simplified: just checks port 80 availability (no Caddy/dnsmasq install)
- [ ] `registerDevServer()` registers with the in-process proxy instead of Caddy admin API
- [ ] `deregisterDevServer()` removes from in-process proxy
- [ ] `.test` domain references replaced with `.localhost` throughout codebase
- [ ] `proxyDiagnostics()` simplified: no Caddy/dnsmasq health checks
- [ ] `aigon doctor` updated: no Caddy/dnsmasq checks
- [ ] Dashboard startup prints working URL: `http://aigon.localhost` (or `http://127.0.0.1:4100` as fallback)
- [ ] `aigon dev-server start` prints `http://cc-119.myapp.localhost` URL
- [ ] `aigon dev-server list` shows `.localhost` URLs
- [ ] WebSocket proxying works (for tmux terminal relay)
- [ ] All existing 155+ tests pass
- [ ] Proxy tests added: Host header routing, WebSocket upgrade, unknown host returns 404
- [ ] README.md updated: remove Caddy/dnsmasq setup instructions, document new `.localhost` approach
- [ ] GUIDE.md updated: remove proxy-setup Caddy/dnsmasq sections
- [ ] `docs/dashboard.md` updated: new proxy architecture
- [ ] `CLAUDE.md` updated if proxy references exist

## Validation
```bash
node -c lib/utils.js
node -c lib/proxy.js
node --test aigon-cli.test.js
# Verify no Caddy references remain in active code
grep -ri "caddy\|caddyfile\|dnsmasq" lib/ templates/ --include="*.js" --include="*.html" --include="*.txt" | grep -v node_modules | grep -c . | xargs test 0 -eq
# Verify .test domain references replaced
grep -r "\.test[\"'/)]" lib/ templates/ --include="*.js" --include="*.html" | grep -v node_modules | grep -v "\.test\." | grep -c . | xargs test 0 -eq
```

## Technical Approach

### Architecture
```
Browser ──► http://aigon.localhost ──► Dashboard Node.js (port 80 or 4100)
                                          │ (http-proxy)
            http://cc-85.aigon.localhost ──┘──► localhost:4121 (worktree dashboard)
            http://cc-119.myapp.localhost ──┘──► localhost:3001 (dev server)
```

### Why .localhost works without DNS
RFC 6761 reserves `.localhost` — all modern OSes resolve `*.localhost` to `127.0.0.1` automatically. No dnsmasq, no `/etc/resolver`, no configuration.

### Implementation phases

**Phase 1: Add Node proxy to dashboard**
- Add `http-proxy` dependency
- In `runDashboardServer()`, intercept requests where Host doesn't match the dashboard's own hostname
- Route to the target port from `servers.json` registry
- Handle WebSocket upgrades for terminal relay

**Phase 2: Remove Caddy code**
- Delete all Caddy admin API functions
- Delete `generateCaddyfile()`, `reloadCaddy()`
- Simplify `reconcileProxyRoutes()` to only clean dead PIDs (no Caddy route sync)
- Remove `proxy-setup` Caddy/dnsmasq installation steps

**Phase 3: Switch to .localhost**
- Replace all `.test` domain strings with `.localhost`
- Update `getDevProxyUrl()` to return `.localhost` URLs
- Update display strings in dashboard, help, docs

**Phase 4: Port 80 binding**
- Dashboard tries port 80 first (direct browser access without port in URL)
- Falls back to 4100 if port 80 is unavailable (no sudo)
- User can run `sudo aigon dashboard` once to bind port 80, or use port 4100 with `http://aigon.localhost:4100`

### Fallback
If `.localhost` wildcard resolution doesn't work on a specific OS version, fall back to `127.0.0.1:PORT` with a clear message. The proxy still works — just with explicit ports instead of named domains.

## Dependencies
- `http-proxy` npm package (well-maintained, WebSocket support, 22M weekly downloads)
- None of the architectural refactoring features (85, 86, 87) — this is independent

## Out of Scope
- HTTPS / mkcert (can be added later as a separate feature)
- Removing the `servers.json` registry (still needed for port tracking)
- Changing how ports are allocated (keep the existing hash-based system)

## Open Questions
- Should the proxy listen on port 80 by default? Requires `sudo` on macOS. Alternative: always use `aigon.localhost:4100` (port in URL, but still named)
- Should `proxy-setup` be removed entirely or repurposed for port 80 binding setup?

## Related
- Feature 85: error-handling-and-state-validation (in progress — will add registry validation)
- Feature 86: extract-utils-into-domain-modules (in progress — proxy code moves to `lib/proxy.js`)
- Current proxy code: `lib/utils.js` lines 596-1220 (~600 lines of Caddy/dnsmasq)
