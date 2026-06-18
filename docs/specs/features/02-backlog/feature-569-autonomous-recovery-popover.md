---
complexity: medium
set: autonomous-controller-ux
depends_on:
  [568]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:11.341Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-recovery-popover

## Summary
Build the dashboard recovery popover or drawer section behind the single `Recover` action. The UI should explain what failed, recommend the next operator action, group secondary diagnostics, and keep destructive operations separated.

## User Stories
- [ ] As an operator, when an autonomous run fails, I can click `Recover` and see the specific next step rather than inspect logs manually.
- [ ] As an operator, I can tell which sessions are alive or dead before choosing whether to cancel, rerun, close, or reset.

## Acceptance Criteria
- [ ] Clicking the recovery action opens a focused recovery surface with controller status, raw reason, human reason, last update, and session liveness.
- [ ] The surface has a clear recommended action area, a secondary actions area, a diagnostics area, and a destructive area.
- [ ] For `review-exited-without-signal`, the recommended action is `Cancel review`, followed by a visible path to `Re-run code review`.
- [ ] For eval and close failure categories, the surface shows appropriate placeholders/actions based on available current commands and does not invent unsupported behavior.
- [ ] The popover/drawer works from both card actions and detail drawer action surfaces.
- [ ] The existing overflow menu remains smaller because controller-specific actions are grouped under recovery.

## Validation
```bash
npm test
```

## Technical Approach
- Consume the action payload produced by `autonomous-recovery-action-model`.
- Use existing dashboard modal/popover helpers and existing command execution routes.
- Keep visual design operational and compact: no new large panel unless the existing drawer is the chosen surface.
- Add targeted UI/module tests for the action payload mapping if the repo has suitable dashboard JS test coverage.

## Dependencies
- `autonomous-recovery-action-model`

## Out of Scope
- Durable controller log access
- New backend commands beyond already available recovery primitives
- Automatic recovery execution without operator confirmation

## Open Questions
- Should recovery be a popover anchored to the card, a modal, or a section inside the existing detail drawer?

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model, autonomous-controller-card-status, autonomous-recovery-action-model
