---
complexity: medium
set: autonomous-controller-ux
depends_on:
  [567]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:40.892Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:10.815Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-recovery-action-model

## Summary
Replace scattered top-level autonomous recovery actions with a single server-owned `Recover` action when controller state needs operator intervention. This prevents the card action picker from growing with every new autonomous failure mode while preserving access to the underlying commands.

## User Stories
- [ ] As an operator, I see one recovery entry point instead of a growing list of controller-specific actions in the overflow menu.
- [ ] As a dashboard developer, I can route recovery UI from one action payload that includes recommended and secondary actions.

## Acceptance Criteria
- [ ] Dashboard validActions include a single `autonomous-recover` or equivalent action when `autonomousController.status` indicates failed/stopped recovery is relevant.
- [ ] The action payload includes the recommended recovery kind and a list of available recovery operations, such as cancel review, re-run review, take over manually, retry close, or reset.
- [ ] Existing primitive commands remain callable and testable, but the card does not add every primitive as a peer top-level action when a recovery action is present.
- [ ] For a feature like 560, the recommended action is cancel review, with re-run review as the next step after cancellation.
- [ ] Destructive actions remain marked destructive and are not promoted as the primary recovery recommendation.
- [ ] Existing non-autonomous feature action behavior remains unchanged.

## Validation
```bash
npm test
```

## Technical Approach
- Add a server-side action shaping layer that consumes `autonomousController` and current workflow snapshot.
- Keep the frontend thin: it should render `Recover` and pass the payload into the recovery UI rather than infer failure semantics itself.
- Preserve action-command mapping for existing primitive commands; change presentation, not core command availability.
- Add tests for failed review, stopped-by-user, running controller, and non-autonomous feature cases.

## Dependencies
- `autonomous-controller-card-status`

## Out of Scope
- Building the recovery popover UI
- Controller log access
- Adding resume/restart autonomy semantics

## Open Questions
- Should `Recover` replace `Cancel review` on the card immediately, or should `Cancel review` remain visible until the popover ships?

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model, autonomous-controller-card-status
