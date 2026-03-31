# Feature: Engine-Driven Actions for All Interfaces

## Summary

The workflow engine currently only knows about lifecycle actions (pause, resume, eval, close, restart-agent). UI-convenience actions like "open tmux session", "attach to agent", and "view review session" are computed by the dashboard frontend in `actions.js`, making them invisible to any other interface (CLI board, terminal UI, slash commands, API consumers). This feature moves all action computation into the engine so that any interface gets a complete, UI-agnostic action list and can render its own flavour.

## User Stories

- [ ] As a user viewing the dashboard, I want to see an "Open" button for any running agent so I can attach to its tmux session
- [ ] As a developer building a terminal UI, I want to get all available actions from the engine API without reimplementing dashboard logic
- [ ] As a user running `aigon board`, I want to see the same actions available as on the dashboard
- [ ] As a user, I want actions to be consistent regardless of which interface I use

## Acceptance Criteria

### Engine knows about all action types
- [ ] `FEATURE_ACTION_CANDIDATES` in `feature-workflow-rules.js` includes: `open-session` (per-agent, available when agent has a tmux session and is running/implementing)
- [ ] `RESEARCH_ACTION_CANDIDATES` in `research-workflow-rules.js` includes the equivalent
- [ ] The XState machine allows these actions in the appropriate states (implementing, evaluating, reviewing)
- [ ] `deriveAvailableActions()` returns these actions with enough context for any UI to render them

### Actions carry UI-agnostic metadata
- [ ] Each action in `availableActions` includes:
  - `kind` — machine-readable identifier (e.g. `open-session`, `pause-feature`, `feature-close`)
  - `label` — human-readable default label
  - `agentId` — which agent this applies to (null for entity-level actions)
  - `category` — one of: `lifecycle`, `agent-control`, `session` — so UIs can group/filter
  - `command` — the aigon CLI command string (e.g. `aigon feature-open 182 cc`)
  - `tmuxSession` — for session actions, the tmux session name (so a terminal UI can run `tmux attach`, a dashboard can render a button, etc.)
- [ ] Command string formatting happens in the engine layer (not per-UI)

### Dashboard renders engine actions only
- [ ] Dashboard `actions.js` no longer computes its own action list — it renders `availableActions` from the API response
- [ ] "Open" / "Attach" buttons come from engine `open-session` actions, not frontend logic
- [ ] Review session links come from engine actions, not frontend computation
- [ ] The dashboard can still apply UI-specific rendering (button styles, modals) but cannot add or remove actions

### Other interfaces get the same actions
- [ ] `aigon board` renders actions from the engine (same source as dashboard)
- [ ] The `/api/status` and `/api/detail` endpoints return the full action list with metadata

### Frontend action computation removed
- [ ] `buildFeatureActions()` in `templates/dashboard/js/actions.js` is deleted or reduced to pure rendering logic (no action derivation)
- [ ] No action-related `if/else` or guard logic remains in the frontend — all guards are in the XState machine

## Validation

```bash
node -c aigon-cli.js
node -c lib/workflow-core/actions.js
node -c lib/feature-workflow-rules.js
node -c lib/research-workflow-rules.js

# Engine must return open-session actions for running agents
node -e "
const wf = require('./lib/workflow-core');
const s = wf.showFeatureSync ? wf.showFeatureSync(process.cwd(), '182') : null;
// If 182 exists and has a running agent, availableActions must include open-session
if (s && s.agents) {
  const hasOpen = s.availableActions.some(a => a.kind === 'open-session');
  if (!hasOpen) { console.error('FAIL: no open-session action for running feature'); process.exit(1); }
  console.log('PASS: open-session action present');
} else {
  console.log('SKIP: no active feature to test');
}
"

# Dashboard must not compute its own actions
if grep -q 'buildFeatureActions' templates/dashboard/js/actions.js 2>/dev/null; then
  echo "FAIL: buildFeatureActions still exists in frontend"
  exit 1
fi
```

## Technical Approach

### 1. Add session actions to action candidates

In `feature-workflow-rules.js`, add to `FEATURE_ACTION_CANDIDATES`:

```js
{
    kind: ManualActionKind.OPEN_SESSION,
    label: ({ agentId }) => `Open ${agentId}`,
    eventType: 'noop.open-session',  // not a state transition — informational only
    modeFilter: null,
    perAgent: true,
    recommendedOrder: 10,  // high priority — users want quick access
}
```

### 2. Handle non-transitional actions in the machine

The XState machine needs to allow `noop.*` events without transitioning. Add a wildcard or explicit handler in the implementing/evaluating/reviewing states that accepts `noop.*` events — these are "always valid" informational actions that don't change state.

Alternatively, bypass `snapshot.can()` for noop actions in `deriveAvailableActions()` — check them with a simple guard function instead (e.g., "agent exists and has status running or implementing").

### 3. Enrich action output with metadata

In `deriveAvailableActions()`, add `category`, `command`, and `tmuxSession` fields:

- `category`: derived from the action kind prefix (`pause/resume/close/eval` → `lifecycle`, `restart/drop/force` → `agent-control`, `open-session` → `session`)
- `command`: formatted using the unified `formatActionCommand()` from `action-command-mapper.js`
- `tmuxSession`: for `open-session` actions, compute the tmux session name from the entity ID and agent ID using the existing naming convention

### 4. Strip frontend action derivation

The dashboard frontend should:
1. Read `availableActions` from the API response
2. Group by `category` for rendering (lifecycle actions as buttons, session actions as links, agent-control in overflow)
3. Apply UI-specific styling only — no guard logic, no action filtering, no promotion/demotion

### Key files to modify:

- `lib/feature-workflow-rules.js` — add OPEN_SESSION to candidates
- `lib/research-workflow-rules.js` — same
- `lib/workflow-core/types.js` — add OPEN_SESSION to ManualActionKind enum
- `lib/workflow-core/actions.js` — enrich output with category/command/tmuxSession, handle noop actions
- `lib/action-command-mapper.js` — ensure formatActionCommand handles open-session
- `lib/workflow-snapshot-adapter.js` — pass through enriched actions
- `templates/dashboard/js/actions.js` — strip derivation, render engine actions only

## Dependencies

- depends_on: unified-workflow-engine (178, done)
- depends_on: single-source-of-truth-for-agent-status (179, done)

## Out of Scope

- Building a new terminal UI (just ensure the data is there for one)
- Feedback entity actions (stays on state-queries)
- Changing which lifecycle transitions are valid (pure consolidation + addition of session actions)

## Open Questions

- Should `noop` actions go through XState at all, or should `deriveAvailableActions()` have a separate "always available if guard passes" path? XState purists would say everything goes through the machine, but noop actions by definition don't transition state.

## Related

- Feature 178: Unified Workflow Engine (done)
- Feature 179: Complete the Engine Migration (done)
- Feature 182: Engine Cleanup — Remove Legacy Bypasses (in progress)
