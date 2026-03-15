# Feature: Dashboard Sessions & Command Runner

## Summary

The dashboard can monitor activity, move items between stages, create specs, and edit them inline. But two capabilities are missing: (1) running Aigon commands directly instead of copying them to a terminal, and (2) launching AI agent sessions to help write specs.

Both needs share the same infrastructure — the ability to spin up tmux sessions from the dashboard, optionally display them in an embedded terminal, and tear them down when done. This feature adds a unified session layer that powers three interaction tiers:

- **Fire & forget** — non-interactive commands (e.g. `feature-close`) run in the background with a toast on completion.
- **Visible terminal** — interactive commands (e.g. `feature-eval`, `feature-setup`) open an embedded terminal panel.
- **Agent session** — AI-assisted spec creation/editing opens a full agent terminal with repo context.

The current "Copy next" button on feature cards becomes a **"Run next" split button** with a primary action and a dropdown of alternative actions. Hovering any option shows what command it runs and why.

## User Stories

- [ ] As a user, I can click "Run next" on a feature card to execute the suggested next action directly, so I don't have to copy commands and switch to a terminal.
- [ ] As a user, I can see multiple next-action options in a dropdown and pick the one I want, so I'm not locked into a single suggestion.
- [ ] As a user, I can hover over any action option to see what command it runs and why, so I understand what will happen before clicking.
- [ ] As a user creating a new feature, I can press "Use AI" to get an agent session that helps me write the spec, so I don't have to craft acceptance criteria from scratch.
- [ ] As a user viewing an existing spec in the drawer, I can launch an AI session to refine or expand it, so I can iterate on specs without switching windows.
- [ ] As a user, I can choose which agent to use (cc, gg, cx, cu) with my last choice remembered, so I always get my preferred model.
- [ ] As a user, I can see a terminal panel in the dashboard when a command needs interaction, so I stay in the dashboard context.
- [ ] As a user, I can stop or close any running session from the dashboard, so I stay in control.

## Acceptance Criteria

### Run next button (replaces "Copy next")

- [ ] Each feature card's "Copy next" button becomes a split button: primary "Run" action + dropdown chevron.
- [ ] Clicking the primary button executes the top-ranked action immediately.
- [ ] Clicking the chevron opens a dropdown showing all available actions for that feature.
- [ ] Each dropdown item shows: action label, the command it runs (monospace), and a one-line reason.
- [ ] Hovering the primary button shows a tooltip with the command and reason.
- [ ] While a command is running, the button shows a spinner and is disabled.
- [ ] On completion, a toast shows success/failure. On failure, the terminal panel opens automatically to show output.

### Multiple next actions

- [ ] `inferDashboardNextActions()` returns an ordered array of `{ command, label, reason, mode }` objects (replaces `inferDashboardNextCommand()`).
- [ ] Each action has a `mode`: `fire-and-forget`, `terminal`, or `agent`.
- [ ] Actions are context-aware based on feature stage, agent status, and fleet/solo mode.
- [ ] Example action sets:
  - **Solo, submitted**: primary = "Close feature" (`feature-close`), alt = "Review first" (`feature-review`), "Evaluate" (`feature-eval`)
  - **Fleet, all submitted**: primary = "Evaluate" (`feature-eval`), alt = "Close with winner" (`feature-close <id> <agent>`)
  - **In-progress, waiting**: primary = "Focus terminal" (`terminal-focus`), alt = "Stop agent" (session stop)
  - **In-progress, implementing**: primary = "Attach" (open terminal), alt = "Stop agent"
  - **Backlog**: primary = "Start feature" (`feature-setup`), alt = "Start with fleet" (`feature-setup <id> cc gg`)

### Execution tiers

#### Fire & forget (non-interactive commands)
- [ ] Commands like `feature-close`, `feature-prioritise` run via `POST /api/session/run`.
- [ ] No terminal panel opens. A spinner shows on the button, toast on completion.
- [ ] If the command fails (non-zero exit), the terminal panel opens to show the error output.
- [ ] Stdout/stderr are captured and available for inspection.

#### Visible terminal (interactive commands)
- [ ] Commands like `feature-eval`, `feature-setup` open the terminal panel.
- [ ] The terminal panel slides out from the right (consistent with the spec drawer).
- [ ] The panel shows a live xterm.js terminal connected to the tmux session via WebSocket.
- [ ] The user can interact with the command (answer prompts, provide input).
- [ ] A "Close" button detaches from (but does not kill) the session. A "Stop" button kills it.

#### Agent session (AI-assisted creation/editing)
- [ ] "Use AI" button on the create modal and spec drawer header launches an agent session.
- [ ] Before launch, an agent picker appears (cc, gg, cx, cu) defaulting to last-used (localStorage).
- [ ] The agent runs in the correct repo directory with the spec file path as initial context.
- [ ] The terminal panel opens in fullscreen mode for agent sessions.
- [ ] On close, the spec drawer refreshes to show any changes the agent made.

### Terminal panel

