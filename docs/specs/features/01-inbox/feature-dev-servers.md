# Feature: dev-servers

## Summary

Extend the existing dev-proxy infrastructure (feature 12) to also route the Aigon Radar dashboard through `.test` domains, so that each worktree's dashboard instance gets a unique URL (e.g. `cc-119.aigon.test`) while the main/operator dashboard lives at a fixed, predictable domain (`aigon.test`). This makes it easy to open multiple dashboards side-by-side when running Fleet mode, and avoids port-number confusion between worktree dashboards and project dev servers.

## User Stories

- [ ] As an operator, I want the main Aigon Radar dashboard to always be available at `aigon.test` (or a fixed port like `localhost:4200`), so I have a stable bookmark for the operator console
- [ ] As an operator running Fleet mode, I want each worktree's Radar dashboard to get its own `.test` subdomain (e.g. `cc-119.aigon.test`), so I can open multiple dashboards in separate browser tabs without port confusion
- [ ] As an operator, I want `aigon radar start` to automatically register with the dev proxy when available, so I don't have to manually configure anything
- [ ] As a developer without the proxy set up, I want the existing port-based behaviour to keep working as a fallback

## Acceptance Criteria

### Main dashboard gets a fixed domain
- [ ] When Radar starts from the main worktree (or outside any worktree), it registers as `aigon.test` with the dev proxy
- [ ] The main dashboard always uses a fixed, well-known port (e.g. `4200`) regardless of proxy availability
- [ ] `aigon radar open` opens `http://aigon.test` when the proxy is available, falls back to `http://localhost:4200`

### Worktree dashboards get unique subdomains
- [ ] When Radar starts from inside a worktree, it detects the agent ID and feature ID from the worktree context
- [ ] Registers with the proxy as `{agent}-{featureId}.aigon.test` (e.g. `cc-119.aigon.test`)
- [ ] Port is dynamically allocated (not the fixed main port) to avoid conflicts
- [ ] Multiple worktree dashboards can run simultaneously alongside the main dashboard

### Integration with existing dev-proxy
- [ ] Uses the same Caddy + dnsmasq infrastructure from feature 12 (`aigon proxy-setup`)
- [ ] Radar registrations appear in `~/.aigon/dev-proxy/servers.json` under an `aigon` app ID
- [ ] Generated Caddyfile includes Radar entries alongside project dev server entries
- [ ] `aigon dev-server list` shows Radar instances alongside app dev servers
- [ ] `aigon dev-server gc` cleans up stale Radar entries too

### Fallback without proxy
- [ ] If Caddy/dnsmasq are not installed, Radar uses `localhost:<port>` as today
- [ ] Warning printed suggesting `aigon proxy-setup` for subdomain routing

## Validation

```bash
node --check lib/utils.js
npm test
```

## Technical Approach

### URL scheme

| Context | URL | Port |
|---|---|---|
| Main dashboard (no worktree) | `aigon.test` | 4200 (fixed) |
| Worktree dashboard (cc, feature 119) | `cc-119.aigon.test` | dynamic |
| Worktree dashboard (gg, feature 119) | `gg-119.aigon.test` | dynamic |
| Fallback (no proxy) | `localhost:4200` | 4200 |

### Changes to Radar startup (`startRadarService`)

1. Detect context: is this a worktree? If so, extract agent ID and feature ID
2. If proxy available:
   - Main: register as `aigon.test` → `localhost:4200`
   - Worktree: allocate dynamic port, register as `{agent}-{featureId}.aigon.test` → `localhost:{port}`
   - Regenerate Caddyfile, reload Caddy
3. If no proxy: bind to `localhost:4200` (or next available) as today

### Caddyfile additions

```caddyfile
# Aigon Radar (main)
aigon.test {
    reverse_proxy localhost:4200
}

# Aigon Radar (worktree instances)
cc-119.aigon.test {
    reverse_proxy localhost:4847
}

gg-119.aigon.test {
    reverse_proxy localhost:4901
}
```

### Registry entry

Radar instances register under a reserved `aigon` app ID in `servers.json`:

```json
{
  "aigon": {
    "main": { "port": 4200, "pid": 73524, "started": "..." },
    "cc-119": { "port": 4847, "worktree": "/path/to/worktree", "pid": 73801, "started": "..." }
  },
  "farline": {
    "cc-119": { "port": 3847, "worktree": "/path/to/worktree", "pid": 73525, "started": "..." }
  }
}
```

### Port allocation strategy

- Main dashboard: fixed port `4200` (configurable via `~/.aigon/config.json` `radar.port`)
- Worktree dashboards: dynamically allocated starting from `4201+` using the same `allocatePort()` from feature 12
- The `4xxx` range keeps Radar ports separate from project dev server ports (`3xxx` range)

## Dependencies

- Feature 12: Local Dev Proxy with Subdomain Routing (provides Caddy + dnsmasq infrastructure, `registerDevServer()`, `generateCaddyfile()`)
- Feature 57: Control Surface Dashboard (the Radar dashboard being routed)

## Out of Scope

- Aggregating multiple worktree dashboards into the main dashboard view (that's a dashboard feature, not a routing feature)
- HTTPS for dashboard domains
- Remote/cloud dashboard access
- Per-project dashboard domains (e.g. `farline.aigon.test`) — the dashboard is an aigon-level tool, not per-project

## Open Questions

- Should `aigon radar start` from a worktree also start the main dashboard if it's not already running?
- Should the main dashboard at `aigon.test` show links to all active worktree dashboards?
- Should the fixed main port be `4200` or should we pick something less likely to conflict (e.g. `14200`)?

## Related

- Feature 12: [Local Dev Proxy](../../05-done/feature-12-dev-proxy.md) — the proxy infrastructure this builds on
- Feature 57: [Control Surface Dashboard](../../03-in-progress/feature-57-control-surface-dashboard-operator-console.md) — the dashboard being routed
- Research 01: [Subdomains for Multi-Agent Mode](../../research-topics/04-done/research-01-subdomains-for-multi-agent-mode.md)
- Paused: [Subdomain Configuration for Bakeoff Mode](../../05-paused/feature-subdomain-configuration-for-bakeoff-mode.md) — earlier, narrower attempt
