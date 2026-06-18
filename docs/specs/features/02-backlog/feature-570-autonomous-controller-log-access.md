---
complexity: medium
set: autonomous-controller-ux
depends_on: [569]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:41.603Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:11.909Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-controller-log-access

## Summary
Make AutoConductor logs accessible from the dashboard recovery UI. When the controller fails, operators should be able to inspect the controller output that explains why it exited, without attaching to a dead tmux session or finding sidecar files manually.

## User Stories
- [ ] As an operator, when an autonomous run fails, I can open the controller log from the dashboard.
- [ ] As an operator, I can distinguish controller output from implementer, reviewer, and eval agent output.

## Acceptance Criteria
- [ ] Feature auto sidecar state or session metadata includes enough information to locate the last controller log after the tmux session exits.
- [ ] Dashboard recovery UI exposes `View controller log` when a log is available.
- [ ] The log view clearly labels controller status, feature ID, session name, and captured output.
- [ ] Missing logs produce a clear unavailable state, not a broken button.
- [ ] Existing agent session transcript/log surfaces are reused where appropriate instead of creating a parallel log system.
- [ ] Tests or fixtures cover available and missing controller log cases.

## Validation
```bash
npm run test:core
```

## Technical Approach
- **Gated pre-audit (do before committing implementation):** determine whether `role: auto` tmux sessions are captured durably enough to resolve their last output after the session exits. If they are not, this feature's scope changes — it splits into (a) extending capture/retention for `role: auto` and (b) the dashboard log-view surface. Resolve this before writing the UI.
- First audit existing tmux capture/session-sidecar behavior for `role: auto` sessions.
- Prefer storing or resolving a durable pointer from the existing `.aigon/sessions` sidecar or capture path rather than inventing a new log location.
- Wire the dashboard detail/recovery view to fetch and display the controller log through an existing safe route if possible.
- Keep this separate from the first four UX features because log plumbing can touch session capture and retention behavior.

## Dependencies
- `autonomous-recovery-popover`

## Out of Scope
- Live streaming controller logs while the run is still active
- Changing agent transcript capture for implementer/reviewer sessions
- Adding persistent cloud log storage

## Open Questions
- (Tracked as the gated pre-audit in Technical Approach above — must be answered before implementation, not carried through it.)

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model, autonomous-controller-card-status, autonomous-recovery-action-model, autonomous-recovery-popover
