# Feature: vscode-context-menu

## Summary

Add right-click context menu items to the Aigon VS Code extension sidebar tree, so users can trigger `aigon feature-ship`, `aigon feature-close`, and `aigon feature-do --ralph --auto-submit` directly from the feature list without typing commands.

## User Stories

- [ ] As a developer, I want to right-click a feature in the Aigon sidebar and choose "Ship (Ralph + Deploy)" to kick off the full autonomous pipeline without opening a terminal manually
- [ ] As a developer, I want context-sensitive menu items — inbox/backlog features show "Ship", in-progress features show "Feature Done"

## Acceptance Criteria

- [ ] Right-clicking a feature with `contextValue === 'feature'` shows a context menu in the VS Code sidebar
- [ ] Menu item "Ship (Ralph + Deploy)" appears for features in `01-inbox`, `02-backlog`, or `03-in-progress` stage — runs `aigon feature-ship <ID>` in a new VS Code integrated terminal named "Aigon: Ship"
- [ ] Menu item "Feature Done" appears for features in `03-in-progress` stage — runs `aigon feature-close <ID>` in a new integrated terminal
- [ ] Menu item "Implement (Ralph)" appears for features in `03-in-progress` stage — runs `aigon feature-do <ID> --ralph --auto-submit` in a new integrated terminal
- [ ] Each menu item opens the terminal in the correct working directory (the repo root for that feature, already available as `repoPath` on the tree item)
- [ ] The extension `package.json` `contributes.menus` includes a `"view/item/context"` entry for `view == aigonConductor && viewItem == feature`
- [ ] Running `vsce package` (or equivalent) produces a valid `.vsix` with no errors

## Validation

```bash
node -e "const p = require('./vscode-extension/package.json'); const m = p.contributes.menus['view/item/context']; if (!m || m.length === 0) throw new Error('No context menu items'); console.log('OK:', m.length, 'items')"
```

## Technical Approach

Two files change in `vscode-extension/`:

**`package.json`** — add commands and menu entries:
```json
"commands": [
  { "command": "aigon.shipFeature", "title": "Ship (Ralph + Deploy)" },
  { "command": "aigon.featureDone", "title": "Feature Done" },
  { "command": "aigon.implementRalph", "title": "Implement (Ralph)" }
],
"menus": {
  "view/item/context": [
    { "command": "aigon.shipFeature", "when": "view == aigonConductor && viewItem == feature", "group": "aigon@1" },
    { "command": "aigon.featureDone", "when": "view == aigonConductor && viewItem == feature", "group": "aigon@2" },
    { "command": "aigon.implementRalph", "when": "view == aigonConductor && viewItem == feature", "group": "aigon@3" }
  ]
}
```

**`extension.js`** — register the three commands, each using `vscode.window.createTerminal`:
```js
vscode.commands.registerCommand('aigon.shipFeature', (item) => {
    const terminal = vscode.window.createTerminal({ name: 'Aigon: Ship', cwd: item.repoPath });
    terminal.show();
    terminal.sendText(`aigon feature-ship ${item.featureId}`);
});
```

The `item` passed to context menu commands is the `TreeItem` that was right-clicked. The `featureId` and `repoPath` properties need to be set on `featureItem` when it's constructed in `_getFeatureItems()` (they may already exist — check the tree item construction at line ~181).

After changes, rebuild the `.vsix`:
```bash
cd vscode-extension && npx vsce package
```
Then reinstall: `aigon vscode-install` (or equivalent).

## Dependencies

- Feature A (feature-ship-command) — must be merged first so `aigon feature-ship` exists
- Existing extension: `vscode-extension/extension.js`, `vscode-extension/package.json`
- `featureId` and `repoPath` on tree items (verify these are set at line ~181 of extension.js)

## Out of Scope

- Context menu on agent-level items (waiting/submitted agents)
- Inline toolbar buttons (title bar icons) — context menu only
- Arena mode ship

## Open Questions

- Does the `featureItem` at line ~181 already expose `featureId` and `repoPath` as properties, or do they need to be added?

## Related

- Feature A: feature-ship-command (must land first)
- Existing: `vscode-extension/extension.js`
