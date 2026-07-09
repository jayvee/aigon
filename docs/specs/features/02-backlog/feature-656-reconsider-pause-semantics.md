---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T00:47:17.511Z", actor: "cli/feature-prioritise" }
---

# Feature: reconsider-pause-semantics

## Summary
Pause currently carries several meanings across Aigon: pre-start hold, in-progress interruption, quota pause, set-conductor pause, and autonomous stop/recovery. The behavior is mostly implemented, but the user-facing semantics are not clearly separated, which makes dashboard labels, valid actions, and recovery guidance easy to misread. Audit the pause/resume surfaces and tighten the terminology so each pause kind has one clear meaning and one clear recovery path.

## User Stories
- [ ] As an operator, I can tell whether a paused item is simply parked before start, interrupted mid-run, quota-blocked, or paused by an autonomous/set failure.
- [ ] As a dashboard user, the available action tells me the real next step: resume, rerun review, wait for quota, or restart automation.
- [ ] As a maintainer, future pause-related features have a short documented contract instead of inferring semantics from scattered state names.

## Acceptance Criteria
- [ ] Audit and document every pause-like state/signal: `currentSpecState: paused`, pre-start pause reason, `quota-paused`, `paused-on-failure`, `paused-on-quota`, autonomous `stopped`, and review-quota-paused.
- [ ] Dashboard/read-model labels distinguish parked items from execution failures and quota waits; no generic "Paused" label hides a recovery-specific state when better information exists.
- [ ] `feature-pause` / `feature-resume` and `research-pause` / `research-resume` help/error text reflects the intended scope: operator pause, not quota or autonomous recovery.
- [ ] Valid actions remain server-owned and consistent: parked items expose resume, quota-paused agents expose `agent-resume` only when quota state allows it, failed automation exposes automation recovery actions.
- [ ] Add regression coverage for at least one pre-start paused item, one quota-paused agent, and one set/autonomous paused-on-failure case.
- [ ] No new lifecycle state is introduced unless the audit proves an existing state cannot express the distinction.

## Validation
```bash
node tests/integration/lifecycle.test.js
node tests/integration/quota-mid-run-f446.test.js
node tests/integration/set-conductor.test.js
npm run test:core
```

## Pre-authorised
<!-- Standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     The first line below is a project-wide default — keep it unless the feature
     explicitly demands Playwright runs mid-iterate. Add or remove other lines
     per feature.
     Example extras:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
-->
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
- Start with a read-only audit of `lib/feature-lifecycle.js`, `lib/entity.js`, `lib/quota-dashboard-actions.js`, `lib/workflow-read-model.js`, `lib/set-conductor.js`, and `lib/feature-autonomous.js`.
- Prefer label/action/doc changes over machine changes. If behavior is already correct, make it legible.
- Use existing `stateRenderMeta`, `validActions`, and autonomous controller DTOs rather than adding frontend branching.

## Dependencies
- Research topic `research-57-feature-pause-on-inbox-items-skips-move-spec-effect` should be checked first; if its concrete producer bug is already fixed, fold only its semantic lessons into this feature.

## Out of Scope
- Replacing quota detection.
- Rewriting AutoConductor or SetConductor.
- Adding a new Paused column or changing folder names.

## Open Questions
- Should the UI reserve "Paused" for operator-parked work only, and use "Quota waiting" / "Automation stopped" for the other cases?

## Related
- Research: `research-57-feature-pause-on-inbox-items-skips-move-spec-effect`
- Prior work: F446 quota pause/resume, F566 autonomous controller read model, set conductor pause/resume work.
