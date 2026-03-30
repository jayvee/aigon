# Feature: replace-caddy-with-node-proxy-and-localhost-domains

## Summary
Replace the unreliable Caddy + dnsmasq + /etc/resolver proxy stack with a Node.js built-in reverse proxy in the AIGON server process, using `.localhost` domains (RFC 6761 — automatic OS-level resolution, zero DNS configuration). This eliminates 3 external dependencies, removes ~600 lines of proxy/reconciliation code, and gives stable named URLs like `http://aigon.localhost` and `http://cc-85.aigon.localhost` that survive sleep/wake without route loss.

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

### Architecture — Separate proxy daemon from dashboard

**Critical design decision:** The proxy MUST be separate from the dashboard. The dashboard is a feature-rich app that polls, renders, sends notifications — it can crash or restart. The proxy must be a tiny, stable daemon that never dies.

```
                     ┌──────────────────────────────┐
                     │  aigon-proxy (daemon, ~50 LOC)│
Browser ─────────────┤  port 80 (or 4100 fallback)  │
  aigon.localhost    │  reads servers.json           │
  cc-85.aigon.localhost  routes by Host header       │
  cc-119.myapp.localhost                             │
                     └──────┬───────────────────────┘
                            │ proxies to
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
         localhost:4100  localhost:4121  localhost:3001
         (dashboard)    (worktree dash) (dev server)
```

### The proxy daemon (`lib/aigon-proxy.js`, ~50 lines)
- Reads `~/.aigon/dev-proxy/servers.json` on each request (or watches file for changes)
- Maps Host header → port: `aigon.localhost` → 4100, `cc-85.aigon.localhost` → 4121
- Handles WebSocket upgrades
- Zero polling, zero status collection, zero features
- Runs via launchd (macOS) — starts on boot, survives sleep/wake
- If it crashes (unlikely — 50 lines of code), launchd restarts it

### The dashboard
- Registers itself in `servers.json` on startup (as it does today)
- Can restart, crash, or be stopped without breaking proxy routing
- Other dev servers also just register in `servers.json`

### Why .localhost works without DNS
RFC 6761 reserves `.localhost` — all modern OSes resolve `*.localhost` to `127.0.0.1` automatically. No dnsmasq, no `/etc/resolver`, no configuration.

### Implementation phases

**Phase 1: Create `lib/aigon-proxy.js`**
- ~50 line Node script using `http-proxy`
- Reads `servers.json`, routes by Host header
- Handles WebSocket upgrades
- `aigon proxy start` starts as daemon, `aigon proxy stop` stops it
- `aigon proxy install` creates launchd plist for auto-start on boot

**Phase 2: Remove Caddy code**
- Delete all Caddy admin API functions
- Delete `generateCaddyfile()`, `reloadCaddy()`
- Remove `proxy-setup` Caddy/dnsmasq installation steps
- `registerDevServer()` just writes to `servers.json` (proxy reads it live)

**Phase 3: Switch to .localhost**
- Replace all `.test` domain strings with `.localhost`
- Update `getDevProxyUrl()` to return `.localhost` URLs
- Update display strings in dashboard, help, docs

**Phase 4: Port 80 binding**
- Proxy tries port 80 first (clean URLs without port number)
- Falls back to 4100 if port 80 unavailable (no sudo)
- `aigon proxy install` can optionally configure launchd to bind port 80

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
