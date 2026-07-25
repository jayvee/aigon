---
commit_count: 7
lines_added: 255
lines_removed: 10
lines_changed: 265
files_touched: 9
fix_commit_count: 3
fix_commit_ratio: 0.429
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
---

# Implementation Log: Feature 701 - route-interrupted-set-recovery-to-current-lane

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc (Opus 5)
**Date**: 2026-07-25

### Fixes Applied
- `37d8330c6` fix(review): never treat a lost session as addressed while a revision worker is owed
  - `lib/feature-autonomous.js` — Step 3.5's `else if (!implSessionRunning)` branch still set
    `feedbackAddressed = true` and fell through to close whenever the new revision respawn failed
    (no worktree, tmux did not start) or its attempts were already spent
    (`implRespawnAttempts >= MAX_IMPL_RESPAWN_ATTEMPTS`, with `implDeadPolls` below
    `MAX_IMPL_DEAD_POLLS`). That is exactly the outcome AC4 forbids. Guarded on
    `revisionNeedsWorker` so exhaustion terminates loudly through the existing
    `implementer-session-died` / `feedback-timeout` paths instead of closing silently.
  - `lib/agent-launch-command.js` — the newly accepted `revise` task type fell through the
    `modelKey` ternary to `'review'`, so the respawned worker launched at the reviewer model tier
    (`models.review`, opus for cc) even though it takes over the implementer's session name and
    `role: 'do'`. Routed `revise` to `'implement'`.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:ambiguous** — `implStatusAtFeedbackInject` is only seeded on the inject path
  (`lib/feature-autonomous.js`), never on the session-not-found path this feature now recovers
  from. `implStatusProgressedAfterFeedback(null, …)` returns `false`, so the
  `progressed && readyAfterFeedback` safety net (added for agents that re-signal `submitted`
  instead of `revision-complete`) is dead for every respawned revision worker. The obvious fix —
  seeding the baseline in the not-found branch — is not safe: the engine snapshot commonly still
  reports the implementer as `ready`/`implementation-complete` after a revision request, so
  `readyAfterFeedback` would be true the moment the respawned worker signals
  `addressing-code-review`, converting a working revision into a premature close. Correct
  behaviour depends on whether the engine is expected to clear the implementer's ready status on
  `code_revision_in_progress` — an interaction with the existing heuristic, not a local patch.

### Notes
- `lib/entity-ui-contract.js` (`actionIdentity` + `metadata.escalationId`) is outside the spec's
  acceptance criteria but is a real latent bug: two open escalations of any kind collide on
  `actionId:scope:entityId::` and throw `Duplicate UI contract action identity`, which would take
  down `/api/status` contract building for that feature. Verified the producer
  (`lib/feature-escalation-dashboard-actions.js`) does set `metadata.escalationId`, and that
  `projectAction` preserves `metadata`, so the fix is effective. Kept.
- `templates/dashboard/js/pipeline.js` hardcodes `summaryLane === 'paused'` rather than testing
  whether the lane has a rendered Pipeline column. This is correct for every set lifecycle today
  (`interrupted`, `paused-on-failure`, `paused-on-quota`, `stopped` all map to lane `paused` in
  `FEATURE_SET_STATE_META`, and the paused column is hidden by default), and it stays correct when
  the operator toggles the paused column on. It will need revisiting if a future set lifecycle
  projects into another lane that has no column. Left as-is.
- The inner comparison `String(memberLane) === String(currentMember.stage)` is a tautology —
  `members` are already the cards of one lane, so `members[0].stage` equals `currentMember.stage`
  whenever the current member is found. Harmless; the branch's real effect is "found here ⇒ host
  the contract here". Not changed.
- If an interrupted set has no `currentFeature`, the contract still renders nowhere and the set
  falls back to the bare lane header. Outside the AC as written; flagging for the operator.
- The Plan / Progress / Decisions sections of this log were left empty by the implementer.
