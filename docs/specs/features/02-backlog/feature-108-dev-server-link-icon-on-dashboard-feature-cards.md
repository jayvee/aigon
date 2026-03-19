# Feature: Dev server link icon on dashboard feature cards

## Summary
When a feature is in-progress and an agent has a running dev server, show a clickable web icon on that agent's row in the Monitor view card. Clicking it opens the dev server URL in a new browser tab. This lets the user quickly eyeball an implementation before accepting. Only shown for projects with a `web` or `api` profile (where `devServer.enabled` is true).

## User Stories
- [ ] As a user reviewing in-progress features, I want to click a web icon on an agent's card row to open that agent's dev server, so I can visually inspect the implementation without hunting for URLs
- [ ] As a user, I want the icon to only appear when a dev server is actually running, so I'm not clicking dead links
- [ ] As a user looking at an agent with no dev server running, I want a "Start Dev Server" option in the overflow menu so I can spin one up without switching to a terminal

## Acceptance Criteria
- [ ] A globe/web icon appears on the agent row in Monitor view when the dev server is registered and its process is alive
- [ ] Clicking the icon opens the dev server URL (`http://{serverId}.{appId}.localhost` or `http://localhost:{port}`) in a new browser tab
- [ ] Icon is NOT shown when: (a) no dev server is registered for that agent+feature, (b) the registered PID is dead, or (c) the project profile has `devServer.enabled === false`
- [ ] The dev server status refreshes on each poll cycle (every 10s via WebSocket refresh)
- [ ] Icon uses a consistent style matching existing card action buttons (subtle, hover highlight)
- [ ] When the project profile has `devServer.enabled` and the agent has a worktree but NO running dev server, a "Start Dev Server" item appears in the agent's overflow (three-dot) menu
- [ ] Clicking "Start Dev Server" calls `POST /api/action` with `dev-server start` targeting that agent's worktree
- [ ] After the dev server starts, the next poll cycle picks it up and the globe icon replaces the menu item

## Validation
```bash
node --check lib/dashboard-server.js
node --check lib/proxy.js
```

## Technical Approach

### Backend (`lib/dashboard-server.js` — `collectDashboardStatusData()`)
1. Read the project profile via `getActiveProfile()` to check `devServer.enabled`
2. If enabled, read the dev proxy registry (`~/.aigon/dev-proxy/servers.json`) for the current appId
3. For each agent on an in-progress feature, look up `{agentId}-{featureId}` in the registry
4. Verify the PID is alive (`process.kill(pid, 0)`)
5. Add `devServerUrl` field to the agent object (null if not running)
6. Add `devServerEligible` boolean — true when `devServer.enabled` and the agent has a worktree path (so the frontend knows to offer "Start Dev Server" even when one isn't running)

### Frontend (`templates/dashboard/js/monitor.js` — `buildAgentStatusHtml()`)
1. If `agent.devServerUrl` is set, render a small globe icon (`<a href="..." target="_blank">`) next to the agent status
2. If `agent.devServerUrl` is null but `agent.devServerEligible` is true (web/api profile + worktree exists), add a "Start Dev Server" item to the agent row's overflow menu
3. The start action calls `requestAction('dev-server', ['start', '--worktree', agent.worktreePath], repoPath)`
4. Style: globe icon uses inline SVG, same size as existing status dots, with hover opacity. Overflow item uses standard menu styling.

### Data flow
- Registry file already exists at `~/.aigon/dev-proxy/servers.json` — just need to read it
- `getDevProxyUrl()` in `lib/proxy.js` already computes the URL — reuse it
- `getAppId()` in `lib/proxy.js` already derives the app identifier

## Dependencies
- Existing dev proxy registry (`lib/proxy.js` — `readDevProxyRegistry()`, `getDevProxyUrl()`)
- Existing profile system (`lib/config.js` — `getActiveProfile()`)
- Dashboard polling already refreshes every 10s — no new mechanism needed

## Out of Scope
- Stopping dev servers from the dashboard (start only for now)
- Health-checking the dev server URL (just check PID is alive)
- Showing dev server logs in the dashboard

## Open Questions
- Should we show a tooltip with the actual URL on hover? (Probably yes, low effort)

## Related
- `lib/proxy.js` — dev server registry and URL generation
- `lib/config.js` — profile detection and `devServer.enabled` flag
- `lib/dashboard-server.js` — `collectDashboardStatusData()` builds agent objects
- `templates/dashboard/js/monitor.js` — `buildAgentStatusHtml()` renders agent rows
