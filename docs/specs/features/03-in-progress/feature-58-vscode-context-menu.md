# Feature: vscode-context-menu

## Summary

Add right-click context menus to the Aigon VS Code extension sidebar that are driven by the same unified state machine used by the dashboard. Instead of hardcoding menu items, the extension consumes `validActions` from the radar API and renders context-appropriate actions for features, research, and feedback items.

## User Stories

- [ ] As a developer, I want to right-click a feature in the Aigon sidebar and see only the actions that are valid for its current state — the same actions the dashboard would show
- [ ] As a developer, I want high-priority actions (e.g. "Focus cc" when an agent is waiting) to appear at the top of the context menu
- [ ] As a developer, I want to trigger actions like Open, Attach, Focus, Stop, Evaluate, Close directly from VS Code without switching to the dashboard or typing CLI commands

## Acceptance Criteria

- [ ] Right-clicking a feature/research/feedback tree item shows a context menu with actions computed by the state machine
- [ ] Actions match exactly what the dashboard shows for the same item — both consume `validActions` from the radar API
- [ ] Per-agent actions (Open, Attach, Focus, Stop) appear as separate menu items with the agent ID in the label
- [ ] High-priority actions appear in a top group; destructive actions (Stop) appear in a bottom group
- [ ] Actions that require input (e.g. `feature-setup` needs an agent picker) show a VS Code quick pick before executing
- [ ] Terminal-mode actions open a named VS Code integrated terminal (e.g. "Aigon: Focus cc") in the correct working directory
- [ ] Fire-and-forget actions execute silently via the radar API
- [ ] Agent-mode actions (eval, review, synthesize) open a terminal and run the corresponding slash command
- [ ] `vsce package` produces a valid `.vsix` with no errors
- [ ] No action logic is duplicated — the extension does not re-implement guard conditions or state transitions

## Validation

```bash
# Context menu entries registered
node -e "const p = require('./vscode-extension/package.json'); const m = p.contributes.menus['view/item/context']; if (!m || m.length === 0) throw new Error('No context menu items'); console.log('OK:', m.length, 'items')"
```

Manual validation: right-click a feature in each stage and confirm the menu matches the dashboard's action buttons for that feature.

## Technical Approach

### Core idea: dynamic menus from `validActions`

The radar API already returns `validActions` per entity (feature, research, feedback) — the same array the dashboard uses to render buttons. The extension already fetches this data every 10 seconds via `/api/status`. The work is to:

1. Store `validActions` on each tree item
2. Register a generic `aigon.executeAction` command
3. Use VS Code's `when` clause system to show/hide menu items by `contextValue`
4. Dispatch actions to the radar API the same way the dashboard does

### Changes

**`package.json`** — register commands and context menu entries:

```jsonc
"commands": [
  // One command per action type (VS Code menus need static command IDs)
  { "command": "aigon.action.open",      "title": "Open Agent" },
  { "command": "aigon.action.attach",    "title": "Attach Agent" },
  { "command": "aigon.action.focus",     "title": "Focus Agent" },
  { "command": "aigon.action.stop",      "title": "Stop Agent" },
  { "command": "aigon.action.eval",      "title": "Run Evaluation" },
  { "command": "aigon.action.review",    "title": "Run Review" },
  { "command": "aigon.action.close",     "title": "Accept & Close" },
  { "command": "aigon.action.setup",     "title": "Start Feature" },
  { "command": "aigon.action.prioritise","title": "Prioritise" }
],
"menus": {
  "view/item/context": [
    // High-priority group
    { "command": "aigon.action.focus",     "when": "view == aigonConductor && viewItem =~ /action:feature-focus/",     "group": "aigon-high@1" },
    { "command": "aigon.action.eval",      "when": "view == aigonConductor && viewItem =~ /action:feature-eval/",      "group": "aigon-high@2" },
    { "command": "aigon.action.close",     "when": "view == aigonConductor && viewItem =~ /action:feature-close/",     "group": "aigon-high@3" },
    // Normal group
    { "command": "aigon.action.open",      "when": "view == aigonConductor && viewItem =~ /action:feature-open/",      "group": "aigon-normal@1" },
    { "command": "aigon.action.attach",    "when": "view == aigonConductor && viewItem =~ /action:feature-attach/",    "group": "aigon-normal@2" },
    { "command": "aigon.action.review",    "when": "view == aigonConductor && viewItem =~ /action:feature-review/",    "group": "aigon-normal@3" },
    { "command": "aigon.action.setup",     "when": "view == aigonConductor && viewItem =~ /action:feature-setup/",     "group": "aigon-normal@4" },
    { "command": "aigon.action.prioritise","when": "view == aigonConductor && viewItem =~ /action:feature-prioritise/","group": "aigon-normal@5" },
    // Danger group
    { "command": "aigon.action.stop",      "when": "view == aigonConductor && viewItem =~ /action:feature-stop/",      "group": "aigon-danger@1" }
  ]
}
```

