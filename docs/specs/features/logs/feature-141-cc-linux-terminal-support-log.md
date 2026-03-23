# Implementation Log: Feature 141 - linux-terminal-support
Agent: cc

## Plan

Platform-gate all macOS-specific code (AppleScript, iTerm2, Warp, `open`) behind `process.platform` checks. Add Linux alternatives that use standard tools (terminal emulators, xdg-open, gio trash, tmux). Graceful degradation when no GUI is available.

## Progress

- Read all affected files to understand current macOS-specific code paths
- Added `detectLinuxTerminal()` and `buildLinuxTerminalSpawnArgs()` helpers to worktree.js
- Modified `openTerminalAppWithCommand()` with Linux code path (kitty → gnome-terminal → xterm → print fallback)
- Made `tileITerm2Windows()` no-op on Linux with tmux layout hint
- Added Linux guards to `openInWarpSplitPanes()`, `closeWarpWindow()`, `openSingleWorktree()`
- Added `platformOpen()` helper to dashboard-server.js (xdg-open on Linux)
- Added `gio trash` / `trash-put` fallback in `safeRemoveWorktree()` (templates.js)
- Added `linuxTerminal` config option to DEFAULT_GLOBAL_CONFIG
- Added Linux platform checks to `aigon doctor` (tmux, terminal emulators, xdg-open)
- Created `docs/linux-install.md` with full installation guide
- Added tests for `detectLinuxTerminal` and `closeWarpWindow` on Linux
- All syntax checks pass, all worktree tests pass (14/14)

## Decisions

- **kitty as top preference**: GPU-accelerated, widely available on Linux, best UX
- **Spawn detached**: Linux terminal processes are spawned detached (`child.unref()`) so they don't block aigon
- **Fallback to printing**: If no GUI terminal found, print the tmux attach command — supports headless/SSH
- **Config key `linuxTerminal`**: Separate from `tmuxApp` (which is macOS-specific iTerm2 vs Terminal.app)
- **gio trash before rm**: GNOME's `gio trash` preserves files in trash; falls back to `trash-put` (trash-cli), then `rm`
- **No changes to macOS paths**: All Linux code is additive, gated by `process.platform === 'linux'`
