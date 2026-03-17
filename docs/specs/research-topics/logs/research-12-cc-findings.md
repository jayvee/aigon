---
status: submitted
updated: 2026-03-17T02:22:34.855Z
---

# Research Findings: local dev proxy reliability

**Agent:** Claude (cc)
**Research ID:** 12
**Date:** 2026-03-17

---

## Key Findings

### 1. Traefik is NOT a viable replacement for Caddy

Traefik's API is **read-only** — there is no POST/PUT endpoint to add routes dynamically. The v1.7 REST provider was deprecated and removed from docs. The best Traefik can offer is file-watching or HTTP polling (5s interval), which is the same model we already have with Caddy but worse.

**Caddy has a genuine advantage here:** its admin API (`POST /config/...`) supports real-time route addition/deletion with `@id` tags for direct addressing. This is unique among the proxy options evaluated.

| Criterion | Traefik | Caddy |
|-----------|---------|-------|
| REST API to add/remove routes | No (read-only) | Yes (`POST /config/...`) |
| Memory (~50 routes) | ~50-150 MB | ~20-50 MB |
| Built-in dashboard | Yes | No |
| DNS for *.test | Still needs dnsmasq | Same |

### 2. Caddy's admin API can eliminate the desync problem entirely

The current `reloadCaddy()` writes a Caddyfile then shells out to `caddy reload --config`. This fails silently when:
- The admin API socket isn't ready
- The admin address isn't explicitly configured (older versions fail silently)
- Caddy considers the config "unchanged"

**Two fix paths:**

**Option A — Fix the Caddyfile approach (minimal change):**
1. Add `admin localhost:2019` to generated Caddyfile global options
2. Replace `caddy reload --config` with `curl -X POST http://localhost:2019/load -H "Content-Type: text/caddyfile" --data-binary @Caddyfile`
3. Check HTTP status (200 = success, 400 = error)
4. Read back via `GET /config/` to verify routes exist

**Option B — Eliminate files entirely (recommended):**
1. Use JSON config via admin API with `@id` tags per route
2. `registerDevServer()` → `POST /config/apps/http/servers/proxy/routes` with `@id: "cc-73-aigon"`
3. `deregisterDevServer()` → `DELETE /id/cc-73-aigon`
4. No Caddyfile, no file writes, no reload step
5. Keep `servers.json` as aigon-side registry for crash recovery; reconcile with `GET /config/` on startup

Option B eliminates the entire class of "wrote file but reload didn't apply" bugs.

### 3. DNS: dnsmasq works fine — the problems are all in the proxy layer

Every tool surveyed (Valet, Herd, Orbstack, DDEV, puma-dev) uses dnsmasq or equivalent + `/etc/resolver/`. There is no magic alternative:

| DNS approach | Wildcard? | Sudo needed? | Offline? | CLI tools work? |
|-------------|-----------|-------------|----------|----------------|
| dnsmasq + /etc/resolver/test | Yes | One-time for resolver file | Yes | Yes |
| CoreDNS on port 5353 | Yes | One-time for resolver file | Yes | Yes |
| PAC file (browser proxy) | Yes | Maybe not | Yes | **No** (curl/node ignore PAC) |
| /etc/hosts (hostctl) | **No wildcards** | Every modification | Yes | Yes |
| Public wildcard DNS (DDEV trick) | Yes | No | **No** | Yes |
| Embedded Node.js DNS (dns2) | Yes | One-time for resolver file | Yes | Yes |

**Key insight:** `/etc/resolver/test` always requires sudo, but it supports a `port` directive — so the DNS server itself can run unprivileged on port 5353. dnsmasq can run as a user LaunchAgent on port 5353 with `brew services start dnsmasq` (no sudo).

**The DDEV public DNS trick** (`*.ddev.site` → 127.0.0.1 via real internet DNS) is clever but fails offline. Not suitable for reliability-critical tooling.

### 4. Prior art: what comparable tools use

| Tool | DNS | Proxy | Sudo | Setup steps | Key lesson |
|------|-----|-------|------|-------------|------------|
| **Valet** | dnsmasq | Nginx | Yes (install) | ~4 | `valet install` is the "fix everything" command — self-healing |
| **Herd** | dnsmasq (bundled) | Nginx (bundled) | macOS auth dialog | 1 | Privileged helper via SMJobBless — no terminal sudo |
| **Orbstack** | /etc/resolver + custom DNS | Built-in | System Extension | 1 | Uses macOS resolver mechanism same as everyone else |
| **DDEV** | Public wildcard DNS | Traefik (Docker) | No (online) | ~3 | Minimal-privilege `ddev-hostname` binary for /etc/hosts |
| **puma-dev** | /etc/resolver | Go proxy | Yes (setup) | ~3 | Single binary = fewer failure modes |

