---
complexity: medium
set: autonomous-controller-ux
depends_on:
  [566]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:10.290Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-controller-card-status

## Summary
Render AutoConductor controller status directly on feature cards so operators can see when autonomy is running, stopped, completed, or failed. The goal is to make a state like feature 560 legible: workflow review is stuck, but the autonomous controller has already failed and exited.

## User Stories
- [ ] As an operator, when an autonomous run fails, I can see the controller failure on the card without opening files or guessing from workflow state.
- [ ] As an operator, I can distinguish `Review failed` from `Autonomous failed` and understand which layer needs recovery.

## Acceptance Criteria
- [ ] Cards render a compact controller status block when `autonomousController` is present and relevant.
- [ ] Failed controller state shows `Autonomous failed`, a short user-facing reason, last update, and session liveness.
- [ ] Running controller state remains compact and does not crowd normal workflow stage display.
- [ ] Stopped-by-user state reads as manual mode/taken over, not as an error.
- [ ] Completed controller state does not add noise to done features.
- [ ] The card still fits current board dimensions without pushing core action buttons off the visible card.

## Validation
```bash
npm test
```

## Technical Approach
- Render from the server-owned controller DTO introduced by `autonomous-controller-read-model`.
- Treat controller status as a sibling to workflow stage display, not as another flat action row.
- Use existing dashboard CSS patterns and compact card typography; do not introduce a new visual system.
- Include a targeted dashboard/read-model test or fixture for a failed controller with `review-exited-without-signal`.

## Dependencies
- `autonomous-controller-read-model`

## Out of Scope
- Recovery popover behavior
- Controller log viewing
- Changing which actions are exposed

## Open Questions
- Should the status block appear only for non-running terminal controller states, or also while autonomy is actively running?

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model
