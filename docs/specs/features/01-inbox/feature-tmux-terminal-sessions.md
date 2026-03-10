# Feature: tmux-terminal-sessions

## Summary

Add tmux as a terminal option alongside Warp, VS Code, Cursor, and Terminal.app. When `terminal: "tmux"` is configured, agent sessions run in named tmux sessions that persist across terminal closes. `terminal-focus` attaches to the existing session instead of opening a new tab — enabling true "bring it back" UX where you can detach, close your terminal, and reattach later to find the agent exactly where you left it.

Builds on the conclusions from Research #06 (tmux-conductor).

## User Stories

- [ ] As a developer, I want to close my terminal and come back later to find my agent session still running, so I don't lose progress
- [ ] As a developer using the menubar, I want to click an agent and immediately attach to its running tmux session, not open a new empty terminal
- [ ] As a developer running fleet mode, I want each agent in its own named tmux session so I can attach to any one individually
- [ ] As a developer, I want to keep using Warp/VS Code for some projects and tmux for others, configurable per-project or globally

## Acceptance Criteria

### Session lifecycle
- [ ] `aigon feature-setup` creates named tmux sessions (e.g. `aigon-f135-cc`) when terminal is set to `tmux`
- [ ] Sessions start the agent CLI automatically (e.g. `claude --permission-mode acceptEdits /aigon:feature-implement 135`)
- [ ] Sessions persist after terminal close (detached tmux sessions)
- [ ] `aigon sessions-close` kills tmux sessions alongside existing process cleanup

### Terminal focus (attach)
- [ ] `aigon terminal-focus` with `terminal: "tmux"` runs `tmux attach -t <session-name>`
- [ ] If session doesn't exist, creates a new one at the worktree path
- [ ] Menubar click attaches to the tmux session (true resume, not new tab)

### Configuration
- [ ] `~/.aigon/config.json` → `"terminal": "tmux"` sets tmux as default
- [ ] Per-project override in `.aigon/config.json`
- [ ] Warp, VS Code, Cursor, Terminal.app remain as options — tmux is additive

### Session naming
- [ ] Convention: `aigon-f<ID>-<agent>` (e.g. `aigon-f135-cc`, `aigon-f39-solo`)
- [ ] `tmux ls` shows all Aigon sessions clearly

### Worktree open
- [ ] `aigon worktree-open` supports `--terminal=tmux`
- [ ] Opens a terminal emulator window that attaches to the tmux session

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Creating sessions

In `feature-setup` (fleet mode), after creating worktrees:

```javascript
if (terminal === 'tmux') {
    const sessionName = `aigon-f${featureId}-${agent}`;
    const agentCmd = buildAgentCommand(wt, 'implement');
    execSync(`tmux new-session -d -s "${sessionName}" -c "${wt.path}" "${agentCmd}"`);
}
```

### Attaching in terminal-focus

```javascript
if (terminal === 'tmux') {
    const sessionName = `aigon-f${featureId}-${agent}`;
    // Check if session exists
    try {
        execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`);
        // Attach — this needs a terminal, so open one that attaches
        execSync(`open -a Terminal`); // or use $TERM_PROGRAM
        // Then in that terminal: tmux attach -t sessionName
    } catch (e) {
        // Session doesn't exist, create new
    }
}
```

### Key design decision: how to attach

tmux attach needs an interactive terminal. Options:
1. **Terminal.app + tmux attach** — `open -a Terminal` then send `tmux attach` via AppleScript
2. **Warp + tmux attach** — open Warp tab with `tmux attach -t ...` as the command
3. **iTerm2 tmux integration** — iTerm2 has native tmux support (`tmux -CC`)
4. **Direct attach** — if already in a terminal, just `tmux attach` directly

Recommended: use the user's preferred terminal emulator to open a window that runs `tmux attach -t <session>`. This separates "which terminal emulator" from "session management via tmux".

## Dependencies

- tmux must be installed (`brew install tmux`)
- Research #06 tmux-conductor (done — conclusions inform this design)
- Feature #39 conductor-menubar (done — provides terminal-focus and menubar)

## Out of Scope

- Full conductor orchestration (that's the conductor feature)
- tmux layout management (split panes, etc.)
- Remote tmux sessions (SSH)
- iTerm2 tmux -CC integration (future enhancement)

## Open Questions

- Should `feature-setup` in drive mode (no worktree) also create a tmux session?
- Should there be a `aigon sessions list` command that shows all tmux sessions?
- How to handle nested tmux (user already in a tmux session)?

## Related

- Research #06: tmux-conductor (research conclusions)
- Feature #39: conductor-menubar (terminal-focus command, menubar)
- Feature #23: shell-launch-agent (agent CLI launching from shell)
