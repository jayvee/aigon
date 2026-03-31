---
commit_count: 5
lines_added: 461
lines_removed: 6
lines_changed: 467
files_touched: 11
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---
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

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-24

### Findings
- Linux `research-open` still defaulted to the Warp branch when `terminal=warp`, which only printed warnings on Linux and did not ensure tmux sessions existed.
- Linux `feature-open --all` had the same issue for fleet side-by-side open flows, so the default Linux config could still route into a macOS-only path.

### Fixes Applied
- `856c9289` `fix(review): route linux open flows through tmux`

### Notes
- The review fix normalizes Linux `warp` and `terminal` selections to `tmux` in the command entry points that still bypassed the Linux-safe helper path.
- Added regression coverage in `aigon-cli.test.js` for both `research-open` and `feature-open --all` on Linux.
