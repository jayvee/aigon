# Feature: dashboard-autopilot-action

## Summary
Add a "Run Autopilot" action button to feature cards in the dashboard for features in the **backlog** and **in-progress** columns. This lets users launch `feature-autopilot` directly from the dashboard UI using the existing agent picker modal, instead of having to switch to the CLI.

## User Stories
- [ ] As a user viewing the dashboard, I want to start autopilot on a backlog feature so I can kick off parallel multi-agent work without leaving the dashboard
- [ ] As a user viewing the dashboard, I want to start autopilot on an in-progress feature so I can escalate a solo feature to a multi-agent arena run

## Acceptance Criteria
- [ ] A "Run Autopilot" button appears on feature cards in the **backlog** column (alongside existing "Start feature" button)
- [ ] A "Run Autopilot" button appears on feature cards in the **in-progress** column when no agents are currently running
- [ ] Clicking "Run Autopilot" opens the agent picker modal with multi-select (checkboxes), minimum 2 agents required
- [ ] Agent picker submit label reads "Autopilot" (not "Setup")
- [ ] After agent selection, the dashboard calls `feature-autopilot <id> <agents...>` via the action API
- [ ] The button does NOT appear when the feature already has running tmux sessions (agents already active)
- [ ] `node -c templates/dashboard/js/pipeline.js && node -c templates/dashboard/js/sidebar.js` passes

## Validation
```bash
node -c templates/dashboard/js/pipeline.js
node -c templates/dashboard/js/sidebar.js
node -c lib/state-machine.js
node -c lib/dashboard-server.js
```

## Technical Approach

Three files need changes:

### 1. State machine (`lib/state-machine.js`)
Add a new action entry in `FEATURE_ACTIONS`:
```js
{
    type: 'action',
    stage: 'backlog',
    action: 'feature-autopilot',
    guard: () => true,
    label: () => 'Run Autopilot',
    perAgent: false,
    mode: 'terminal',
    requiresInput: 'agentPicker'
}
```
And a similar entry for `stage: 'in-progress'` with a guard that checks no agents are currently running.

### 2. AIGON server (`lib/dashboard-server.js`)
In `getFeatureActions()`:
- Add `'feature-autopilot'` to `ACTION_REASONS` map: `'Run parallel agents in autopilot mode'`
- Add a case in the switch to build the command: `aigon feature-autopilot ${id} ${agents}`

### 3. Dashboard frontend (`templates/dashboard/js/pipeline.js`)
In `handleValidAction()` switch statement, add a case for `'feature-autopilot'`:
- Show the agent picker with `{ title: 'Select Autopilot Agents', submitLabel: 'Autopilot' }`
- Validate at least 2 agents selected (show toast if fewer)
- Call `requestAction('feature-autopilot', [id, ...agents], repoPath, btn)`
- Do NOT call `requestFeatureOpen` per agent — autopilot spawns its own tmux sessions

## Dependencies
- Existing agent picker modal in `sidebar.js` (no changes needed — already supports multi-select)
- `feature-autopilot` CLI command (already implemented in `lib/commands/feature.js`)
- Dashboard action API (`/api/action` endpoint in `lib/dashboard-server.js`)

## Out of Scope
- Autopilot monitoring UI in the dashboard (status polling, progress display)
- Autopilot-specific configuration from the dashboard (max-iterations, auto-eval, poll-interval)
- Research autopilot action (can be a follow-up)

## Open Questions
- Should the in-progress guard also check for existing worktrees (autopilot can reuse them)?

## Related
- `lib/commands/feature.js:1730-2065` — feature-autopilot implementation
- `lib/state-machine.js:244-254` — existing feature-setup backlog action (pattern to follow)
- `templates/dashboard/js/pipeline.js:143-151` — existing feature-setup handler (pattern to follow)
