---
commit_count: 5
lines_added: 328
lines_removed: 120
lines_changed: 448
files_touched: 22
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 6325126
output_tokens: 22877
cache_creation_input_tokens: 0
cache_read_input_tokens: 6092800
thinking_tokens: 5115
total_tokens: 6348003
billable_tokens: 6353118
cost_usd: 14.0518
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
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

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-20

### Findings
- `templates/dashboard/js/pipeline.js:88-92` still hardcoded `getAgentPromptPrefix` as an `agentId === 'cx' / 'cu'` ladder. This violated acceptance criterion #1 (no hardcoded agent metadata in dashboard JS) — deleting `cu.json` or `cx.json` would leave dangling references.

### Fixes Applied
- `fix(review): route dashboard prompt prefix through registry` — added `cmdPrefix` to `getDashboardAgents()` in `lib/agent-registry.js` (sourced from `placeholders.CMD_PREFIX`) and rewrote `getAgentPromptPrefix` to read it from `window.__AIGON_AGENTS__`.

### Notes
- The rest of the implementation is solid: registry projections are the single source of truth, the new contract test guards against drift, and `npm test` passes clean.
- Minor observations left as-is (not in scope for a spec-bounded review): `actions.js:647` still defaults the autonomous checkbox to `cc` with a literal ID, and several `|| 'cc'` fallbacks remain in `pipeline.js` / `sidebar.js`. These are defaults, not enumerated metadata, so they don't block the AC — but they are still drift risks if `cc` is ever retired.
