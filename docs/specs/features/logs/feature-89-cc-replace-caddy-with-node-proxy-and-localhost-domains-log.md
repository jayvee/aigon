---
status: submitted
updated: 2026-03-18T00:25:50.470Z
startedAt: 2026-03-17T23:48:56.395Z
events:
  - { ts: "2026-03-17T23:48:56.395Z", status: implementing }
  - { ts: "2026-03-17T23:52:28.216Z", status: implementing }
  - { ts: "2026-03-18T00:00:00.000Z", status: implementing }
  - { ts: "2026-03-18T00:04:47.614Z", status: submitted }
  - { ts: "2026-03-18T00:25:50.470Z", status: submitted }
---

# Implementation Log: Feature 89 - replace-caddy-with-node-proxy-and-localhost-domains
Agent: cc

## Plan

Explored the codebase thoroughly before implementing:
- `lib/proxy.js` — contained all Caddy code (~600 lines with Caddy admin API integration)
- `lib/devserver.js` — re-exported from utils/proxy
- `aigon-cli.test.js` — imported `generateCaddyfile`, `getCaddyRouteId`, etc. from `lib/utils`
- Tests at lines ~698-900 tested Caddy functions

**Phase approach:**
1. Create `lib/aigon-proxy.js` — standalone proxy daemon using `http-proxy`
2. Rewrite `lib/proxy.js` — remove all Caddy functions, simplify to servers.json-based
3. Update tests — remove Caddy tests, add `.localhost` URL tests
4. Update `setup.js` doctor, `infra.js` proxy-setup/proxy commands
5. Update docs

## Progress

All acceptance criteria met:

- ✅ `lib/aigon-proxy.js` created (~80 lines): routes by Host header, WebSocket upgrades, PID file management
- ✅ All Caddy code removed: `generateCaddyfile`, `reloadCaddy`, `addCaddyRoute`, `removeCaddyRoute`, `isCaddyAdminAvailable`, `getCaddyLiveRoutes`, `getCaddyRouteId`
- ✅ All dnsmasq code removed from `proxyDiagnostics`
- ✅ `registerDevServer`/`deregisterDevServer` now just write/delete from servers.json (no Caddy API calls)
- ✅ `isProxyAvailable` checks `proxy.pid` file instead of Caddy admin API
- ✅ `proxyDiagnostics` simplified: returns `{ proxy.running, routes.total, fix }`
- ✅ `getDevProxyUrl` returns `.localhost` domains (`aigon.localhost`, `cc-85.aigon.localhost`)
- ✅ `reconcileProxyRoutes` simplified: cleans dead entries, always runs (no Caddy sync)
- ✅ `aigon proxy start/stop/install/status` commands added to infra.js
- ✅ `proxy-setup` simplified: just checks port 80 availability
- ✅ `aigon doctor` updated: shows new proxy shape (no Caddy/dnsmasq fields)
- ✅ `http-proxy` npm dependency added
- ✅ 159 tests pass (was 155+), 0 failures
- ✅ All `.test` domain references replaced with `.localhost`
- ✅ No active Caddy references remain in code
- ✅ README.md, GUIDE.md, docs/dashboard.md, CLAUDE.md, templates/help.txt updated

## Decisions

**`reconcileProxyRoutes` always runs now (no early return)**
Previously returned `{ added:0, removed:0, unchanged:0, cleaned:0 }` when Caddy was unavailable. Now always cleans dead entries from `servers.json`. Test updated accordingly — the dead-entry test now asserts `cleaned: 1` always (not conditionally).

**Kept `registryHasRoute` removed**
It was only used for Caddy route ID lookup in `reconcileProxyRoutes`. The new reconcile doesn't use route IDs at all, so the function was removed entirely. Tests updated to use `getDevProxyUrl` instead.

**Port 80 default for proxy daemon**
The `aigon-proxy.js` tries port 80 by default (set via `AIGON_PROXY_PORT` env). The `aigon proxy start` command checks if running as root — if so, uses port 80; otherwise falls back to **port 4080** (not 4100). Using 4100 as fallback caused a conflict with the dashboard, which also defaults to 4100. Port 4080 is a dedicated proxy port that avoids this collision. The launchd plist also uses 4080. During live testing, the proxy started successfully and `http://cc-89.aigon.localhost:4080` routed correctly to the running dashboard.

**`DEV_PROXY_PID_FILE` exported**
Added to exports so tests and other code can reference the PID file path directly.

**Test count change: 155 → 159**
Removed ~15 Caddy-specific tests, added ~19 new proxy tests (`.localhost` URLs, new proxyDiagnostics shape, new reconcile behavior). Net gain of 4 tests.
