---
complexity: high
set: review-recovery
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T02:05:18.668Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-review-takeover

## Summary
Add a first-class way to stop an in-flight feature AutoConductor and keep the feature in its current workflow state so the operator can take over manually. This is the foundation for review recovery: when a solo autonomous run reaches review and the operator decides the current automation should stop, they need an explicit action that ends the autonomous session, persists that the run is no longer orchestrated, and leaves implementation/review/revision state untouched.

## User Stories
- [ ] As an operator, when a feature autonomous run is active, I can stop the AutoConductor without resetting or closing the feature so I can continue manually from the current state.
- [ ] As an operator, when I stop autonomy during review or revision, the dashboard no longer presents the feature as actively orchestrated and no background conductor makes further decisions for that feature.

## Acceptance Criteria
- [ ] A new explicit command exists for stopping a feature autonomous run, mirroring the intent and persistence semantics of `set-autonomous-stop` but scoped to a single feature.
- [ ] Stopping autonomy kills the AutoConductor tmux session if it exists and writes durable feature-auto state with `running: false`, a stopped status, and a user-stop reason.
- [ ] Stopping autonomy does not mutate workflow lifecycle state. For example, if the feature is in `implementing`, `code_review_in_progress`, or `code_revision_in_progress` before the stop, it remains there after the stop.
- [ ] Dashboard/read-model surfaces expose a first-class manual action for this capability whenever a feature has live or persisted autonomous state.
- [ ] After stopping autonomy, existing implementation/review/eval tmux sessions continue unaffected and can be driven manually.
- [ ] Feature autonomous status output clearly reports the conductor as stopped and preserves the last known reason/timestamps.

## Validation
```bash
npm test
```

## Technical Approach
- Treat autonomous/manual as sidecar state, not workflow lifecycle. Reuse `.aigon/state/feature-<id>-auto.json` as the source of truth for whether a conductor is attached.
- Add a feature-scoped stop command alongside `feature-autonomous-start status`, likely implemented in `lib/feature-autonomous.js`, with CLI wiring from `lib/commands/feature.js`.
- Reuse the existing auto tmux session resolution logic (`findAutoSessionNameByFeatureId`) and sidecar persistence helpers (`readFeatureAutoState` / `writeFeatureAutoState`).
- Extend dashboard action derivation/read-model plumbing so the UI can render a feature-level `Take Over Manually` action whenever autonomous state is present.
- Keep the implementation intentionally narrow: this feature is only about stopping orchestration cleanly, not cancelling review or launching a replacement reviewer.

## Dependencies
- Existing feature autonomous state persistence and status surfaces (`lib/feature-autonomous.js`, `lib/auto-session-state.js`, dashboard read model)

## Out of Scope
- Cancelling an in-progress code review
- Launching a replacement review session or changing reviewer/model
- SetConductor changes beyond preserving compatibility with stopped feature-auto state

## Open Questions
- Should the dashboard label read `Take Over Manually`, `Stop Autonomy`, or both depending on surface?
- Should the command support a future `--reason` free-text field, or is a fixed `stopped-by-user` reason enough for now?

## Related
- Research: none
- Set: review-recovery
- Prior features in set: none