**Pattern:** The most reliable tools (Herd, Orbstack) bundle everything and use macOS-native privilege escalation (auth dialogs, not terminal sudo). CLI tools (Valet, DDEV) accept one-time sudo for initial setup.

### 5. A Node.js embedded proxy could replace Caddy entirely

A pure `node:http` reverse proxy is ~60 lines, zero dependencies, and perfectly handles 40-50 concurrent upstreams:

```
aigon proxy start → Node.js on port 7999, routes by Host header from servers.json
pfctl → port 80 → 7999 (one-time sudo, persists via LaunchDaemon)
dnsmasq → *.test → 127.0.0.1 (existing, works)
```

**Advantages over Caddy:**
- No external binary dependency (aigon already runs Node.js)
- Route changes via `fs.watch` on `servers.json` — no API call or reload step
- The entire `generateCaddyfile()`/`reloadCaddy()` layer gets deleted
- One fewer brew dependency to install and manage

**Disadvantages:**
- No HTTPS (Caddy provides this for free) — not a blocker for local `.test` domains
- We own the code — bugs are ours to fix
- No built-in admin dashboard (but aigon dashboard already serves this purpose)

**pfctl for port 80:** `echo "rdr pass inet proto tcp from any to any port 80 -> 127.0.0.1 port 7999" | sudo pfctl -ef -` — one-time setup, persists via LaunchDaemon.

### 6. The minimum viable approach (port-only fallback)

If named URLs prove not worth the complexity, deterministic port assignment + dashboard listing works with zero setup:
- Port = `3000 + hash(repo+worktree+agent) % 1000`
- Dashboard shows clickable `localhost:PORT` links with labels
- Zero DNS, zero proxy, zero sudo

This is genuinely viable for <10 services but breaks down at 40-50. It should remain the **graceful fallback** when the proxy isn't configured.

---

## Sources