- [ ] The panel reuses the drawer slide-out/fullscreen container pattern from the spec drawer.
- [ ] Panel header shows: session label, command badge, status indicator (running/stopped), Stop, Close buttons.
- [ ] xterm.js renders in the panel body with proper sizing and resize handling.
- [ ] Panel supports fullscreen toggle (Cmd+Shift+F, same as spec drawer).
- [ ] Multiple panels are NOT supported — opening a new session closes/detaches the current one (with confirmation if running).
- [ ] ESC closes the panel (detaches, does not kill).

### Session lifecycle

- [ ] Sessions run in tmux (named `aigon-dash-<type>-<timestamp>`, e.g. `aigon-dash-cmd-1710500000`).
- [ ] Closing the panel detaches from (but does not kill) the tmux session.
- [ ] The Stop button kills the tmux session after confirmation.
- [ ] Sessions auto-clean: fire-and-forget sessions are killed on completion; terminal/agent sessions are killed after 1 hour of inactivity (configurable).
- [ ] Dashboard reconnects to a running session if the panel is reopened before the session ends.

### Agent picker

- [ ] Shows available agents (cc, gg, cx, cu) with labels ("Claude Code", "Gemini", "Codex", "Cursor").
- [ ] Last-used agent persisted in localStorage (`aigon.dashboard.lastAgent`).
- [ ] Pre-selects the last-used agent. Single click to launch.

## Technical Approach

### API endpoints

```
POST /api/session/start
  Body: { command, cwd, mode, label }
  Response: { sessionName, pid }
  Creates a tmux session running the command.

GET /ws/terminal?session=<name>
  WebSocket upgrade. Relays stdin/stdout between xterm.js and the tmux session PTY.
  Uses node-pty or direct tmux pipe-pane / capture-pane approach.

POST /api/session/stop
  Body: { sessionName }
  Kills the tmux session.

GET /api/session/status
  Query: ?session=<name>
  Response: { running, exitCode }
  For fire-and-forget polling.

POST /api/session/run
  Body: { command, cwd }
  Response: { stdout, stderr, exitCode }
  Synchronous execution for simple fire-and-forget commands.
  Reuses existing runRadarInteractiveAction() pattern.
```

The existing `/api/action` endpoint already does synchronous command execution via `spawnSync()`. The new `/api/session/run` endpoint is a thin wrapper with a cleaner interface. For visible/agent tiers, the WebSocket endpoint is new.

### WebSocket terminal relay

```
Client (xterm.js)  ←→  WebSocket  ←→  Server  ←→  tmux session PTY

1. Client opens WebSocket to /ws/terminal?session=<name>
2. Server attaches to tmux session via:
   - Option A: spawn `tmux attach -t <name>` with a PTY (node-pty)
   - Option B: tmux pipe-pane + capture-pane (no node-pty dependency)
3. stdin from xterm.js → write to PTY
4. stdout from PTY → send to xterm.js
5. On disconnect: detach (session keeps running)
```

Option B is preferred to avoid the `node-pty` native dependency. Using `tmux pipe-pane` to capture output and `tmux send-keys` for input avoids needing to compile anything.

### inferDashboardNextActions()

Replaces `inferDashboardNextCommand()`. Returns an array:

```javascript
function inferDashboardNextActions(featureId, agents, stage) {
  const id = String(featureId).padStart(2, '0');
  const actions = [];
  const isFleet = agents.some(a => a.id !== 'solo');
  const allSubmitted = agents.every(a => a.status === 'submitted');
  const hasWaiting = agents.some(a => a.status === 'waiting');

  if (stage === 'in-evaluation') {
    actions.push({ command: `aigon feature-eval ${id}`, label: 'Evaluate', reason: 'Evaluation in progress', mode: 'agent' });
    actions.push({ command: `aigon feature-close ${id}`, label: 'Close', reason: 'Close without further evaluation', mode: 'fire-and-forget' });
    return actions;
  }

  if (hasWaiting) {
    actions.push({ command: `aigon terminal-focus ${id}`, label: 'Focus terminal', reason: 'Agent is waiting for input', mode: 'terminal' });
  }

  if (allSubmitted && isFleet) {
    actions.push({ command: `aigon feature-eval ${id}`, label: 'Evaluate', reason: 'All agents submitted; compare implementations', mode: 'agent' });
    agents.filter(a => a.status === 'submitted').forEach(a => {
      actions.push({ command: `aigon feature-close ${id} ${a.id}`, label: `Close with ${a.id}`, reason: `Merge ${a.id}'s implementation`, mode: 'fire-and-forget' });
    });
  }

  if (allSubmitted && !isFleet) {
    actions.push({ command: `aigon feature-close ${id}`, label: 'Close feature', reason: 'Solo implementation submitted; merge to main', mode: 'fire-and-forget' });
    actions.push({ command: `aigon feature-review ${id}`, label: 'Review first', reason: 'Get a code review before closing', mode: 'agent' });
    actions.push({ command: `aigon feature-eval ${id}`, label: 'Evaluate', reason: 'Run evaluation before closing', mode: 'agent' });
  }

  if (stage === 'backlog') {
    actions.push({ command: `aigon feature-setup ${id}`, label: 'Start feature', reason: 'Set up workspace and begin', mode: 'terminal' });
    actions.push({ command: `aigon feature-setup ${id} cc gg`, label: 'Start fleet', reason: 'Set up fleet with Claude + Gemini', mode: 'terminal' });
  }

  return actions;
}
```

### Agent start command

```bash
# Example for Claude Code (cc)
tmux new-session -d -s "aigon-dash-agent-<timestamp>" \
  "cd <repo-path> && claude 'Help me write the spec at <spec-path>. Read the file first, then ask me what I want this feature to do.'"
