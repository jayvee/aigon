# Feature: Migrate all dashboard actions to the engine

## Summary

Feature 184 moved `open-session` to the engine but left most actions computed in the dashboard frontend. The result: backlog features show "Pause feature" (the only engine action valid from backlog) instead of "Start feature" (computed frontend-side but never migrated). This feature completes the migration — every action button the dashboard shows must come from `deriveAvailableActions()` via the API, not from frontend JavaScript logic.

## Background: Current state after feature 184

**Engine-computed actions** (via `FEATURE_ACTION_CANDIDATES` → XState):
- open-session, pause, resume, eval, review, close, restart-agent, force-agent-ready, drop-agent, select-winner

**Frontend-computed actions** (dashboard JS, never in engine):
- **Start feature** (backlog → in-progress, needs agentPicker)
- **Prioritise** (inbox → backlog)
- **Run Autopilot** (backlog, in-progress)
- **Dev server poke** (Start Dev Server / Start preview)
- **Session-ended flag actions** (Submit, Re-open, Open for ended sessions)
- **View research findings** (agent.findingsPath)
- **View review** (feature.reviewSessions)
- **Open eval session** (evalSession.running)

The `FEATURE_STAGE_ACTIONS` and `FEATURE_STAGE_TRANSITIONS` tables in `feature-workflow-rules.js` already define all these — they're just not wired into `deriveAvailableActions()`.

## User Stories

- [ ] As a user, I want to see "Start feature" on backlog items in the dashboard so I can start features without the CLI
- [ ] As a user, I want to see "Prioritise" on inbox items so I can move features to backlog from the dashboard
- [ ] As a developer building alternative UIs (terminal, API), I want all actions from one API endpoint without reimplementing dashboard logic

## Acceptance Criteria

### Missing lifecycle actions added to engine
- [ ] `FEATURE_START` added to `ManualActionKind` and `FEATURE_ACTION_CANDIDATES` — valid from backlog, carries `requiresInput: 'agentPicker'` metadata
- [ ] `FEATURE_PRIORITISE` added — valid from inbox
- [ ] `FEATURE_AUTOPILOT` added — valid from backlog and in-progress (when no running sessions)
- [ ] XState machine updated with corresponding events and transitions so `snapshot.can()` returns true from the correct states
- [ ] Research equivalents added where applicable

### Frontend-computed actions migrated
- [ ] Dev server poke eligibility → engine action candidate with guard based on agent status
- [ ] Session-ended flag actions (Submit, Re-open) → engine action candidates with guard
- [ ] View findings / View review / Open eval → engine action candidates with guards
- [ ] Each action carries enough metadata for any UI to render it: `kind`, `label`, `command`, `agentId`, `category`, `requiresInput`

### Dashboard renders engine actions only
- [ ] Dashboard `renderActionButtons()` reads only from `feature.validActions` / `research.validActions`
- [ ] Frontend action computation logic in `actions.js`, `monitor.js`, `pipeline.js` removed or reduced to pure rendering
- [ ] Action label remapping (e.g., `feature-open` → "Restart" based on agent status) moves to engine-side label generation

### API contract
- [ ] `/api/status` and `/api/detail` return complete action lists with all metadata
- [ ] Each action object includes: `kind`, `label`, `command`, `agentId`, `category`, `recommendedOrder`, `requiresInput` (if applicable)

## Validation

```bash
node -c lib/workflow-core/actions.js
node -c lib/feature-workflow-rules.js
node -c lib/research-workflow-rules.js
node -c lib/workflow-core/types.js
node -c lib/workflow-core/machine.js
node -c templates/dashboard/js/actions.js
```

## Technical Approach

### Phase 1: Add missing lifecycle action candidates

Add to `FEATURE_ACTION_CANDIDATES` in `feature-workflow-rules.js`:

```js
{
    kind: ManualActionKind.FEATURE_START,
    label: 'Start feature',
    eventType: 'feature.start',
    recommendedOrder: 1,
    requiresInput: 'agentPicker',
},
{
    kind: ManualActionKind.FEATURE_PRIORITISE,
    label: 'Prioritise',
    eventType: 'feature.prioritise',
    recommendedOrder: 1,
},
```

Add corresponding events to the XState machine states (backlog allows `feature.start`, inbox allows `feature.prioritise`).

### Phase 2: Migrate operational actions

Convert the `FEATURE_STAGE_ACTIONS` table entries into action candidates with guards:
- `feature-open` / `feature-attach` / `feature-focus` → already partially done (open-session), extend guards
- `feature-autopilot` → new candidate with `noRunningTmuxSessions` guard
- Dev server poke → new candidate with `devServerPokeEligible` guard

### Phase 3: Strip dashboard frontend computation

Remove frontend action building from `actions.js`, `monitor.js`, `pipeline.js`. Dashboard becomes a pure renderer of `validActions` from the API.

### Files changed

1. **`lib/workflow-core/types.js`** — add FEATURE_START, FEATURE_PRIORITISE, FEATURE_AUTOPILOT to ManualActionKind
2. **`lib/feature-workflow-rules.js`** — add candidates to FEATURE_ACTION_CANDIDATES, add events to FEATURE_ENGINE_STATES
3. **`lib/research-workflow-rules.js`** — equivalent research actions
4. **`lib/workflow-core/machine.js`** — may need XState state config updates for new events
5. **`lib/workflow-snapshot-adapter.js`** — ensure new actions flow through to dashboard format
6. **`lib/dashboard-status-collector.js`** — ensure action metadata is complete in API response
7. **`templates/dashboard/js/actions.js`** — strip frontend action computation, render from validActions only
8. **`templates/dashboard/js/pipeline.js`** — remove frontend action building
9. **`templates/dashboard/js/monitor.js`** — remove frontend action building

## Dependencies

- Feature 184 (engine-driven actions) — already done, this completes it

## Out of Scope

- Feedback actions (feedback doesn't use the workflow engine yet)
- Drag-and-drop stage transitions (these can remain UI-driven events that dispatch to the API)
- Action execution logic (how the dashboard calls the API to execute an action — that already works)

## Open Questions

- Should `requiresInput: 'agentPicker'` cause the dashboard to show an agent selection modal before dispatching? (Currently the CLI handles this interactively)
- Should the engine return the full `aigon` CLI command string for each action, or should the dashboard format it?

## Related

- Feature 184 — engine-driven actions (partial migration, this completes it)
- `FEATURE_STAGE_ACTIONS` table (`feature-workflow-rules.js:155-167`) — defines all expected stage actions
- `FEATURE_STAGE_TRANSITIONS` table (`feature-workflow-rules.js:139-148`) — defines valid stage transitions
- Dashboard action rendering (`templates/dashboard/js/actions.js:46-167`)
