# Research: Local Dev Proxy Reliability — Rethink Caddy + dnsmasq

## Context

Aigon uses named local domains (e.g. `aigon.test`, `cx-66.aigon.test`) to give each running service
a stable, human-readable URL. This matters because at scale a single user may have:

- 4–5 repos being actively developed
- 2–3 features per repo in parallel
- Up to 3 agent worktrees per feature
- Each worktree running its own dev server

That's potentially **40–50 concurrent web services**. Port numbers become unmanageable at that scale.
Named URLs like `cx-66.aigon.test` make it immediately obvious which repo, which feature branch,
and which agent you're looking at.

The current stack — **dnsmasq** for wildcard DNS + **Caddy** as reverse proxy — has proven flaky
in practice. Setup is non-trivial (requires `brew`, `sudo`, LaunchAgents, Caddyfile management),
and runtime failures are silent with poor diagnostics.

This research should determine whether to fix, replace, or redesign this layer.

---

## Observed Failure Modes (First-Hand, This Repo)

These are failures witnessed directly while building and running Aigon's proxy stack:

### 1. Caddyfile desync
The registry (`~/.aigon/dev-proxy/servers.json`) correctly records all running servers, but the
Caddyfile becomes empty or stale. Caddy runs but serves nothing on `*.test`. Symptoms: "Connection
refused on port 80." Root cause: `reloadCaddy()` writes the Caddyfile and calls
`caddy reload --config <path>` — if the reload silently fails (e.g. Caddy's admin API socket isn't
ready), the write succeeds but the new config isn't loaded.

### 2. `useProxy` false positive (fixed, but indicative)
The condition for whether to register with the proxy was checking `profile.devServer.enabled`,
which is always `false` for the `library` profile. So library-profile repos never registered,
silently fell back to localhost, and showed no explanation. Users saw localhost URLs with no
indication why the named URL didn't appear.

### 3. Dashboard self-detection loop
When `dev-server start` pre-registers the process PID before spawning, the AIGON server process
would see its own PID in the registry, call `isProcessAlive(own-pid) === true`, and conclude
a server was already running — then exit immediately. Fixed by adding `existing.pid !== process.pid`
guard, but the fundamental issue is our registration lifecycle logic is fragile.

### 4. No actionable diagnostics
`isProxyAvailable()` returned a boolean — no explanation of why it failed. Users saw localhost
URLs with no guidance. Fixed by adding `proxyUnavailableReason()`, but this is a symptom of the
stack not being self-healing or self-explaining.

### 5. sudo required at setup
`sudo brew services start caddy` is required because Caddy binds port 80. This introduces
permission complexity and breaks in corporate/managed Mac environments.

### 6. `caddy reload` vs `brew services restart` fallback
`reloadCaddy()` tries the Caddy admin API first, falls back to `sudo brew services restart caddy`.
The fallback adds ~3s delay and may prompt for password interactively in some shells. The admin
API reload (`caddy reload --config`) also requires Caddy to already be running at the right address.

---

## Current Architecture

```
Browser → dnsmasq (resolves *.test → 127.0.0.1)
        → Caddy (port 80, routes by hostname → localhost:PORT)
        → aigon dev server or dashboard (port 4100–4199, 3001–3050, etc.)

Registry: ~/.aigon/dev-proxy/servers.json  (source of truth)
Caddyfile: ~/.aigon/dev-proxy/Caddyfile    (generated from registry, reloaded on change)
```

Key code paths:
- `registerDevServer()` → writes registry → calls `reloadCaddy()`
- `reloadCaddy()` → `generateCaddyfile(registry)` → writes file → `caddy reload --config`
- `isProxyAvailable()` → checks caddy binary + Caddyfile exists + `pgrep -x caddy`
- `resolveDevServerUrl()` → returns named URL or localhost fallback

Setup required by user:
1. `brew install caddy dnsmasq`
2. Configure dnsmasq: `address=/.test/127.0.0.1` in `/opt/homebrew/etc/dnsmasq.conf`
3. `sudo mkdir /etc/resolver && echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/test`
4. `sudo brew services start dnsmasq`
5. `aigon proxy-setup` (writes initial Caddyfile, starts Caddy)
6. `sudo brew services start caddy`

That's 6 steps with 2 `sudo` operations before Aigon works with named URLs.