```

Each agent CLI has its own invocation pattern (from `~/.aigon/config.json` agents config).

### Dashboard UI

#### Run next split button (replaces Copy next)

```html
<div class="run-next-group">
  <button class="btn btn-primary run-next-primary"
          title="aigon feature-close 59 — Solo submitted; merge to main">
    Close feature
  </button>
  <button class="btn btn-primary run-next-chevron" aria-haspopup="true">▾</button>
  <div class="run-next-dropdown hidden">
    <button class="dropdown-item" data-command="aigon feature-review 59" data-mode="agent">
      <span class="item-label">Review first</span>
      <span class="item-command">aigon feature-review 59</span>
      <span class="item-reason">Get a code review before closing</span>
    </button>
    <button class="dropdown-item" data-command="aigon feature-eval 59" data-mode="agent">
      <span class="item-label">Evaluate</span>
      <span class="item-command">aigon feature-eval 59</span>
      <span class="item-reason">Run evaluation before closing</span>
    </button>
  </div>
</div>
```

#### Terminal panel

```
.terminal-panel (reuses .spec-drawer positioning)
├── .panel-header (label, command badge, status dot, [Stop] [Close])
├── .terminal-container (xterm.js fills this, flex-grow)
└── .panel-footer (session name, elapsed time)
```

### State flow

```
Feature Card                     Spec Drawer              Create Modal
  ┌──────────────┐               ┌──────────┐            ┌─────────┐
  │ [Run next ▾] │               │ [Use AI] │            │ [Use AI]│
  └──────┬───────┘               └────┬─────┘            └────┬────┘
         │                             │                       │
         ▼                             ▼                       ▼
  ┌──────────────┐            ┌──────────────┐         ┌──────────────┐
  │ Action Menu  │            │ Agent Picker │         │ Agent Picker │
  │ (multiple    │            │ (cc/gg/cx/cu)│         │ (cc/gg/cx/cu)│
  │  options)    │            └──────┬───────┘         └──────┬───────┘
  └──────┬───────┘                   │                        │
         │                           ▼                        ▼
         ├─── fire-and-forget ──▶ [spinner + toast]
         │
         ├─── terminal ──┐
         │                ▼
         │         ┌──────────────┐
         └─ agent ─▶ Terminal     │
                   │ Panel        │
                   │ (xterm.js)   │
                   │ [Stop][Close]│
                   └──────┬───────┘
                          │ on close
                          ▼
                   ┌──────────────┐
                   │ Spec Drawer  │
                   │ (refreshed)  │
                   └──────────────┘
```

### CDN dependencies

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-attach@0/lib/addon-attach.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.min.js"></script>
```

## Validation

```bash
node -c lib/utils.js
```

Manual checks:
- Feature card shows "Run next" split button with correct primary action
- Chevron opens dropdown with multiple context-aware options
- Hovering any option shows the command and reason
- Fire-and-forget command: click "Close feature" → spinner → toast on completion
- Terminal command: click "Start feature" → terminal panel opens with live session
- Agent command: click "Use AI" on create modal → agent picker → terminal panel with agent running
- Close terminal panel → session keeps running in tmux (can reattach)
- Stop button → confirms → kills tmux session
- Failed fire-and-forget → terminal panel opens automatically showing error
- Refresh page → last-used agent remembered

## Dependencies

- xterm.js (CDN, ~50KB) for terminal rendering
- xterm-addon-attach (CDN) for WebSocket connection
- xterm-addon-fit (CDN) for auto-resize
- WebSocket support in the Radar HTTP server (upgrade handling on existing `http.createServer`)
- Existing tmux infrastructure in Aigon (`buildTmuxSessionName`, `createDetachedTmuxSession`, etc.)

## Out of Scope

- Multiple simultaneous terminal panels (one at a time, opening a new one detaches the current)
- Streaming API-only agent (no terminal) — always uses a full CLI agent session
- Agent-to-agent collaboration within the dashboard
- Voice input
- Custom command input (only pre-defined actions from `inferDashboardNextActions()` and "Use AI")

## Related

- Feature 59: dashboard-repo-sidebar (the drawer, create modal, and kanban cards this extends)
- Feature 57: control-surface-dashboard-operator-console (broader dashboard improvements)
- `feature-dashboard-notification-drawer` (also adds UI to the dashboard)
- Existing tmux session management in `lib/utils.js` (`buildTmuxSessionName`, `createDetachedTmuxSession`, `safeTmuxSessionExists`)
- Existing `/api/action` endpoint (synchronous command execution via `spawnSync`)
- Existing `/api/attach` endpoint (opens external terminal to attach to tmux session)
