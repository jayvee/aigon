---
status: implementing
updated: 2026-03-15T22:41:44.343Z
startedAt: 2026-03-10T13:17:26+11:00
completedAt: 2026-03-10T13:19:23+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 39 - conductor-menubar

## Plan

Merged two inbox features (conductor-menubar + vscode-warp-jump) into a single IDE-independent menubar solution. Implemented as SwiftBar/xbar plugin with a new `terminal-focus` CLI command for opening agent terminals.

## Progress

- Added Terminal.app support to `openSingleWorktree()`
- Implemented `aigon terminal-focus <featureId> [agent] [--repo <path>]` command
- Implemented `aigon conductor menubar-render` — outputs xbar/SwiftBar formatted menu
- Implemented `aigon conductor menubar-install` / `menubar-uninstall`
- Fixed: menubar now scans `03-in-progress/` specs as source of truth (not just log files)
- Fixed: detects fleet agents from worktree directories (not just log files)
- Fixed: `--repo` flag so terminal-focus works cross-repo from menubar clicks
- Updated README.md and docs/GUIDE.md with menubar documentation
- Created aigon-site feature spec for website showcase

## Decisions

- Used `03-in-progress/` specs as source of truth for active features, enriched with log front matter for status
- Scan `<repo>-worktrees/` directory to detect fleet agents even without log files
- Pass `--repo` flag from menubar-render to terminal-focus for cross-repo support
- SwiftBar recommended over xbar (more actively maintained, supports alternate actions)
- Terminal.app added as fourth terminal option alongside Warp, VS Code, Cursor
- Next step: tmux terminal sessions feature for true "resume running session" UX
