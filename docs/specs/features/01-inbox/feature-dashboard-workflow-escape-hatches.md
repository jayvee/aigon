---
complexity: high
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
- [ ] The menu item is absent (not disabled, not greyed — absent) when the working spinner is active for that agent
- [ ] The menu item is absent when the completion signal has already been emitted
- [ ] After clicking, the dashboard row updates within one polling cycle (≤ 5 s) to reflect the new state — no manual refresh required
- [ ] The action is logged as `source: 'dashboard/mark-complete'` in the workflow event, distinguishable from agent-emitted signals in the event log
- [ ] API rejects unknown signal values with 400; only the five listed signals are accepted
- [ ] Playwright test: renders the menu item when signal is missing and spinner is not active; does not render it when signal is present; clicking it advances the displayed state

## Validation

```bash
node -c lib/server-routes.js
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

Handler in `lib/server-routes.js`: validate signal is one of the five allowed values (400 otherwise), resolve entity, then call the same `wf.*` function that `aigon agent-status` calls — e.g. `wf.recordCodeReviewCompleted(...)` for `review-complete`. Set `source: 'dashboard/mark-complete'`.

### Dashboard UI (`templates/dashboard/js/`)

In the overflow menu builder (wherever `···` actions are assembled per agent row), add a conditional entry:

```js
const pendingSignal = getPendingCompletionSignal(agent, entity);
if (pendingSignal && !agent.isWorking) {
  menuItems.push({
    label: `Mark ${pendingSignal.label} complete`,
    action: () => postMarkComplete(entity.id, entity.type, pendingSignal.signal, agent.id),
  });
}
```

`getPendingCompletionSignal` returns `null` if the signal was already emitted or the session role doesn't map to one of the five scenarios. It reads from the status data already present on the row — no extra API call.

Signal → label mapping:
| signal | label |
|---|---|
| `implementation-complete` | "implementation" |
| `revision-complete` | "revision" |
| `review-complete` | "review" |
| `spec-review-complete` | "spec review" |
| `research-complete` | "research" |

### Detecting "signal missing" without extra API calls

The dashboard status collector already surfaces agent `status` on each row. Use it directly: if `status` is one of the in-progress values (`reviewing`, `implementing`, `revising`, `spec-reviewing`) the completion signal has not been emitted; show the menu item. If `status` is the corresponding complete value, hide it.

### "Agent is working" detection

Use the existing working-spinner / `isWorking` flag already computed for each agent row (based on the heartbeat or working pattern). When `isWorking` is true, omit the menu item entirely.

## Dependencies

- depends_on: feature-404-agent-lifecycle-signal-rename

  F404 must ship before this feature is implemented. The signal names (`implementation-complete`, `revision-complete`, etc.) used in the API and UI labels are defined in F404.

## Out of Scope

- Auto-triggering "mark complete" without user action (supervisor auto-nudge — separate feature)
- Resetting or reverting workflow state
- Clearing `awaiting-input` state
- Clearing error state / retry
- Confirmation dialog on click (single-click is sufficient for a recoverable action)

## Open Questions

- Should clicking open a brief toast/confirmation ("Marked review complete") or is silent state update sufficient? Recommended: silent update — the row state change IS the confirmation.

## Related

- Set: agent-lifecycle-signals
- Prior features in set: F404 (agent lifecycle signal rename)
