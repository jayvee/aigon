---
complexity: medium
set: autonomous-controller-ux
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:40.282Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:09.692Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-controller-read-model

## Summary
Expose a stable dashboard read-model DTO for feature AutoConductor state so the UI can distinguish workflow state from controller state. The current card can say `Review failed` while the controller has already failed and exited; this feature creates the server-owned data contract needed to show `Autonomous failed`, the failure reason, timestamps, and recommended recovery context.

## User Stories
- [ ] As an operator, I can tell whether a feature is still autonomously controlled or already in manual recovery.
- [ ] As a dashboard developer, I can consume one normalized controller object instead of reading raw auto sidecar fields in multiple frontend places.

## Acceptance Criteria
- [ ] Feature dashboard payloads include a normalized `autonomousController` object for features with feature-auto sidecar state.
- [ ] The DTO includes at least `status`, `running`, `reason`, `reasonLabel`, `sessionName`, `sessionRunning`, `startedAt`, `updatedAt`, `endedAt`, `workflowState`, `mode`, `agents`, `reviewAgent`, and `evalAgent`.
- [ ] The DTO distinguishes `running`, `stopped`, `failed`, `completed`, and quota-paused controller states without relying on workflow lifecycle alone.
- [ ] Failure reasons are mapped to user-facing categories such as setup failure, reviewer exited, timeout, quota, eval failure, and close failure.
- [ ] The DTO includes a `recommendedRecoveryKind` or equivalent stable enum that later UI features can use without parsing labels.
- [ ] Existing `autonomousPlan` data remains backward compatible while the new controller DTO is introduced.

## Validation
```bash
npm test
```

## Technical Approach
- Add a focused read-model helper near the existing auto-state/dashboard read path rather than deriving controller state in frontend code.
- Use `.aigon/state/feature-<id>-auto.json` as the source of truth for controller status, with live tmux lookup only for session liveness.
- Keep raw reason strings available for diagnostics, but expose human labels and categories from server-owned mapping.
- Cover representative sidecar fixtures for `running`, `failed: review-exited-without-signal`, `stopped-by-user`, `completed`, and missing state.

## Dependencies
- Existing feature-auto sidecar state written by `lib/feature-autonomous.js`
- Existing dashboard read-model plumbing in `lib/workflow-read-model.js` / `lib/dashboard-status-collector.js`

## Out of Scope
- Rendering the controller state on cards
- Changing action menu behavior
- Adding controller log access

## Open Questions
- Should the DTO live directly on each feature row as `autonomousController`, or under `autonomousPlan.controller` for tighter grouping?

## Related
- Set: autonomous-controller-ux
- Prior features in set: none
