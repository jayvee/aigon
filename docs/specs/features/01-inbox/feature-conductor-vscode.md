# Feature: conductor-vscode

## Summary

A VS Code extension that shows live Aigon feature status across all registered repos in a sidebar tree view. Reads `~/.aigon/config.json` for the repos list and log file front matter for agent status — the same data sources as conductor-daemon and conductor-web-dashboard. Renders repo → feature (with pipeline stage) → per-agent status rows, updates live via `FileSystemWatcher`, and copies slash commands to clipboard on click. No polling, no daemon required.

## User Stories

- [ ] As a developer who lives in VS Code, I want to see all my in-progress Aigon features and agent states in a sidebar panel without switching to a terminal or browser
- [ ] As a developer, I want the sidebar to update automatically when an agent's status changes — no manual refresh
- [ ] As a developer, I want to click a waiting agent in the sidebar and have the slash command copied to my clipboard ready to paste into a terminal or agent session
- [ ] As a developer, I want to install the extension with a single Aigon CLI command

## Acceptance Criteria

- [ ] A VS Code sidebar panel titled "Aigon" shows a tree: repos → features (by stage) → agents with status
- [ ] Reads `~/.aigon/config.json` `repos` array to know which repos to watch
- [ ] Reads log file front matter (`status`, `updated`) from each repo's `docs/specs/features/logs/`
- [ ] Feature stage (Inbox, Backlog, In Progress, In Evaluation, Done) is derived from which folder the spec lives in
- [ ] Status icons: `○` implementing (grey), `●` waiting (amber), `✓` submitted (green), `–` unknown
- [ ] Clicking a `waiting` agent row copies the appropriate slash command (e.g. `/afd 30`) to the clipboard
- [ ] Tree updates live via `FileSystemWatcher` — no polling, no manual refresh needed
- [ ] Only in-progress features shown by default; a toggle shows all stages
- [ ] `aigon conductor vscode-install` installs the extension (marketplace or bundled `.vsix`)
- [ ] `aigon conductor vscode-uninstall` removes it
- [ ] The extension has zero runtime dependencies beyond the VS Code API and Node.js built-ins
- [ ] Works correctly when conductor-daemon is not running (reads log files directly)

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Extension structure

A standard VS Code extension package (`package.json` + `extension.js`) published to the VS Code Marketplace as `aigon.conductor-vscode`. The `vscode-install` subcommand runs:

```bash
code --install-extension aigon.conductor-vscode
```

For local development, installs from a `.vsix` bundle. Falls back with instructions if the `code` CLI is not in PATH.

### Tree view

Implemented as a `vscode.TreeDataProvider`. Three node levels:

1. **Repo** — basename of the path (e.g. `aigon`, `my-web-app`)
2. **Feature** — `#ID name` with stage label; only `03-in-progress` and `04-in-evaluation` shown by default
3. **Agent** — `cc ● waiting 11:23` with status icon; `solo` for solo-mode features

### Data reading

On activation and on each `FileSystemWatcher` event:

1. Read `~/.aigon/config.json` → `repos` array
2. For each repo, glob `docs/specs/features/logs/feature-*-log.md` (excluding `selected/` and `alternatives/` subdirs)
3. Parse front matter with a simple regex (no YAML library needed)
4. Glob `docs/specs/features/03-in-progress/` and `04-in-evaluation/` for spec filenames to determine feature names and IDs

### File watching

```js
vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(repoPath, 'docs/specs/features/logs/**/*-log.md')
)
```

One watcher per registered repo. Also watches `~/.aigon/config.json` so adding/removing repos via `aigon conductor add/remove` is reflected immediately without restarting VS Code.

### Slash command on click

Each `waiting` agent tree item calls `vscode.env.clipboard.writeText('/afd <ID>')` on click and shows a brief status bar message: `Copied: /afd 30`.

## Dependencies

- Feature: log-status-tracking (required — extension reads log front matter)
- Feature: conductor-daemon (optional — daemon populates the same data; extension is independent)

## Out of Scope

- Writing or committing status from the extension (read-only view)
- Running slash commands directly in a VS Code terminal (clipboard copy only for now)
- Publishing to the Open VSX registry (JetBrains / other IDEs)
- Authentication or remote/SSH workspace support

## Open Questions

- Should the extension be bundled inside the `aigon` npm package and installed as a `.vsix`, or published separately to the VS Code Marketplace? Marketplace is cleaner for users but requires a separate publish step.
- Should clicking a waiting item also focus or open the relevant terminal tab if one exists?

## Related

- Feature: log-status-tracking (prerequisite — status contract)
- Feature: conductor-daemon (shares repo registry and data source)
- Feature: conductor-menubar (lightweight always-visible alternative)
- Feature: conductor-web-dashboard (browser-based alternative)
