# Feature: dashboard-use-dev-server

## Summary

The Aigon dashboard currently manages its own instance discovery system (`~/.aigon/instances/`) with raw `localhost:PORT` URLs. The `aigon dev-server` system already solves this problem more elegantly: it assigns ports per worktree, registers them with the Caddy proxy, and exposes stable named URLs (`aigon.test`, `cc-71.aigon.test`). This feature replaces the dashboard's custom instance system with the existing dev-server infrastructure, giving the dashboard named URLs, eliminating duplicated port-discovery logic, and making `aigon dashboard list` consistent with `aigon dev-server list`.

When Caddy is available, the dashboard becomes accessible at:
- Main repo: `http://aigon.test`
- Worktree `feature-71-cc-...`: `http://cc-71.aigon.test`

When Caddy is not set up, behaviour falls back to raw `localhost:PORT` as today.

## User Stories

- [ ] As a developer, running `aigon dashboard` in the main repo serves the dashboard at `http://aigon.test` (when Caddy is configured).
- [ ] As a developer working in a worktree, running `aigon dashboard` serves at `http://cc-71.aigon.test` — a stable URL that doesn't change between restarts.
- [ ] As a developer, `aigon dashboard list` shows the same named URLs as `aigon dev-server list`, so I don't need two separate commands to see what's running.
- [ ] As a developer without Caddy configured, everything works exactly as before with `localhost:PORT` URLs — no setup required.

## Acceptance Criteria

- [ ] `aigon dashboard` (no subcommand) calls `registerDevServer` on start and `deregisterDevServer` on shutdown (idle timeout or Ctrl+C/SIGTERM)
- [ ] When Caddy is available, startup message shows the `.test` URL; when not, shows `localhost:PORT` as fallback
- [ ] `aigon dashboard list` reads from the proxy registry (`loadProxyRegistry`) filtered to the current `appId`, instead of `~/.aigon/instances/`
- [ ] `aigon dashboard open` opens the proxy URL when Caddy is available, otherwise the raw port URL
- [ ] The `serverId` for worktree instances follows the existing dev-server convention: `{agent}-{featureId}` (e.g. `cc-71`) derived from the branch name
- [ ] The `serverId` for the main repo is omitted (null) → URL is `http://aigon.test`
- [ ] `~/.aigon/instances/` directory and associated functions (`writeDashboardInstance`, `removeDashboardInstance`, `listDashboardInstances`) are removed
- [ ] `gcDevServers` correctly handles dashboard entries (plain `pid` field, same as regular dev-server entries — no special-casing needed)
- [ ] All existing `dashboard` subcommands (`list`, `open`, `add`, `remove`, `status`) continue to work

## Validation

```bash
node -c aigon-cli.js
node -c lib/utils.js
node -c lib/commands/shared.js
npm test
```

## Technical Approach

**`runDashboardServer` in `lib/utils.js`:**
- On `server.listen`: call `registerDevServer(appId, serverId, port, process.cwd(), process.pid)`
- On shutdown (idle timeout + `process.on('SIGINT'/'SIGTERM')`): call `deregisterDevServer(appId, serverId)`
- `appId` = `getAppId()` (derives from package.json name or directory name — already exists)
- `serverId` = from new `serverId` field on `detectDashboardContext()` return value (see below)

**`detectDashboardContext` in `lib/utils.js`:**
- Add `serverId` to the returned object alongside existing `isWorktree`, `instanceName`, `worktreePath`
- Derive `serverId` by parsing the branch name: match `feature-(\d+)-([a-z]+)-` → `{agent}-{id}` (e.g. `cc-71`)
- Main repo branch (`main`/`master`) → `serverId = null`

**`dashboard list` in `lib/commands/shared.js`:**
- Replace `listDashboardInstances()` with `loadProxyRegistry()` filtered to `appId`
- Show proxy URL when Caddy available, raw `localhost:PORT` as fallback

**`dashboard open` in `lib/commands/shared.js`:**
- Use `getDevProxyUrl(appId, serverId)` when `isProxyAvailable()`, otherwise `localhost:PORT`

**URL display on startup:**
```
🚀 Dashboard: http://cc-71.aigon.test  (also: http://localhost:4159)
```
Show both when Caddy is available; only localhost when not.

**Port assignment:** keep existing `hashBranchToPort` — this still works alongside Caddy (Caddy proxies the named URL to whatever port the server is on).

**Removal:**
- Delete `writeDashboardInstance`, `removeDashboardInstance`, `listDashboardInstances` from `lib/utils.js` and exports
- Remove `~/.aigon/instances/` directory handling
- Keep `DASHBOARD_DEFAULT_PORT`, `DASHBOARD_DYNAMIC_PORT_START`, `DASHBOARD_DYNAMIC_PORT_END`

## Dependencies

- Requires Caddy + dnsmasq for named URLs (`aigon proxy-setup`) — gracefully degrades without it
- `registerDevServer`, `deregisterDevServer`, `getDevProxyUrl`, `getAppId`, `isProxyAvailable` all exist in `lib/utils.js`
- Feature 70 (dashboard-infrastructure-rebuild) — merged ✅

## Out of Scope

- Making `aigon dashboard` a background/daemon process (stays foreground)
- Auto-running `proxy-setup` if Caddy is missing
- Merging `dashboard list` and `dev-server list` into a single unified command

## Open Questions

- Should `dashboard add` / `dashboard remove` (conductor repo registry) be renamed to `dashboard track` / `dashboard untrack` to avoid confusion with dev-server registration?

## Related

- Feature #70: dashboard-infrastructure-rebuild (prerequisite, merged)
- `registerDevServer` / `deregisterDevServer` in `lib/utils.js` ~893
- `getDevProxyUrl` in `lib/utils.js` ~1026
- `detectDashboardContext` in `lib/utils.js`
- `runDashboardServer` in `lib/utils.js`
