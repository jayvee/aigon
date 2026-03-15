# Feature: use AI in dashboard

## Summary

The web dashboard is extremely useful for monitoring activity and moving items between states — much quicker than the command line. It can also create new features, research topics, and feedback items. But creation is where agent assistance is most valuable: helping craft the summary, acceptance criteria, and technical approach.

This feature adds the ability to spin up an inline agent session from the dashboard when creating or editing a spec. After naming a new item (or opening an existing one), the user can choose "Use AI" to launch an agent terminal embedded in the dashboard. The agent is pre-loaded in the correct repo context, aware of the spec file, and ready for the user to describe what they want in natural language. The agent then helps flesh out the spec collaboratively.

## User Stories

- [ ] As a user creating a new feature, I can press "Use AI" after naming it to get an agent session that helps me write the spec, so I don't have to craft acceptance criteria and technical approach from scratch.
- [ ] As a user viewing an existing spec in the drawer, I can launch an AI session to refine or expand it, so I can iterate on specs without switching to a terminal.
- [ ] As a user, I can choose which agent to use (cc, gg, cx), with my last choice remembered, so I always get my preferred model without re-selecting every time.
- [ ] As a user, I can see the agent's output and interact with it directly in the dashboard, so I don't lose context by switching windows.
- [ ] As a user, I can review and accept the agent's suggested changes before they're written to the spec file, so I stay in control of the content.

## Acceptance Criteria

### Launch flow
- [ ] The create modal gains a "Use AI" button alongside the existing "Create" button.
- [ ] Clicking "Use AI" creates the spec file (same as "Create"), then opens an agent panel instead of the normal edit drawer.
- [ ] The spec drawer header gains a "Use AI" button that launches an agent session for the currently open spec.
- [ ] Before launch, a small agent picker appears (defaulting to the last-used agent, stored in localStorage).

### Agent panel
- [ ] An embedded terminal panel opens in the dashboard (slide-out or fullscreen, consistent with the existing drawer UX).
- [ ] The terminal connects to a real agent session (tmux session running the selected agent CLI).
- [ ] The agent is started with the spec file path as context, so it knows what it's working on.
- [ ] The user can type natural language descriptions and the agent responds with suggested spec content.
- [ ] The panel shows a live terminal (xterm.js or similar) with full input/output.

### Agent context
- [ ] The agent session runs in the correct repo directory (the repo the spec belongs to).
- [ ] The agent is given an initial prompt: the spec file path and an instruction to help the user flesh out the spec.
- [ ] The agent can read and write the spec file directly.

### Agent selection
- [ ] The agent picker shows available agents (cc, gg, cx, cu) with the last-used agent pre-selected.
- [ ] Last-used agent is persisted in localStorage (`aigon.dashboard.lastAgent`).
- [ ] Each agent shows its label (e.g. "Claude Code", "Gemini", "Codex").

### Integration with existing drawer
- [ ] After the agent session ends (or the user closes the panel), the drawer refreshes to show the updated spec content.
- [ ] The user can switch between the agent panel and the read/edit drawer at any time.

### Session lifecycle
- [ ] The agent runs in a tmux session (named consistently with existing Aigon tmux conventions).
- [ ] Closing the agent panel detaches from (but does not kill) the tmux session, so it can be reattached.
- [ ] A "Stop" button kills the tmux session if the user wants to terminate the agent.

## Technical Approach

### Terminal embedding

Use **xterm.js** (CDN) to embed a terminal in the dashboard. Connect it to a server-side PTY via WebSocket:

1. Dashboard loads xterm.js + WebSocket addon from CDN
2. New API endpoint `POST /api/agent/start` creates a tmux session running the chosen agent CLI with the spec file as context
3. New WebSocket endpoint `/ws/terminal` attaches to the tmux session's PTY, relaying stdin/stdout between xterm.js and the process
4. The agent panel renders xterm.js in a container matching the drawer's slide-out or fullscreen layout

### Agent start command

```bash
# Example for Claude Code (cc)
tmux new-session -d -s "aigon-spec-cc-<timestamp>" \
  "cd <repo-path> && claude 'Help me write the spec at <spec-path>. Read the file first, then ask me what I want this feature to do.'"
```

Each agent CLI has its own invocation pattern (from `~/.aigon/config.json` agents config).

### API endpoints

- `POST /api/agent/start` — body: `{ repoPath, specPath, agent }` — creates tmux session, returns `{ sessionName }`
- `GET /ws/terminal?session=<name>` — WebSocket upgrade, attaches to tmux session PTY
- `POST /api/agent/stop` — body: `{ sessionName }` — kills the tmux session

### Dashboard UI

The agent panel reuses the drawer's slide-out/fullscreen container pattern:

```
.spec-drawer (or .agent-panel)
├── .drawer-header (title, agent badge, Stop, Close)
├── .terminal-container (xterm.js fills this)
└── .drawer-footer (status, "Back to Editor" button)
```

### State flow

```
Create Modal                    Spec Drawer
  ┌─────────┐                   ┌──────────┐
  │ Name    │                   │ Read mode│
  │ [Create]│──creates file───▶ │ [Use AI] │
  │ [Use AI]│──creates file───┐ │          │
  └─────────┘                 │ └──────────┘
                              │      │
                              ▼      ▼
                         ┌──────────────┐
                         │ Agent Picker  │
                         │ (cc/gg/cx/cu) │
                         └──────┬───────┘
                                ▼
                         ┌──────────────┐
                         │ Agent Panel   │
                         │ (xterm.js)    │
                         │ [Stop] [Close]│
                         └──────┬───────┘
                                │ on close
                                ▼
                         ┌──────────────┐
                         │ Spec Drawer   │
                         │ (refreshed)   │
                         └──────────────┘
```

## Validation

```bash
node -c lib/utils.js
```

Manual checks:
- Create a new feature via dashboard → click "Use AI" → agent picker appears with last-used default
- Select agent → terminal panel opens with agent running in correct repo
- Type a description → agent suggests spec content → content appears in spec file
- Close panel → drawer shows updated spec
- Open existing spec → click "Use AI" → agent session starts with file context
- Stop button kills tmux session
- Refresh page → last-used agent is remembered

## Dependencies

- xterm.js (CDN, ~50KB) for terminal rendering
- node-pty or direct tmux attach for server-side PTY relay
- WebSocket support in the Radar HTTP server (upgrade handling)
- Existing tmux infrastructure in Aigon

## Out of Scope

- Streaming API-only agent (no terminal) — always uses a full CLI agent session
- Multiple simultaneous agent panels
- Agent-to-agent collaboration within the dashboard
- Voice input
- Auto-applying agent suggestions without user review (agent writes to file directly via its normal tools)

## Related

- Feature 59: dashboard-repo-sidebar (the drawer and create modal this extends)
- Feature 57: control-surface-dashboard-operator-console (broader dashboard improvements)
- `feature-dashboard-notification-drawer` (also adds UI to the dashboard)
- Existing tmux session management in `aigon-cli.js`
