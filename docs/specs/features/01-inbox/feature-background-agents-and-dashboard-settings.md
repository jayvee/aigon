# Feature: background-agents-and-dashboard-settings

## Summary

Add a `--background` flag to `feature-start` and `research-start` that creates tmux sessions without opening terminal windows. Add a `backgroundAgents` setting (global and per-repo) that makes background the default. Expose all aigon settings in the dashboard Settings tab — both global (`~/.aigon/config.json`) and project (`.aigon/config.json`) — with the ability to edit them from the dashboard UI.

## Acceptance Criteria

### Background Agents
- [ ] `aigon feature-start 42 cc cx --background` creates worktrees and tmux sessions but does NOT open terminal windows
- [ ] `aigon research-start 17 cc cx gg --background` same for research
- [ ] Dashboard shows running agents with "View" button to open a terminal window on demand
- [ ] Dashboard "View" button opens iTerm2/terminal attached to the existing tmux session
- [ ] `backgroundAgents` setting in `.aigon/config.json` makes `--background` the default
- [ ] `--foreground` flag overrides the setting when you want terminal windows
- [ ] Setting works at both global (`~/.aigon/config.json`) and project (`.aigon/config.json`) levels
- [ ] Project setting overrides global setting

### Dashboard Settings UI
- [ ] Settings tab shows all global settings from `~/.aigon/config.json`
- [ ] Settings tab shows all project settings from `.aigon/config.json` (per repo)
- [ ] Clear visual separation between global and project settings
- [ ] Settings are editable: toggle booleans, edit strings, select from enums
- [ ] Changes are saved immediately to the appropriate config file
- [ ] `backgroundAgents` toggle is prominent (likely the most-used setting)
- [ ] Settings tab shows which values are inherited (global default) vs overridden (project)
- [ ] Read-only display of computed/effective config (merged global + project)
- [ ] Dashboard restarts are not required after settings changes

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/config.js
node -c lib/dashboard-server.js
```

## Technical Approach

### Background Flag

1. In `feature-start` (`lib/commands/feature.js`): after creating worktrees and tmux sessions, check `--background` flag or `getEffectiveConfig().backgroundAgents`. If true, skip the `openTerminalAppWithCommand` calls.

2. Same in `research-start` (`lib/commands/research.js`): skip `openTerminalAppWithCommand` for each agent.

3. Add to config schema in `lib/config.js`:
   ```json
   { "backgroundAgents": false }
   ```

4. CLI flag precedence: `--background` > `--foreground` > config setting > default (false)

### Dashboard Settings Tab

1. Add `/api/settings` endpoint to `lib/dashboard-server.js`:
   - `GET /api/settings` → returns `{ global: {...}, project: {...}, effective: {...} }`
   - `PUT /api/settings` → body: `{ scope: "global"|"project", key: "backgroundAgents", value: true }`
   - Writes to the appropriate config file via `lib/config.js`

2. Dashboard Settings tab (`templates/dashboard/js/settings.js`):
   - Two-column layout: Global | Project
   - Each setting shows: key, current value, source (global/project/default)
   - Toggle switches for booleans
   - Text inputs for strings
   - Dropdown for enums (terminal type, profile, etc.)
   - Save button or auto-save on change

3. Known settings to expose:
   - `backgroundAgents` (boolean) — run agents without opening terminals
   - `terminal` (enum: warp/tmux/code/cursor) — terminal preference
   - `profile` (enum: web/api/ios/android/library/generic) — project profile
   - `security.enabled` (boolean) — security scanning
   - `security.mode` (enum: enforce/warn/off) — scanning mode
   - `devServer.enabled` (boolean) — dev server auto-start
   - Agent model overrides (`agents.cc.implement.model`, etc.)

### Dashboard "View" Button

Already exists via `feature-open` / `research-open` actions in the state machine. When agents are running in background, the "View" button calls `requestFeatureOpen` which opens a terminal window attached to the existing tmux session. No change needed — this already works.

## Dependencies

- None. Uses existing config system and dashboard infrastructure.

## Out of Scope

- Per-agent background setting (e.g., cc in foreground, cx in background) — keep it simple
- Terminal multiplexer UI in the dashboard (viewing tmux output in the browser)
- Config file validation/schema enforcement
- Config migration between versions

## Related

- Feature #117: rename-setup-to-start (touches same `feature-start` code)
- Dashboard Settings tab already exists but is minimal
