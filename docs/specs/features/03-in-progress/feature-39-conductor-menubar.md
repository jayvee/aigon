# Feature: conductor-menubar

## Summary

A macOS menubar app that shows live agent status across all watched repos and lets you **jump directly into running terminals** with one click. Always visible: a count of running/waiting agents. Click to expand a menu showing every feature and agent state. Click an agent to open or focus its terminal session — no hunting through tabs or windows. Built on the same log front matter data source as the conductor-daemon. Terminal-agnostic: works with Warp, VS Code integrated terminal, or macOS Terminal.app.

This merges the original conductor-menubar (status visibility) and vscode-warp-jump (terminal navigation) concepts into a single, IDE-independent access point.

## User Stories

- [ ] As a developer, I want to glance at my menubar and know how many agents are running or waiting for my input
- [ ] As a developer, I want to click an agent in the menubar menu and be taken directly to its terminal session, without hunting through tabs or switching apps
- [ ] As a developer managing features across multiple repos, I want one menubar icon covering all my projects
- [ ] As a developer who uses different terminals for different agents (e.g. Warp for Claude, VS Code for Cursor), I want the menubar to open the right terminal for each agent
- [ ] As a developer, if an agent's terminal was closed, I want the click to re-open a fresh terminal in the correct worktree directory

## Acceptance Criteria

### Menubar display
- [ ] Menubar title shows summary: `⚙ 3 running` or `⚙ 1 waiting` or `⚙ –` (nothing active)
- [ ] Priority: show waiting count if any agents are waiting, otherwise show running count
- [ ] Expanded menu shows one section per repo, features grouped under each
- [ ] Each agent line shows status indicator: `○` implementing, `●` waiting, `✓` submitted

### Click-to-open terminal
- [ ] Clicking an agent item opens or focuses its terminal session
- [ ] For Warp: activates Warp + opens worktree via `warp://launch/` URI (reuses existing `openSingleWorktree()` logic)
- [ ] For VS Code: runs `code <worktree-path>` to open/focus the workspace
- [ ] For Terminal.app: opens a new Terminal window at the worktree path via AppleScript
- [ ] Terminal preference is read from agent config (`terminalApp` field) with user-level override in `~/.aigon/config.json`
- [ ] If no worktree exists (solo branch mode), opens terminal at repo root
- [ ] Alt-click (⌥-click) copies the slash command to clipboard instead of opening terminal (e.g. `/afd 30`)

### Installation & lifecycle
- [ ] `aigon conductor menubar-install` generates and installs the plugin
- [ ] Works with both xbar and SwiftBar (detects which is installed)
- [ ] `aigon conductor menubar-uninstall` removes the plugin
- [ ] Plugin reads `~/.aigon/config.json` for watched repos list
- [ ] Plugin refreshes every 30 seconds

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Plugin format (xbar/SwiftBar)

Both xbar and SwiftBar execute a script and render stdout as a menu. The script outputs:

```
⚙ 1 waiting
---
~/src/aigon
#30 board-action-hub
-- ● cc: waiting | bash="/usr/local/bin/node /path/to/aigon-cli.js terminal-focus 30 cc" terminal=false
-- ○ gg: implementing | bash="/usr/local/bin/node /path/to/aigon-cli.js terminal-focus 30 gg" terminal=false
-- ✓ cx: submitted | bash="/usr/local/bin/node /path/to/aigon-cli.js terminal-focus 30 cx" terminal=false
---
~/src/my-web-app
#12 dark-mode
-- ● solo: waiting | bash="/usr/local/bin/node /path/to/aigon-cli.js terminal-focus 12" terminal=false
```

With alternate action (⌥-click):
```
-- ● cc: waiting | alternate=true bash="echo '/afd 30' | pbcopy" terminal=false
```

### New CLI command: `aigon terminal-focus <featureId> [agent]`

Lightweight command that:
1. Finds the worktree for the feature + agent via existing `findWorktrees()` + `filterByFeatureId()`
2. Determines the terminal app (agent config → user config → default)
3. Opens/focuses the terminal using existing `openSingleWorktree()` infrastructure
4. Does NOT auto-start the agent CLI (session may already be running, or user wants to run a different command)

Terminal resolution order:
1. `~/.aigon/config.json` → `terminalApp` (user override, e.g. `"terminalApp": "warp"`)
2. Agent config's `terminalApp` field
3. Default: `"warp"` (current behavior)

For Terminal.app support (new), add a case to `openSingleWorktree()`:
```javascript
} else if (terminal === 'terminal') {
    execSync(`open -a Terminal "${wt.path}"`);
}
```

### Install locations

- xbar: `~/Library/Application Support/xbar/plugins/aigon.30s.sh` (`.30s.` = 30 second refresh)
- SwiftBar: `~/.swiftbar/aigon.30s.sh`

### Detection

`aigon conductor menubar-install` checks for xbar or SwiftBar app bundles in `/Applications/`. If neither found, prints install instructions for SwiftBar (recommended).

### Plugin script

The installed plugin is a shell script that invokes `aigon conductor menubar-render`. This command:
1. Reads `~/.aigon/config.json` for repos list
2. For each repo, globs `docs/specs/features/03-in-progress/` for feature dirs
3. Reads log front matter from each feature's log files
4. Outputs xbar/SwiftBar-formatted menu lines with `bash=` actions pointing to `aigon terminal-focus`

## Dependencies

- Feature: log-status-tracking (required — reads log front matter)
- Feature: conductor-daemon (optional — daemon provides notifications; menubar is independent but shares data)
- External: xbar or SwiftBar installed by user (SwiftBar recommended)
- Existing infrastructure: `findWorktrees()`, `filterByFeatureId()`, `openSingleWorktree()`

## Out of Scope

- Building a native macOS app (keep it simple with xbar/SwiftBar)
- Windows/Linux menubar support
- Sending commands to existing terminal sessions (terminal API limitations)
- Auto-starting agent CLI sessions (user controls this)
- VS Code extension changes (this is intentionally IDE-independent)

## Open Questions

- Should we default to SwiftBar over xbar? SwiftBar is more actively maintained and supports `alternate=true` for ⌥-click actions.
- Should the menubar show a "Start daemon" option if conductor-daemon isn't running?

## Supersedes

This feature replaces and merges:
- `feature-conductor-menubar.md` (original — status display only, copy-to-clipboard)
- `feature-vscode-warp-jump.md` (original — VS Code sidebar → Warp terminal jump)

The merged feature provides both capabilities (status + terminal jump) in a single, IDE-independent menubar interface.

## Related

- Feature: conductor-daemon (shares data source, provides notifications)
- Feature: conductor-web-dashboard (richer UI alternative)
- Feature: conductor-vscode (#33, done — VS Code sidebar status view)
- Existing code: `openSingleWorktree()` (aigon-cli.js), `findWorktrees()`, `filterByFeatureId()`