### Traefik
- [Traefik API & Dashboard docs](https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/)
- [Traefik HTTP Provider docs](https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/)
- [Community: REST API in Traefik v3.1](https://community.traefik.io/t/rest-api-in-traefik-v3-1/25053)
- [Traefik Homebrew formula](https://formulae.brew.sh/formula/traefik)

### Caddy Admin API
- [Caddy Admin API docs](https://caddyserver.com/docs/api)
- [Caddy API Tutorial](https://caddyserver.com/docs/api-tutorial)
- [caddy reload succeeds but config not applied (#5735)](https://github.com/caddyserver/caddy/issues/5735)
- [Admin socket disappears after reload (#5568)](https://github.com/caddyserver/caddy/issues/5568)
- [Socket permissions cause reload failure (#5694)](https://github.com/caddyserver/caddy/issues/5694)
- [macOS firewall prompts (#115382)](https://github.com/Homebrew/homebrew-core/issues/115382)

### DNS & Resolvers
- [macOS resolver(5) man page](https://www.manpagez.com/man/5/resolver/)
- [Per-domain resolvers in macOS](https://invisiblethreat.ca/technology/2025/04/12/macos-resolvers/)
- [CoreDNS on macOS](https://brendanthompson.com/posts/2021/12/coredns-on-macos-for-local-development)
- [hostctl (managed /etc/hosts)](https://github.com/guumaster/hostctl)
- [getlantern/proxysetup (PAC without sudo)](https://github.com/getlantern/proxysetup)

### Prior Art
- [Laravel Valet docs](https://laravel.com/docs/12.x/valet)
- [Laravel Herd](https://herd.laravel.com/)
- [OrbStack container domains](https://docs.orbstack.dev/docker/domains)
- [DDEV hostnames and wildcards](https://ddev.com/blog/ddev-name-resolution-wildcards/)
- [DDEV hostname security improvements](https://ddev.com/blog/ddev-hostname-security-improvements/)
- [Lando proxy docs](https://docs.lando.dev/landofile/proxy.html)
- [Magic behind DDEV & Lando routing](https://dev.to/mitrakumar/magic-behind-ddev-lando-routing-37m)

### Node.js Proxy & Port Forwarding
- [http-proxy on npm](https://www.npmjs.com/package/http-proxy)
- [Redbird dynamic proxy](https://github.com/OptimalBits/redbird)
- [macOS pfctl port forwarding](https://salferrarello.com/mac-pfctl-port-forwarding/)
- [Redirect port 80 on macOS (gist)](https://gist.github.com/novemberborn/aea3ea5bac3652a1df6b)
- [Binding privileged ports without root on macOS](https://zameermanji.com/blog/2024/1/5/binding-to-privileged-ports-without-root-on-macos/)
- [Wildcard DNS on macOS with dnsmasq](https://til.simonwillison.net/macos/wildcard-dns-dnsmasq)

---

## Recommendation

### Primary: Fix Caddy with API-driven route management (Option B)

**Switch from Caddyfile generation to Caddy's JSON admin API with `@id` tags.** This is the highest-value, lowest-risk change:

1. **Why:** Eliminates the entire Caddyfile desync failure class. Routes are added/removed individually via HTTP, with immediate confirmation (HTTP 200) and rollback on failure. No file writes, no reload step, no race conditions.

2. **How:**
   - `registerDevServer()` → `POST /config/apps/http/servers/proxy/routes` with `@id: "<server-id>"`
   - `deregisterDevServer()` → `DELETE /id/<server-id>`
   - `isProxyAvailable()` → `GET http://localhost:2019/config/` returns 200
   - On startup, reconcile `servers.json` with Caddy's live config via `GET /config/`
   - Delete `generateCaddyfile()` and the Caddyfile file entirely

3. **Migration cost:** Moderate — rewrite `reloadCaddy()` and related functions in `lib/utils.js`. No user-facing setup changes. Caddy + dnsmasq remain as dependencies.

### Secondary: Simplify first-run setup with `aigon proxy-setup`

Reduce the current 6-step manual setup to a single interactive command:
1. Check if dnsmasq is installed (`which dnsmasq`), offer to `brew install` if missing
2. Write dnsmasq config (`address=/.test/127.0.0.1`, `port=5353`)
3. Write `/etc/resolver/test` (one-time sudo prompt with clear explanation)
4. Start dnsmasq as user LaunchAgent on port 5353
5. Start Caddy (or verify already running)
6. Verify end-to-end: resolve `test-probe.test` → 127.0.0.1 → Caddy responds

### Future: Consider replacing Caddy with embedded Node.js proxy

If Caddy continues to cause friction (brew update breaks, macOS firewall prompts, etc.), replace it with a ~60-line Node.js proxy built into aigon-cli.js:
- Reads `servers.json` + `fs.watch` for changes
- Routes by `Host:` header to `localhost:PORT`
- pfctl redirects port 80 → unprivileged port
- Eliminates Caddy as a dependency entirely

This is lower priority because fixing Caddy's API usage (primary recommendation) should resolve the reliability issues. But it's a clean fallback if Caddy proves fundamentally unreliable on macOS.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| proxy-caddy-api-routes | Switch from Caddyfile generation to Caddy JSON admin API with @id tags for per-route add/delete | high | none |
| proxy-setup-wizard | Single `aigon proxy-setup` command that handles dnsmasq install, resolver config, and Caddy setup with one sudo prompt | high | proxy-caddy-api-routes |
| proxy-health-check | Replace `pgrep caddy` with admin API health check (`GET localhost:2019/config/`); add `proxyDiagnostics()` with actionable fix suggestions | high | proxy-caddy-api-routes |
| proxy-crash-recovery | On startup, reconcile servers.json registry with Caddy's live config; re-register missing routes, remove stale ones | medium | proxy-caddy-api-routes |
| proxy-node-embedded | Replace Caddy with a zero-dependency Node.js HTTP proxy built into aigon-cli.js, using fs.watch on servers.json | medium | none |
| proxy-pfctl-setup | Use macOS pfctl to redirect port 80 → unprivileged port via LaunchDaemon, eliminating sudo for the proxy process itself | medium | proxy-node-embedded |
| proxy-port-fallback | Improve the localhost:PORT fallback UX with deterministic port assignment and clickable dashboard links when proxy is unavailable | low | none |
| proxy-local-https | Add optional HTTPS for *.test domains via Caddy's `tls internal` + `caddy trust` one-time setup | low | proxy-caddy-api-routes |
