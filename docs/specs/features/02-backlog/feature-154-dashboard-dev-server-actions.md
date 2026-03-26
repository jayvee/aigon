# Feature: Dashboard Dev Server Actions

## Summary

Two new dashboard actions for dev server management: (1) a globe icon in the repo header to start/view the main branch website for comparison, and (2) a "poke" action on in-progress feature cards to force-start the worktree dev server when the agent hasn't done it yet.

## User Stories

- [ ] As a user evaluating a feature, I want to quickly open the main branch website alongside the worktree version so I can compare before/after
- [ ] As a user monitoring Fleet agents, I want to force-start a worktree's dev server when the agent hasn't done it yet, so I can preview partial work

## Action 1: Main Branch Dev Server Globe

**Location:** Repo header bar, next to the "Ask cc" button group

**Behavior:**
- Shows a globe icon (same style as the pipeline card globe)
- If the main branch dev server is already running → clicking opens the URL (e.g., `brewboard.localhost`)
- If not running → clicking starts `aigon dev-server start` on the main branch, then opens the URL once ready
- Tooltip shows the URL or "Start dev server" depending on state
- Visual state: dim/outline globe when not running, solid/bright when running

**Data already available:** `devProxyRegistry` in `dashboard-server.js` (line 664) already loads the proxy registry per repo. The main branch dev server entry would use the repo's base port (e.g., port 3000 for brewboard). The `devServerEnabled` flag from the profile determines if this is shown at all.

**Implementation:**
- Add globe to `buildAskAgentHtml()` in `sidebar.js` (or adjacent in `renderRepoHeader()`)
- New API endpoint: `POST /api/repos/:repo/dev-server/start` — runs `aigon dev-server start` in the repo's main directory
- Frontend polls or checks proxy registry for running state

## Action 2: Worktree Dev Server Poke

**Location:** Per-agent section on the pipeline card, near the existing globe slot

**Behavior:**
- Only visible when: agent session is idle/ended AND no dev server is running for that worktree
- Clicking injects `aigon dev-server start` into the agent's tmux session via `tmux send-keys`
- After injection, the button transitions to a spinner/pending state
- Once the dev server is detected as running (proxy registry update), it becomes the normal globe link
- If the tmux session is not running at all, falls back to spawning a new tmux session with just the dev-server command

**Guard rails:**
- Only available when the tmux session exists but is idle (not actively running agent commands)
- Should NOT inject into a session that's mid-implementation — check agent status is `submitted`, `idle`, or `ended`
- The `tmux send-keys` pattern already exists: `lib/worktree.js:1416` and `lib/dashboard-server.js:2032`

**Implementation:**
- Add a "Start preview" button/icon to `buildAgentSectionHtml()` in `pipeline.js`, shown when `devServerEligible && !devServerUrl`
- New API endpoint: `POST /api/repos/:repo/features/:id/agents/:agent/dev-server/poke` — injects the command into the tmux session
- Endpoint checks agent status before injecting (refuse if `implementing` and tmux is active)

## Acceptance Criteria

- [ ] Repo header shows a globe icon next to "Ask cc" for web-profile repos
- [ ] Clicking the globe starts the main branch dev server if not running, then opens the URL
- [ ] Globe shows running/stopped visual state
- [ ] Pipeline cards for in-progress features show a "Start preview" action when dev server is not running but eligible
- [ ] "Start preview" injects `aigon dev-server start` into the tmux session via send-keys
- [ ] "Start preview" is only available when agent status is submitted/idle/ended (not implementing with active session)
- [ ] Once dev server is detected running, the poke button becomes the normal globe link
- [ ] Non-web-profile repos don't show either action

## Validation

```bash
node -c lib/dashboard-server.js && node -c templates/dashboard/js/pipeline.js && node -c templates/dashboard/js/sidebar.js
```

## Technical Approach

### Backend (dashboard-server.js)
- New endpoints:
  - `POST /api/repos/:repo/dev-server/start` — starts main branch dev server
  - `POST /api/repos/:repo/features/:id/agents/:agent/dev-server/poke` — injects into tmux
- Both use existing `aigon dev-server start` CLI under the hood
- Poke endpoint checks manifest status before allowing injection

### Frontend
- `sidebar.js` — add globe to `renderRepoHeader()` / `buildAskAgentHtml()`
- `pipeline.js` — add poke button to `buildAgentSectionHtml()` when `devServerEligible && !devServerUrl`
- `styles.css` — globe states (dim/bright), poke button styling

### Existing patterns to reuse
- `buildDevServerLinkHtml()` in `pipeline.js` — globe SVG and link construction
- `tmux send-keys` in `dashboard-server.js:2032` — command injection pattern
- `loadProxyRegistry()` — dev server running detection
- `devServerEligible` / `devServerUrl` — already computed per agent in poll loop

## Dependencies

- None — uses existing infrastructure

## Out of Scope

- Auto-starting dev servers when features start (that's the agent's job)
- Dev server stop/restart actions
- Monitor view integration (pipeline only for now)

## Open Questions

- Should the main branch globe use the proxy URL (e.g., `brewboard.localhost`) or the direct port URL (`localhost:3000`)? Proxy URL is cleaner but requires proxy to be running.
- Should the poke button show a confirmation before injecting into a tmux session?
