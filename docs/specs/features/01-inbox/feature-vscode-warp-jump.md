# Feature: vscode-warp-jump

## Summary

Add a "Jump to Warp" action to the Aigon VS Code extension tree view. When a feature is in-progress (especially status `waiting`), clicking an icon or right-click menu item brings the user to the Warp terminal where that agent is running. This closes the gap between "I see a feature needs attention" in VS Code and "I'm in the terminal working on it" in Warp.

## User Stories

- [ ] As a developer, when I see a feature with status "waiting" in the VS Code sidebar, I want to click an icon and be taken to the Warp tab where that agent session is running, so I can quickly provide input without hunting through terminal tabs
- [ ] As a developer managing multiple arena features, I want to jump to any agent's terminal from the VS Code tree view, so I can switch between features efficiently
- [ ] As a developer, if the Warp tab for a feature has been closed, I want the jump action to re-open it in the correct worktree directory, so I can resume work

## Acceptance Criteria

- [ ] Agent items in the VS Code tree view show an inline "open in terminal" icon button
- [ ] Right-click context menu on agent items includes "Open in Warp"
- [ ] Clicking the action brings Warp to the foreground via AppleScript `activate`
- [ ] If no Warp tab exists for the feature, a new tab is opened using the existing `warp://launch/` mechanism with the worktree directory pre-configured
- [ ] The action works for both solo worktree and arena mode features
- [ ] Features without worktrees (solo branch mode) open a new Warp tab at the repo root
- [ ] Multi-agent features (arena) let you jump to a specific agent's tab since agent items are already separate in the tree

## Validation

```bash
node --check aigon-cli.js
cd vscode-extension && npm run compile 2>/dev/null || true
```

## Technical Approach

### Warp limitations (confirmed via testing)

- `tell application "Warp" to activate` works — brings Warp to foreground
- `tell application "Warp" to close (first window whose name contains "...")` works — existing `closeWarpWindow()`
- **Cannot** enumerate tabs, focus a specific tab, or detect if a tab is open
- **Cannot** send keystrokes or commands to existing tabs
- Warp reports 0 windows via System Events — non-standard windowing

### Strategy: Activate + Re-open

Since we can't focus a specific existing tab, the approach is:

1. **Bring Warp to foreground** — AppleScript `tell application "Warp" to activate`
2. **Open/re-open the worktree tab** — use `warp://launch/{configName}` URI scheme (same as `openSingleWorktree()`)
3. **Warp deduplicates launch configs** — if a tab with the same launch config is already open, Warp handles this (opens new if not found)

This gives a reliable "take me there" experience. The user may get a new tab if the old one was closed, which is the correct fallback.

### Implementation

#### 1. New CLI command: `aigon warp-focus <featureId> [agent]`

Lightweight command in `aigon-cli.js`:
- Find worktree for feature + agent via `findWorktrees()` + `filterByFeatureId()`
- Bring Warp to foreground via AppleScript
- Open worktree tab via existing `openSingleWorktree()` using `warp://launch/` URI
- If no worktree exists, open Warp at repo root with the feature's branch checked out
- Does NOT auto-start the agent CLI (user may want to resume an existing session or run a different command)

#### 2. VS Code extension changes (`extension.js`)

**Tree item data enrichment:**
- Agent tree items already have `featureId`, `agent`, and repo path
- Add `contextValue` variants: `agent-waiting-worktree`, `agent-implementing-worktree` for worktree features

**New command: `aigon.jumpToWarp`**
```javascript
vscode.commands.registerCommand('aigon.jumpToWarp', (element) => {
    const { featureId, agent, repoPath } = element;
    execSync(`cd "${repoPath}" && aigon warp-focus ${featureId} ${agent}`);
});
```

**Inline icon button** — show a terminal icon on agent items (especially `waiting` status):
```json
{
    "command": "aigon.jumpToWarp",
    "when": "view == aigonConductor && viewItem =~ /agent-.*/",
    "group": "inline"
}
```

**Context menu** — right-click "Open in Warp" on any agent item.

#### 3. package.json contributions

```json
{
    "commands": [{
        "command": "aigon.jumpToWarp",
        "title": "Open in Warp",
        "icon": "$(terminal)"
    }],
    "menus": {
        "view/item/context": [{
            "command": "aigon.jumpToWarp",
            "when": "view == aigonConductor && viewItem =~ /agent-.*/",
            "group": "inline@1"
        }, {
            "command": "aigon.jumpToWarp",
            "when": "view == aigonConductor && viewItem =~ /agent-.*/",
            "group": "navigation"
        }]
    }
}
```

### Tab naming convention

Reuse existing Warp tab title pattern from `openSingleWorktree()`:
- `Feature #35 - Claude` (solo worktree)
- `Feature #35 - Cursor` (arena)

This is important because `closeWarpWindow()` already uses title matching — consistent naming means we can close stale tabs before opening fresh ones.

## Dependencies

- Warp terminal (macOS only — this is a macOS-specific feature)
- Existing `openSingleWorktree()` and `findWorktrees()` infrastructure in aigon-cli.js
- VS Code extension already has tree view with agent status

## Out of Scope

- Cross-platform terminal support (iTerm, Windows Terminal, etc.) — Warp-only for now
- Sending commands to existing Warp sessions (Warp API limitation)
- Detecting whether a tab is already open (Warp API limitation)
- Auto-resuming agent sessions (user handles this with `agent --resume`)

## Open Questions

- Should the action also work on feature-level items (not just agent items)? If so, which agent to target for multi-agent features?
- Should we close the old tab before opening a new one (via `closeWarpWindow()`) to avoid tab accumulation?
- Should non-worktree features (solo branch mode) have this action, or only worktree features?

## Related

- Existing code: `openSingleWorktree()` (aigon-cli.js:1395), `closeWarpWindow()` (aigon-cli.js:1380)
- Existing code: VS Code extension tree view (`vscode-extension/extension.js`)
- Feature: agent-cost-awareness (complementary — cost warnings + terminal jump = full feature management from VS Code)
