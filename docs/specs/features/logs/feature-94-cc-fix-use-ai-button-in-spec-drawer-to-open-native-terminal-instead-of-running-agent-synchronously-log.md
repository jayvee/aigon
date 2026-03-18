---
status: implementing
updated: 2026-03-18T03:44:11.045Z
startedAt: 2026-03-18T03:40:09.803Z
events:
  - { ts: "2026-03-18T03:40:09.803Z", status: implementing }
  - { ts: "2026-03-18T03:44:11.045Z", status: implementing }
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