**`extension.js`** — key changes:

1. **Encode valid actions into `contextValue`**: When building tree items, set `contextValue` to a string that encodes available actions, e.g. `"feature action:feature-focus action:feature-stop"`. VS Code's `when` clause regex matching (`=~`) controls which menu items appear.

```js
// In _getFeatureItems(), after building featureItem:
const actionTags = (feature.validActions || [])
    .map(a => `action:${a.action}`)
    .join(' ');
featureItem.contextValue = `feature ${actionTags}`;
```

2. **Store action metadata on tree items**: Attach `validActions`, `featureId`, `repoPath`, and `entityType` as properties on each tree item so the command handler can access them.

```js
featureItem.validActions = feature.validActions;
featureItem.featureId = feature.id;
featureItem.repoPath = repoPath;
featureItem.entityType = 'feature';
```

3. **Register a shared action dispatcher**: Each command ID maps to an action name. The handler looks up the matching `validAction` entry and dispatches accordingly.

```js
function registerActionCommand(context, actionName) {
    context.subscriptions.push(
        vscode.commands.registerCommand(`aigon.action.${actionName}`, async (item) => {
            const va = (item.validActions || []).find(a => a.action.endsWith(actionName) || a.action === `feature-${actionName}`);
            if (!va) return;
            await dispatchAction(va, item);
        })
    );
}

async function dispatchAction(va, item) {
    if (va.requiresInput === 'agentPicker') {
        // Show VS Code quick pick for agent selection
        const agents = ['cc', 'cu', 'cx', 'gg'];
        const picked = await vscode.window.showQuickPick(agents, {
            canPickMany: true,
            placeHolder: 'Select agents'
        });
        if (!picked) return;
        // POST to radar API with selected agents
    }

    if (va.mode === 'terminal') {
        const name = `Aigon: ${va.label}`;
        const terminal = vscode.window.createTerminal({ name, cwd: item.repoPath });
        terminal.show();
        terminal.sendText(buildCliCommand(va, item));
    } else if (va.mode === 'fire-and-forget') {
        // POST to radar /api/session/run or /api/action
        await fetch(`http://127.0.0.1:${port}/api/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: va.action, args: buildArgs(va, item), repoPath: item.repoPath })
        });
    } else if (va.mode === 'agent') {
        const terminal = vscode.window.createTerminal({ name: `Aigon: ${va.label}`, cwd: item.repoPath });
        terminal.show();
        terminal.sendText(buildCliCommand(va, item));
    }
}
```

4. **Per-agent actions**: For actions with `agentId` (Open cc, Focus gg, etc.), the per-agent entries in `validActions` already carry the `agentId` and resolved `label`. The context menu will show one entry per qualifying agent. To handle this with VS Code's static menu system, per-agent actions use the **agent-level tree items** (which already have `contextValue` of `'agent'` or `'agent-waiting'`). Encode the valid action on the agent tree item's `contextValue` as well.

### What the extension does NOT do

- Does not import or run `state-machine.js` — it consumes pre-computed `validActions` from the radar API
- Does not duplicate guard logic — if the state machine changes, the menus update automatically
- Does not hardcode which actions appear in which stage

## Per-agent context menus

Per-agent actions (open, attach, focus, stop) should appear on **agent-level tree items**, not feature-level items. This avoids ambiguity when a feature has multiple agents.

The agent tree item already carries the agent's status. To make this work:

1. When building agent tree items, find the matching per-agent `validActions` entries and encode them in `contextValue`
2. Register the same action commands for agent items
3. The `when` clause regex matches both feature-level and agent-level `contextValue` strings

## Dependencies

- Radar API must be running (already required for the extension to work at all)
- `validActions` already returned by `/api/status` — no API changes needed
- State machine (`lib/state-machine.js`) — no changes needed

## Out of Scope

- Feedback context menus (add later — feedback items don't appear in the tree yet)
- Drag-and-drop in VS Code (VS Code tree drag-drop API is separate from context menus)
- Inline toolbar icons on tree items (future enhancement)
- Running the state machine client-side in the extension

## Open Questions

- Should per-agent actions appear on the feature item (with a secondary quick pick to choose the agent) or on the agent sub-item directly? **Recommendation**: agent sub-items, since the tree already shows them and it avoids an extra picker step.
- VS Code's static menu system requires pre-registered command IDs. If new actions are added to the state machine in the future, the extension needs a matching command registered. Should we add a catch-all "Run Action..." command that shows a quick pick of all valid actions as a fallback?

## Related

- State machine: `lib/state-machine.js`
- Radar API status endpoint: `lib/utils.js` `collectDashboardStatusData()`
- Dashboard action rendering: `templates/dashboard/index.html` `buildValidActionsHtml()`
- Extension: `vscode-extension/extension.js`, `vscode-extension/package.json`
