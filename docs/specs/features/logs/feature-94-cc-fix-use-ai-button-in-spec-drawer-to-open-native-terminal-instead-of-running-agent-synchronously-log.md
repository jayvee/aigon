---
status: submitted
updated: 2026-03-18T04:35:35.863Z
startedAt: 2026-03-18T03:40:09.803Z
completedAt: 2026-03-18T04:35:35.863Z
events:
  - { ts: "2026-03-18T03:40:09.803Z", status: implementing }
  - { ts: "2026-03-18T03:44:11.045Z", status: implementing }
  - { ts: "2026-03-18T03:47:20.107Z", status: submitted }
  - { ts: "2026-03-18T03:59:21.383Z", status: submitted }
---

# Implementation Log: Feature 94 - fix-use-ai-button-in-spec-drawer-to-open-native-terminal-instead-of-running-agent-synchronously
Agent: cc

## Summary

Implemented the "Use AI" button in the spec drawer to open a native terminal session via `/api/session/ask` instead of running the agent synchronously via `/api/session/run`.

## Changes

- **`templates/dashboard/index.html`**: Added "Use AI" button to spec drawer header (between Refresh and Open in Editor)
- **`templates/dashboard/js/spec-drawer.js`**: Added `type` and `repoPath` fields to `drawerState`; added `specTypeFromPath()` to derive spec type from path; updated `openDrawer()` to accept optional `repoPath`; added `launchAiSession()` that calls `/api/session/ask` with a type-aware initial prompt; wired button event listener
- **`templates/dashboard/js/pipeline.js`**: Updated `openDrawer` call in card click handler to pass `repoPath`
- **`lib/dashboard-server.js`**: Updated `/api/session/ask` handler to accept optional `prompt` field and append it (shell-quoted) to the agent command on new session creation

## Decisions

- **Spec type from path**: Derived from path pattern (`/research/`, `/feedback/`, else `feature`) — avoids changing `openDrawer` signature to carry redundant type info
- **repoPath optional**: Made optional in `openDrawer` so existing callers (monitor.js, logs.js, terminal.js) don't break. Show informative error toast when missing.
- **Prompt on new sessions only**: When tmux session already exists, the server attaches without re-prompting (existing behavior preserved) — only new sessions get the initial prompt
- **Pre-existing test failures**: 2 Playwright tests were already failing before these changes (agent badge and status dot tests) — confirmed by stash test

## Testing

- User tested via the worktree dashboard at `http://cc-94.aigon.localhost` (port 4175)
- Initial `/api/spec` error ("No route found") was a stale AIGON server process on the main repo — resolved by restarting
- Proxy memory was outdated (referenced Caddy/dnsmasq) — corrected: proxy is a Node.js daemon using RFC 6761 `.localhost` domains; no DNS config needed
- Worktree dashboard must be started to register itself in `~/.aigon/dev-proxy/servers.json` before the proxy URL works
