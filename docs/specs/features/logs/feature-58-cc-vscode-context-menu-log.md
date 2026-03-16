---
status: submitted
updated: 2026-03-16T00:33:03.601Z
feature: 58
agent: cc
events:
  - { ts: "2026-03-16T00:33:03.601Z", status: submitted }
---

# Feature 58: vscode-context-menu — Implementation Log

## Plan

Two files needed changes in `vscode-extension/`:

1. **`extension.js`** — expose `featureId` and `repoPath` on each feature tree item, set a stage-aware `contextValue`, update `getChildren` to handle the new contextValue, and register three new commands
2. **`package.json`** — declare the three commands and add a `view/item/context` menu section

The key design decision was whether to use a single `contextValue = 'feature'` for all features (matching the spec's technical approach literally) or to use two contextValues (`feature` vs `feature-in-progress`) to drive stage-sensitive menu visibility natively via VS Code's `when` clause. The two-contextValue approach was chosen because it satisfies the acceptance criteria exactly without requiring runtime stage checks in command handlers.

## Progress

### `vscode-extension/extension.js`

- **`getChildren`** (line 118): Updated to return `agentItems` for both `feature` and `feature-in-progress` contextValues, so expanding tree items works regardless of stage.
- **`_getFeatureItems`** (lines 273–275):
  - `featureItem.contextValue` now set to `'feature-in-progress'` when `data.stage === 'in-progress' || data.stage === 'in-evaluation'`, otherwise `'feature'`
  - `featureItem.featureId = featureId` — passes the feature ID to command handlers
  - `featureItem.repoPath = repoPath` — passes the repo working directory to command handlers so terminals open in the right location
- **`activate()`** (lines 369–387): Three new commands registered:
  - `aigon.shipFeature` → opens terminal "Aigon: Ship", runs `aigon feature-ship <ID>`
  - `aigon.featureDone` → opens terminal "Aigon: Feature Done", runs `aigon feature-close <ID>`
  - `aigon.implementRalph` → opens terminal "Aigon: Implement", runs `aigon feature-do <ID> --ralph --auto-submit`
  - All three added to `context.subscriptions`

### `vscode-extension/package.json`

- Three command declarations added to `contributes.commands`
- `view/item/context` menu section added with:
  - "Ship (Ralph + Deploy)": `when: view == aigonConductor && (viewItem == feature || viewItem == feature-in-progress)` — shows for all stages
  - "Feature Done": `when: view == aigonConductor && viewItem == feature-in-progress` — in-progress only
  - "Implement (Ralph)": `when: view == aigonConductor && viewItem == feature-in-progress` — in-progress only

### `.vsix` built and installed

- `npm install` run to get `@vscode/vsce` devDependency
- `npm run package` produced `aigon-conductor-1.0.0.vsix`
- `code --install-extension` used to install into VS Code

## Decisions

**Stage-specific contextValues over single `'feature'`**
The spec's technical approach used `viewItem == feature` for all three `when` clauses, which would show "Feature Done" and "Implement (Ralph)" on inbox/backlog features too. Using `feature-in-progress` as a distinct contextValue lets VS Code's built-in `when` clause system handle the filtering without any code in the command handler. This matches the acceptance criteria ("appears for features in X stage") more faithfully.

**`in-evaluation` included in `feature-in-progress`**
The existing code already treats `in-evaluation` alongside `in-progress` in its filter (`data.stage !== 'in-progress' && data.stage !== 'in-evaluation'`). Applied the same logic to contextValue assignment for consistency.

**Bash CWD issue during implementation**
The Bash tool became unable to use the worktree path as CWD mid-session (shell reported the directory as non-existent). File edits were applied using the Edit tool with absolute paths instead. The issue resolved by the next conversation turn and the build/install commands ran successfully.
