# Feature: background-agents-and-dashboard-settings

## Summary

Three parts: (1) Add `--background` flag so agents run without popping up terminal windows. (2) Auto-detect agent completion so we stop relying on agents to explicitly signal "submitted". (3) Expose all aigon settings in the dashboard Settings tab.

The completion detection is the most important part. Currently agents finish their work, commit code, their session ends — but they often don't run `aigon agent-status submitted`. The dashboard shows them as "Running" or "Session ended" with no next action. Instead of relying on agents to signal, **detect completion from evidence**: worktree has implementation commits + tmux session is dead = agent is done.

## Acceptance Criteria

### Auto-detect Agent Completion (critical)
- [ ] Dashboard polling detects: agent status is `implementing` + tmux session dead + worktree has commits beyond setup → auto-transition to `submitted`
- [ ] Also detect: no agent status file at all + tmux session dead + worktree has implementation commits → create status file as `submitted`
- [ ] Auto-detection runs during normal dashboard status polling (no extra overhead)
- [ ] When auto-detected, dashboard shows "Submitted (auto-detected)" to distinguish from explicit submission
- [ ] `aigon doctor` also detects and fixes stale implementing statuses
- [ ] Works for both features and research

### Background Agents
- [ ] `aigon feature-start 42 cc cx --background` creates worktrees and tmux sessions but does NOT open terminal windows
- [ ] `aigon research-start 17 cc cx gg --background` same for research
- [ ] Dashboard shows running agents with "View" button to open a terminal window on demand
- [ ] Dashboard "View" button opens iTerm2/terminal attached to the existing tmux session
- [ ] `backgroundAgents` setting in `.aigon/config.json` makes `--background` the default
- [ ] `--foreground` flag overrides the setting when you want terminal windows
- [ ] Setting works at both global and project levels (project overrides global)

### Dashboard Settings UI
- [ ] Settings tab shows all global settings from `~/.aigon/config.json`
- [ ] Settings tab shows all project settings from `.aigon/config.json` (per repo)
- [ ] Clear visual separation between global and project settings
- [ ] Settings are editable: toggle booleans, edit strings, select from enums
- [ ] Changes saved immediately to the appropriate config file
- [ ] `backgroundAgents` toggle is prominent
- [ ] Settings tab shows which values are inherited vs overridden
- [ ] Read-only display of computed/effective config
- [ ] Dashboard restarts are not required after settings changes

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/config.js
node -c lib/dashboard-server.js
```

## Technical Approach

### Auto-detect Agent Completion

In the dashboard status polling (`collectDashboardStatusData` in `lib/dashboard-server.js`), after building the agent list for each feature:

```js
// For each agent with status 'implementing' and no running tmux session:
if (agent.status === 'implementing' && !agent.tmuxRunning) {
    // Check if worktree has commits beyond setup
    const hasWork = worktreeHasImplementationCommits(agent.worktreePath);
    if (hasWork) {
        // Auto-signal submitted
        writeAgentStatus(featureId, agent.id, { status: 'submitted', updatedAt: new Date().toISOString() });
        agent.status = 'submitted';
        agent.autoDetected = true;
    }
}
```

`worktreeHasImplementationCommits(path)` checks:
```bash
git -C <worktreePath> log --oneline --no-walk HEAD -- ':!.env.local' ':!.aigon/' | head -1
```
If the latest commit is NOT a "chore: worktree setup" commit, the agent did real work.

For agents with **no status file at all** + dead session + worktree with commits: same logic, create the status file.

### Background Flag

1. In `feature-start`: check `--background` flag or `getEffectiveConfig().backgroundAgents`. If true, skip `openTerminalAppWithCommand` calls.
2. Same in `research-start`.
3. Config schema: `{ "backgroundAgents": false }`
4. CLI flag precedence: `--background` > `--foreground` > config setting > default (false)

### Dashboard Settings Tab

1. `/api/settings` endpoint:
   - `GET` → returns `{ global: {...}, project: {...}, effective: {...} }`
   - `PUT` → body: `{ scope: "global"|"project", key: "backgroundAgents", value: true }`

2. Settings tab UI: two-column layout (Global | Project), toggles for booleans, dropdowns for enums, auto-save.

3. Known settings to expose:
   - `backgroundAgents` (boolean)
   - `terminal` (enum: warp/tmux/code/cursor)
   - `profile` (enum: web/api/ios/android/library/generic)
   - `security.enabled` (boolean)
   - `security.mode` (enum: enforce/warn/off)
   - `devServer.enabled` (boolean)
   - Agent model overrides

## Dependencies

- None.

## Out of Scope

- Per-agent background setting
- Terminal multiplexer UI in the dashboard (viewing tmux output in browser)
- Config file validation/schema enforcement

## Related

- Feature #117: rename-setup-to-start (touches same code)
- The "agents don't signal submitted" gap observed across features 114, 118, 126
