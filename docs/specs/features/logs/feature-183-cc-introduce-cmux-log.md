# Implementation Log: Feature 183 - introduce-cmux
Agent: cc

## Plan

Add cmux as a first-class terminal option in Aigon. cmux is a macOS-native terminal built on libghostty with AI-agent-first features (workspace metadata sidebar, socket API, desktop notifications, progress bars). It slots into the existing architecture where tmux manages sessions and cmux acts as the terminal emulator that attaches to them.

## Progress

- Explored existing terminal handling patterns across worktree.js, feature.js, config.js, misc.js, setup.js
- Designed implementation plan covering all acceptance criteria
- Implemented cmux detection helpers and socket API wrappers
- Added cmux branch to openSingleWorktree() with graceful fallback
- Added openInCmuxSplitPanes() for Fleet mode split-pane layouts
- Routed cmux in feature-open parallel, arena, and single modes
- Added cmux status/notification push on agent-status changes
- Added cmux availability check to doctor command
- Wrote 6 unit tests for cmux helpers
- All 17 test suites pass, all syntax checks pass

## Decisions

- **cmux uses its own workspace API, not openTerminalAppWithCommand()**: Unlike iTerm2/Terminal.app which use AppleScript, cmux has a CLI-based workspace creation API. So `terminal === 'cmux'` gets its own branch in `openSingleWorktree()` rather than extending the `tmuxApp` config path.

- **Opportunistic cmux enhancements**: All cmux socket API calls (set-status, notify, set-progress) are wrapped in `cmuxExec()` which silently catches errors. This means cmux features are best-effort and never block the main workflow.

- **CMUX_WORKSPACE_ID for detection in agent-status**: Rather than checking the socket file, we detect cmux context via the `CMUX_WORKSPACE_ID` env var that cmux sets in child processes. This is more reliable since it confirms we're actually inside a cmux workspace.

- **Graceful fallback**: If `terminal: "cmux"` is configured but cmux is not installed, we fall back to `tmux` (via default terminal) with a warning message. Same pattern as Warp on Linux.

- **No changes to tmux session management**: cmux is purely a terminal emulator layer. All tmux session creation, naming, cleanup works unchanged.
