# Implementation Log: Feature 246 - agent-registry-single-source-of-truth
Agent: cx

## Plan
- Replace hand-maintained agent lists with registry-backed projections first so downstream surfaces can consume one stable shape.
- Move profile port defaults to `basePort + portOffset` so adding/removing an agent no longer requires editing `templates/profiles.json`.
- Lock the contract with an integration test that compares registry files against the main generated/runtime projections.

## Progress
- Added shared registry projections in `lib/agent-registry.js` for dashboard payloads, install hints, alias maps, short names, CLI mapping rows, and legacy compatibility configs.
- Swapped `lib/templates.js`, `lib/commands/setup.js`, `lib/commands/misc.js`, and `lib/profile-placeholders.js` to consume registry-backed data instead of local hardcoded lists/maps.
- Replaced dashboard frontend hardcoded agent metadata with `window.__AIGON_AGENTS__` injected by `lib/dashboard-server.js`; agent picker and ask-agent menus now render from that payload.
- Replaced hardcoded agent enumerations in `templates/help.txt`, `templates/generic/commands/help.md`, `feature-review.md`, and `feature-review-check.md` with registry-derived placeholders.
- Added `tests/integration/agent-registry-contract.test.js` and wired it into `npm test`.

## Decisions
- Kept the legacy `AGENT_CONFIGS` export as a thin projection of registry data because worktree/runtime code still reads it; the maintenance burden is removed because the projection is generated, not hand-maintained.
- Added `terminalColor`, `bannerColor`, and `shortName` to each agent JSON file so existing worktree/dashboard surfaces can keep their current behavior without a second metadata table.
- Used a server-injected bootstrap payload for dashboard agent metadata instead of introducing a new dashboard endpoint.
- Treated `solo` as a synthetic UI-only agent label (`Agent` / `Drive`) and kept the live registry authoritative for real installable agents.

## Validation
- `node -c lib/agent-registry.js`
- `node -c lib/templates.js`
- `node -c lib/git.js`
- `node -c lib/profile-placeholders.js`
- `node -c lib/commands/setup.js`
- `node -c lib/dashboard-server.js`
- `node -c templates/dashboard/js/actions.js`
- `node -c templates/dashboard/js/sidebar.js`
- `node -c lib/commands/misc.js`
- `node tests/integration/agent-registry-contract.test.js`
- `npm test`
- `aigon install-agent cx`
- `aigon server restart`

## Issues Encountered
- `aigon install-agent cx` completed but could not write the main checkout's git config (`/Users/jviner/src/aigon/.git/config`) from this worktree and could not pre-seed `~/.codex/config.toml`; both are environment-permission issues outside the edited workspace.
- `aigon server restart` reported `Load failed: 5: Input/output error` before printing `✅ Server restarting via system service.` The restart command still returned success.

## Conversation Summary
- Implemented feature 246 from the current worktree without re-running `feature-start`.
- Focused only on the files named in the spec plus the new regression test and the package test script entry.
