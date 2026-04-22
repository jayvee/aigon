# Feature: dashboard review-check status indicators

## Summary

Show "Addressing review" and "Feedback addressed" status on dashboard agent cards so the user can tell when an implementation agent has been handed review feedback to work through, and when it has signalled completion.

## User Stories

- [ ] As a user watching the dashboard, when the server injects a review-check prompt into the implementation agent's session I want to see "Addressing review" on that agent's row so I know feedback is being worked on.
- [ ] As a user watching the dashboard, when the implementation agent signals `aigon agent-status feedback-addressed` I want to see "Feedback addressed" on that agent's row so I know the loop is complete and can trigger the next review or submit.

## Acceptance Criteria

- [ ] When `reviewStatus === 'done'` and the implementing agent's tmux session is still running, the agent row label reads "Addressing review" (not "Running" / "Implementing").
- [ ] When the implementing agent's status is `feedback-addressed`, the agent row label reads "Feedback addressed" with a distinct visual treatment (e.g. checkmark or muted colour, not the green running dot).
- [ ] Both states survive a dashboard reload (i.e. driven by persistent snapshot/review-state data, not transient UI memory).
- [ ] Existing "Implementing", "Waiting", "Submitted", and error states are unaffected.

## Validation

```bash
node --check lib/dashboard-status-collector.js
node --check lib/dashboard-status-helpers.js
node --check templates/dashboard/js/pipeline.js 2>/dev/null || true
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +30 LOC if new unit tests for the two new statuses require it.

## Technical Approach

Two changes are needed — one in the data layer, one in the rendering layer.

**1. Status normalization (`lib/dashboard-status-helpers.js`)**

`normalizeDashboardStatus()` currently collapses anything not in `{implementing, waiting, submitted, error}` to `'implementing'`. Add two new pass-through cases:
- `'addressing-review'` — computed (not stored) when `reviewStatus === 'done'` and agent is still running
- `'feedback-addressed'` — stored directly in the agent status file; already written by `aigon agent-status feedback-addressed`

**2. Status enrichment (`lib/dashboard-status-collector.js`)**

In `buildFeatureAgentRow()`, after resolving the raw agent status, check: if the agent is the implementing agent AND `feature.reviewStatus === 'done'` AND raw status is still `'implementing'`/`'running'`, override the normalized status to `'addressing-review'`. The `feedback-addressed` status already arrives from the agent status file; it just needs to survive normalization.

**3. Dashboard rendering (`templates/dashboard/js/pipeline.js`)**

Add cases to `buildAgentStatusHtml()`:
- `'addressing-review'` → amber/orange dot + "Addressing review" label
- `'feedback-addressed'` → muted checkmark + "Feedback addressed" label (similar visual weight to "Submitted")

Data already available — `feature.reviewStatus`, `feature.reviewSessions`, and the per-agent status file — no new API endpoints or snapshot fields needed.

## Dependencies

- None

## Out of Scope

- Indicating that the *review prompt was injected* at the exact moment of injection (ephemeral, not persisted — not reliable across dashboard reloads).
- Changes to how `aigon agent-status feedback-addressed` is signalled.
- Any new tmux or process detection.

## Open Questions

- Should "Addressing review" also appear during the brief window before `reviewStatus` is set to `done` but after injection? (Probably no — not persisted, so not reliable.)

## Related

- Research:
