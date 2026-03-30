# Feature: dev-servers

## Summary

Extend the existing dev-proxy infrastructure (feature 12) to run fully isolated Aigon stacks (AIGON server + dashboard) per worktree, each on dynamically allocated ports and routed through `.test` domains. Each worktree gets its own AIGON server and dashboard (e.g. `cc-119.aigon.test`), while the main/operator stack lives at fixed, predictable ports and domain (`aigon.test`). This enables parallel development of Radar and dashboard code across worktrees without port conflicts or shared-state bugs.

## User Stories

- [ ] As an operator, I want the main Aigon Radar dashboard to always be available at `aigon.test` (or a fixed port like `localhost:4200`), so I have a stable bookmark for the operator console
- [ ] As an operator running Fleet mode, I want each worktree's Radar dashboard to get its own `.test` subdomain (e.g. `cc-119.aigon.test`), so I can open multiple dashboards in separate browser tabs without port confusion
- [ ] As an operator, I want `aigon radar start` to automatically register with the dev proxy when available, so I don't have to manually configure anything
- [ ] As a developer without the proxy set up, I want the existing port-based behaviour to keep working as a fallback
- [ ] As a developer working on Radar itself in a worktree, I want the worktree's AIGON server to run on its own port, so my changes don't interfere with the main Radar or other worktrees
- [ ] As a developer working on both Radar and the dashboard in a worktree, I want the dashboard to automatically connect to its worktree's AIGON server, not the main one

## Acceptance Criteria

### Main stack gets fixed ports and a fixed domain
- [ ] When Radar starts from the main worktree (or outside any worktree), the AIGON server binds to port `4100` and the dashboard to port `4200`
- [ ] Registers the dashboard as `aigon.test` with the dev proxy
- [ ] `aigon radar open` opens `http://aigon.test` when the proxy is available, falls back to `http://localhost:4200`

### Worktree instances run an isolated stack
- [ ] When Radar starts from inside a worktree, it detects the agent ID and feature ID from the worktree context
- [ ] Both the AIGON server and the dashboard get dynamically allocated ports (not the fixed main ports)
- [ ] The dashboard is automatically configured to connect to its paired AIGON server, not the main one
- [ ] Registers the dashboard with the proxy as `{agent}-{featureId}.aigon.test` (e.g. `cc-119.aigon.test`)
- [ ] Multiple worktree stacks (AIGON server + dashboard) can run simultaneously alongside the main stack

### Integration with existing dev-proxy
- [ ] Uses the same Caddy + dnsmasq infrastructure from feature 12 (`aigon proxy-setup`)
- [ ] Radar registrations appear in `~/.aigon/dev-proxy/servers.json` under an `aigon` app ID
- [ ] Each worktree entry tracks both the AIGON server port and the dashboard port as a pair
- [ ] Generated Caddyfile includes Radar entries alongside project dev server entries
- [ ] `aigon dev-server list` shows Radar instances alongside app dev servers
- [ ] `aigon dev-server gc` cleans up stale AIGON server entries and related process records

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

| Context | Dashboard URL | Dashboard Port | AIGON Server Port |
|---|---|---|---|
| Main (no worktree) | `aigon.test` | 4200 (fixed) | 4100 (fixed) |
| Worktree (cc, feature 119) | `cc-119.aigon.test` | dynamic | dynamic |
| Worktree (gg, feature 119) | `gg-119.aigon.test` | dynamic | dynamic |
| Fallback (no proxy) | `localhost:4200` | 4200 | 4100 |

### Changes to Radar startup (`startRadarService`)

1. Detect context: is this a worktree? If so, extract agent ID and feature ID
2. Start the AIGON server:
   - Main: bind to fixed port `4100`
   - Worktree: allocate dynamic port for the AIGON server via `allocatePort()`
3. Start the dashboard, passing the AIGON server URL:
   - Main: bind to fixed port `4200`, connect to Radar at `localhost:4100`
   - Worktree: allocate dynamic port for the dashboard, connect to Radar at `localhost:{service_port}`
4. If proxy available:
   - Main: register dashboard as `aigon.test` → `localhost:4200`
   - Worktree: register dashboard as `{agent}-{featureId}.aigon.test` → `localhost:{dashboard_port}`
   - Regenerate Caddyfile, reload Caddy
5. If no proxy: use `localhost:{port}` URLs as today

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
    "main": {
      "service": { "port": 4100, "pid": 73520 },
      "dashboard": { "port": 4200, "pid": 73524 },
      "started": "..."
    },
    "cc-119": {
      "service": { "port": 4301, "pid": 73800 },
      "dashboard": { "port": 4847, "pid": 73801 },
      "worktree": "/path/to/worktree",
      "started": "..."
    }
  },
  "farline": {
    "cc-119": { "port": 3847, "worktree": "/path/to/worktree", "pid": 73525, "started": "..." }
  }
}
```

### Port allocation strategy

- Main AIGON server: fixed port `4100` (configurable via `~/.aigon/config.json` `radar.servicePort`)
- Main dashboard: fixed port `4200` (configurable via `~/.aigon/config.json` `radar.dashboardPort`)
- Worktree instances: both service and dashboard ports dynamically allocated starting from `4201+` using the same `allocatePort()` from feature 12
- The `4xxx` range keeps Radar ports separate from project dev server ports (`3xxx` range)

### Dashboard-to-service wiring

The dashboard needs to know which AIGON server to connect to. On startup, the dashboard receives the AIGON server URL as a configuration parameter (e.g. environment variable or CLI flag). This ensures each worktree's dashboard talks only to its own AIGON server instance.

### Isolation strategy: always fork by default

Worktree instances always run their own AIGON server, even when the worktree has no changes to Radar code. This is the pragmatic default because:

- It's simpler to implement — every worktree follows the same startup path
- It avoids subtle version-mismatch bugs where a dashboard change assumes a Radar API that only exists in the worktree's code
- It eliminates a class of hard-to-debug issues where two worktrees inadvertently share state through a single Radar process

The cost is modest — each extra AIGON server is a lightweight Node process on a dynamic port. For the common case where only the dashboard is changing, the forked AIGON server will be identical to the main one, but the overhead is negligible compared to the debugging cost of shared-state surprises.

A future optimisation could allow `--shared-radar` to skip forking and point the worktree dashboard at the main AIGON server (`localhost:4100`), but this is not planned for the initial implementation.

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
