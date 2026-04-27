---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T02:25:02.570Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard workflow escape hatches

## Summary

When an agent completes its work but fails to emit the required lifecycle signal (e.g. Gemini finishes a code review but never runs `aigon agent-status review-complete`), the workflow stalls indefinitely with no recovery path visible in the UI. This feature adds "Mark [X] complete" overflow menu items to the dashboard for each scenario where an agent's completion signal may be missing. The user can manually confirm the agent is done and advance the workflow — an escape hatch, not a shortcut. Depends on F404 (agent lifecycle signal rename) for clean, unambiguous signal names across all five scenarios.

## User Stories

- [ ] As a user watching a review session stall with Gemini showing it returned to prompt but the dashboard still showing "Reviewing", I click `···` → "Mark review complete" and the workflow immediately advances without me needing to open a terminal.
- [ ] As a user whose implementation agent finished coding but the dashboard still shows "Implementing", I click `···` → "Mark implementation complete" to unblock the pipeline.
- [ ] As a user whose revision agent addressed feedback but never signalled, I click `···` → "Mark revision complete" to close the revision pass.
- [ ] As a user whose spec reviewer finished but didn't signal, I click `···` → "Mark spec review complete".
- [ ] As a user whose research agent finished findings but didn't signal, I click `···` → "Mark research complete".
- [ ] As a user who opens the overflow menu while the agent is clearly still working, the "Mark X complete" item is absent — the escape hatch does not tempt premature use.

## Acceptance Criteria

- [ ] Each of the five scenarios has a "Mark [X] complete" item in the overflow `···` menu on its respective dashboard row/card, visible only when the relevant agent session exists and has not yet emitted the expected signal
- [ ] Clicking "Mark [X] complete" calls `POST /api/features/:id/mark-complete` (or `/api/research/:id/mark-complete`) with `{ signal, agentId }`; the server emits the same workflow event as the agent would have emitted
- [ ] The five supported signals and their triggering conditions:
  - `implementation-complete` — agent session role `do`, no `implementation-complete`/`submitted` signal recorded
  - `revision-complete` — agent session role `revise`, no `revision-complete` signal recorded
  - `review-complete` — agent session role `review`, no `review-complete` signal recorded
  - `spec-review-complete` — agent session role `spec-review`, no `spec-review-complete` signal recorded
  - `research-complete` — research entity role `do`, no `research-complete`/`submitted` signal recorded
- [ ] Menu item label uses "Mark": "Mark review complete", "Mark implementation complete", etc.
- [ ] The menu item is absent (not disabled, not greyed — absent) when the working spinner is active for that agent (`isWorking` is true)
- [ ] The menu item is absent when the completion signal has already been emitted
- [ ] After clicking, the dashboard row updates within one polling cycle (≤ 5 s) to reflect the new state — no manual refresh required. The update is silent; the row state change acts as the confirmation (no separate toast/dialog).
- [ ] The action is logged as `source: 'dashboard/mark-complete'` in the workflow event, distinguishable from agent-emitted signals in the event log
- [ ] API rejects unknown signal values with 400; only the five listed signals are accepted
- [ ] Playwright test: renders the menu item when signal is missing and spinner is not active; does not render it when signal is present; clicking it advances the displayed state

## Validation

```bash
node -c lib/dashboard-routes.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May raise `scripts/check-test-budget.sh` CEILING by up to +30 LOC for the Playwright test covering the new menu items.

## Technical Approach

### New API endpoint

```
POST /api/features/:id/mark-complete
POST /api/research/:id/mark-complete
Body: { signal: 'implementation-complete' | 'revision-complete' | 'review-complete' | 'spec-review-complete' | 'research-complete', agentId: string }
```

Handler in `lib/dashboard-routes.js`: validate signal is one of the five allowed values (400 otherwise), resolve entity, then call the same workflow function that `aigon agent-status` calls to record completion. Set `source: 'dashboard/mark-complete'`.

### Detecting "signal missing" via Server (`lib/dashboard-status-collector.js`)

To prevent a second source of truth for workflow state logic in the frontend, `lib/dashboard-status-collector.js` must compute whether an escape hatch is applicable.
It should append a `pendingCompletionSignal` property (e.g. `'implementation-complete'`, or `null`) to the agent object sent to the frontend, based on the agent's role and current workflow state.

### Dashboard UI (`templates/dashboard/js/`)

In the overflow menu builder (wherever `···` actions are assembled per agent row), add a conditional entry based on the server-provided property:

```js
if (agent.pendingCompletionSignal && !agent.isWorking) {
  const labelMap = {
    'implementation-complete': 'implementation',
    'revision-complete': 'revision',
    'review-complete': 'review',
    'spec-review-complete': 'spec review',
    'research-complete': 'research'
  };
  menuItems.push({
    label: `Mark ${labelMap[agent.pendingCompletionSignal]} complete`,
    action: () => postMarkComplete(entity.id, entity.type, agent.pendingCompletionSignal, agent.id),
  });
}
```

This ensures the frontend remains a dumb presentation layer regarding workflow eligibility.

## Dependencies

- depends_on: feature-404-agent-lifecycle-signal-rename

  F404 must ship before this feature is implemented. The signal names (`implementation-complete`, `revision-complete`, etc.) used in the API and UI labels are defined in F404.

## Out of Scope

- Auto-triggering "mark complete" without user action (supervisor auto-nudge — separate feature)
- Resetting or reverting workflow state
- Clearing `awaiting-input` state
- Clearing error state / retry
- Confirmation dialog on click (single-click is sufficient for a recoverable action)

## Related

- Set: agent-lifecycle-signals
- Prior features in set: F404 (agent lifecycle signal rename)