---

## Questions to Answer

- [ ] Is there an alternative proxy that supports dynamic route registration via API (no file
      reload step) that's simpler to install and run?
- [ ] Can dnsmasq be replaced with something that doesn't require sudo or system DNS resolver config?
- [ ] What do comparable tools (Lando, Ddev, Herd, Valet, Orbstack) use for local domain routing,
      and what can we learn from their approach?
- [ ] Is there a way to keep named URLs but make setup a single `aigon setup` command with no sudo?
- [ ] If we must keep Caddy, what changes would make `reloadCaddy()` reliable? (retry, verify,
      poll admin socket, etc.)
- [ ] What is the minimum viable approach: can we support 40–50 services reliably with just ports
      and a simple dashboard listing, and what UX would that require?
- [ ] Does Traefik's API-based config solve the desync problem? What's its brew install / setup
      story on macOS?
- [ ] Can we use macOS's built-in `pfctl` / `/etc/hosts` + a lightweight HTTP router to avoid
      third-party daemons entirely?

---

## Scope

### In Scope
- Local macOS dev environment only (Aigon's primary platform)
- Named URL reliability for 40–50 concurrent services
- First-run setup complexity (install docs, `aigon proxy-setup` flow)
- Runtime reliability (desync, silent failures, diagnostics)
- Port conflict avoidance across multiple repos and worktrees

### Out of Scope
- Cloud / remote dev environments (Codespaces, Gitpod)
- HTTPS for local domains (nice to have but not blocking)
- Windows / Linux support (future consideration)

---

## Candidate Approaches to Evaluate

### A. Traefik (API-driven proxy)
- Dynamic route registration via REST API — no file write + reload step
- `POST /api/http/routers/{name}` registers a route immediately
- brew install + single background process
- Built-in dashboard at `localhost:8080`
- Still needs dnsmasq for `*.test` DNS wildcard (or `/etc/hosts`)
- Concern: is the API stable? Does it require auth? Memory footprint?

### B. Fix Caddy management layer
- Keep Caddy but make `reloadCaddy()` robust: verify admin API socket is ready before reload,
  poll for confirmation, retry with backoff, verify new config was actually loaded
- Keep dnsmasq as-is (it works reliably once configured)
- Lowest migration cost — no architectural change
- Still leaves the sudo/setup complexity for new installs

### C. Herd / Valet / Orbstack-style (macOS-native)
- Laravel Herd and Valet use Nginx + dnsmasq but with polished installers and a native macOS app
- Orbstack provides `*.orb.local` domains with zero config for Docker containers
- We can't depend on these tools being installed, but we could learn from their approach
- Could we wrap setup in a native macOS helper app that handles the sudo steps once?

### D. ngrok / localhost.run / Cloudflare Tunnel per service
- Each dev server gets a public tunnel URL
- Not suitable for local-only, adds latency and external dependency

### E. Aigon-managed `/etc/hosts` + lightweight Node proxy
- Write `aigon.test 127.0.0.1` entries to `/etc/hosts` for known services (requires sudo once)
- Run a single Node.js HTTP proxy process (no brew dependency) that reads the registry and
  routes by `Host:` header — same logic as Caddy but we own it
- Port 80 still requires sudo, but could run on a non-privileged port (e.g. 7999) with
  dnsmasq pointing `*.test:80` → `127.0.0.1:7999`... but that's not standard
- Or: bind port 80 with a LaunchDaemon (one-time sudo setup via installer)

### F. Port-based with rich naming (fallback/pragmatic)
- Assign deterministic ports: `3000 + hash(repo+worktree+agent) % 1000`
- Dashboard shows a table of what's running with labels, no DNS needed
- `aigon board --urls` prints a readable list
- URLs like `localhost:3142` are ugly but work everywhere, zero setup
- This is the right answer if scale ends up being <10 services in practice, but user's
  scenario (40–50) makes this genuinely hard to navigate

---

## Prior Art to Review

| Tool     | DNS approach          | Proxy              | sudo? | Notes |
|----------|-----------------------|--------------------|-------|-------|
| Valet    | dnsmasq               | Nginx via socket   | yes   | macOS only, Laravel ecosystem |
| Herd     | dnsmasq               | Nginx (managed)    | yes   | Native macOS app wraps sudo |
| Ddev     | dnsmasq               | Traefik in Docker  | no*   | Docker handles port binding |
| Orbstack | orb.local (built-in)  | Built-in           | no    | Requires Orbstack subscription |
| Lando    | dnsmasq               | Traefik in Docker  | no*   | Docker approach again |

*Docker approach sidesteps the port 80 / sudo issue because Docker Desktop handles network binding.

**Key insight from the table**: tools that avoid sudo do it either through a native app installer
(Herd) or by routing through Docker (Ddev, Lando, which we don't want). The Docker approach isn't
right for Aigon (not all projects are containerized), but the native app insight is worth exploring.

---

## Findings

### Consensus (CC + GG)
- **Traefik is not viable** — its API is read-only (no dynamic route creation). Worse than Caddy for this use case.
- **The Caddyfile desync is the core reliability bug** — the "write file + reload" pattern causes silent failures when the admin API socket isn't ready or the reload doesn't apply.
- **A Node.js embedded proxy is technically viable** — both agents confirmed a ~60-line `node:http` proxy could replace Caddy, reading `servers.json` directly.
- **macOS `pfctl` can handle port 80 binding** — redirecting port 80 → unprivileged port avoids running the proxy as root.
- **dnsmasq works reliably once configured** — no zero-sudo DNS wildcard alternative exists; `/etc/resolver/` always needs sudo once. All prior art (Valet, Herd, DDEV, Orbstack) uses the same approach.

### Divergent Views
- **CC recommended** fixing Caddy by switching to its JSON admin API with `@id` tags — lower risk, keeps proven tool, eliminates the desync class.
- **GG recommended** replacing both Caddy and dnsmasq entirely — switch to `.localhost` TLD (browser-native resolution) + built-in Node.js proxy on port 8080. Bolder but bigger rewrite, and `.localhost:8080` URLs are uglier.

### Decision
Keep Caddy + dnsmasq. Two brew dependencies are normal for a tool of this complexity (Valet requires 3, DDEV requires Docker). The real problem was never the dependencies — it was silent failures after setup. Fix the integration layer, not the architecture.

---

## Recommendation

**Harden Caddy integration with API-driven route management and self-healing diagnostics.**

1. **Switch to Caddy's JSON admin API** — replace Caddyfile generation with per-route `POST /config/...` with `@id` tags. Routes are added/removed individually via HTTP with immediate confirmation. Eliminates the entire "wrote file but reload didn't apply" failure class.

2. **Replace `pgrep caddy` health checks** with admin API calls (`GET localhost:2019/config/`). Add `proxyDiagnostics()` that returns actionable fix suggestions instead of a boolean.

3. **Self-heal on startup** — reconcile `servers.json` with Caddy's live config. Re-register missing routes, remove stale ones. Users should never need to manually fix desync.

---

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| proxy-caddy-api-routes | Switch from Caddyfile generation to Caddy JSON admin API with @id tags for per-route add/delete | high | `aigon feature-create "proxy-caddy-api-routes"` |
| proxy-health-check | Replace `pgrep caddy` with admin API health check; add `proxyDiagnostics()` with actionable fix suggestions | high | `aigon feature-create "proxy-health-check"` |
| proxy-crash-recovery | On startup, reconcile servers.json with Caddy's live config; re-register missing routes, remove stale ones | medium | `aigon feature-create "proxy-crash-recovery"` |

### Feature Dependencies
- proxy-health-check depends on proxy-caddy-api-routes (needs admin API to be the primary interface)
- proxy-crash-recovery depends on proxy-caddy-api-routes (reconciliation uses GET /config/ endpoint)

### Not Selected
- `switch-to-localhost` (GG): `.localhost:8080` URLs are uglier; `.test` with dnsmasq is well-understood and all prior art uses it
- `proxy-node-embedded` (CC+GG): Not needed if Caddy API fixes the reliability issues; revisit if Caddy proves fundamentally unreliable on macOS
- `proxy-setup-wizard`: Good idea but not the priority — the current setup works, failures happen at runtime not setup time
- `proxy-pfctl-setup`: Only needed for the Node.js proxy path, which was not selected
- `proxy-port-fallback`: Already works as-is; low priority
- `proxy-local-https`: Nice-to-have, not blocking anything
- `puma-dev-spike` (GG): External Ruby dependency, not worth investigating
