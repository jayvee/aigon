# Feature: linux terminal support

## Summary
Make aigon's terminal launch and window management work on Linux. Currently, `openTerminalAppWithCommand()` and `tileITerm2Windows()` in `lib/worktree.js` are entirely macOS-specific (AppleScript + iTerm2/Terminal.app/Warp). On Linux, aigon should detect the platform, skip AppleScript, and use tmux-native attach or spawn a Linux terminal emulator. The core workflow (tmux sessions, worktrees, state machine, dashboard) already works cross-platform — this feature closes the terminal launch gap.

## User Stories
- [ ] As a Linux developer, I can run `aigon feature-start` and have agent sessions open in tmux without errors about missing osascript or iTerm2
- [ ] As a Linux developer, I can run `aigon feature-open` and attach to an existing tmux session in my terminal
- [ ] As a Linux developer, I can run `aigon research-open` and get side-by-side panes for fleet agents
- [ ] As a Linux developer, I can run the dashboard and click "View" / "Start" buttons that open terminal sessions
- [ ] As a Linux developer, I can follow installation docs to set up aigon from scratch on Ubuntu/Fedora/Arch

## Acceptance Criteria
- [ ] `openTerminalAppWithCommand()` detects `process.platform === 'linux'` and uses a Linux code path
- [ ] Linux path: attaches to tmux session directly (`tmux attach -t <session>`) in a new terminal window, or prints the attach command if no GUI terminal is available
- [ ] Supported Linux terminals (checked in order): kitty, gnome-terminal, xterm, fallback to printing the command
- [ ] `tileITerm2Windows()` is skipped on Linux (no-op with a log message suggesting manual tmux pane layout)
- [ ] `open` command usages replaced with `xdg-open` on Linux (URL opening, file opening)
- [ ] Warp-specific code paths (`open warp://`) are skipped on Linux with a warning
- [ ] `aigon doctor` checks for tmux availability on Linux and warns about missing terminal emulators
- [ ] All existing macOS behavior is unchanged — Linux paths are additive, gated by `process.platform`
- [ ] `node -c` syntax check passes on all modified files
- [ ] Linux installation docs added to `docs/` or `README.md` covering: prerequisites (node, tmux, git), install steps, terminal emulator recommendations, and known limitations vs macOS

## Validation
```bash
node -c lib/worktree.js
node -c lib/commands/research.js
node -c lib/templates.js
```

## Technical Approach

### Platform abstraction in `lib/worktree.js`

Extract a `openTerminalWithTmux(sessionName, command, cwd)` function that branches on `process.platform`:

- **darwin**: existing AppleScript logic (iTerm2 / Terminal.app / Warp) — no changes
- **linux**:
  1. If session is already attached, print "already attached" and return
  2. Try to spawn a terminal emulator with `tmux attach -t <session>`:
     - `kitty tmux attach -t <session>`
     - `gnome-terminal -- tmux attach -t <session>`
     - `xterm -e tmux attach -t <session>`
  3. If no GUI terminal found, print the `tmux attach` command for the user to run manually

### Files to modify

| File | Change |
|------|--------|
| `lib/worktree.js` | Platform branch in `openTerminalAppWithCommand()`, no-op `tileITerm2Windows()` on Linux, add Linux terminal detection |
| `lib/templates.js` | Replace `osascript` trash command with `gio trash` or `rm` on Linux |
| `lib/commands/research.js` | `research-open` Warp code path: skip on Linux |
| `lib/config.js` | Add `tmuxApp` option value `tmux` for headless/Linux (just attaches directly) |
| `docs/linux-install.md` | New file: prerequisites, install steps, terminal setup, Caddy/proxy notes, known limitations |

### Key decisions
- **tmux is the universal substrate** — all platforms already use tmux for sessions. The only difference is how we open a terminal window to attach to it.
- **No heavy dependencies** — don't add node-pty or electron. Just spawn system terminal emulators.
- **Graceful degradation** — if no GUI terminal is found, print the command. This supports headless/SSH use cases too.

## Dependencies
- None — this is purely additive platform detection logic

## Out of Scope
- Windows/WSL support (separate feature if needed)
- Linux GUI for the dashboard (it's already a web server — works as-is)
- Automated testing on Linux CI (would need a Docker-based test harness — separate feature)

## Open Questions
- Should we auto-detect the user's preferred terminal from `$TERMINAL` or `$TERM_PROGRAM` env vars?
- Should the config allow `tmuxApp: 'kitty'` or `tmuxApp: 'gnome-terminal'` on Linux?

## Related
- `lib/worktree.js` — primary file, all terminal launch logic
- `lib/config.js` — `tmuxApp` configuration
