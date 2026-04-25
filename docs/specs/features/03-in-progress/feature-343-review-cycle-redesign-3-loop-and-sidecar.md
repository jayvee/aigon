---
complexity: high
set: review-cycle-redesign
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T23:50:03.981Z", actor: "cli/feature-prioritise" }
---

# Feature: review-cycle-redesign-3-loop-and-sidecar

## Summary

Implement the multi-cycle review loop-back via XState `always:` transition with a `requestAnotherCycle` guard, project the cycle history into `context.reviewCycles[]`, and delete the now-dead `lib/feature-review-state.js` / `lib/research-review-state.js` sidecars after replaying their history into the engine event log. After this feature, the engine is the single source of truth for review state — the sidecar files no longer exist.

## User Stories

- [ ] As an operator, after a code revision I want to choose "Another review cycle" (with reviewer picker) or "Proceed" — both as ordinary `validActions` entries on the dashboard.
- [ ] As an operator, I want the cycle history (who reviewed, when, how many cycles) visible on the dashboard timeline.
- [ ] As a maintainer, I want exactly one source of truth for review state (engine snapshot + events) — no parallel sidecar file to keep reconciled.

## Acceptance Criteria

- [ ] `code_revision_complete` `always:` block: `[{ target: 'code_review_in_progress', guard: 'anotherCycleRequested', actions: 'recordNextCycle' }, { target: 'submitted' }]`.
- [ ] `spec_revision_complete` mirrors the pattern: loop-back to `spec_review_in_progress` when `requestAnotherCycle: true`, else to `backlog`.
- [ ] `anotherCycleRequested` guard reads `event.requestAnotherCycle === true && typeof event.nextReviewerId === 'string'`.
- [ ] `recordNextCycle` effect appends to `context.reviewCycles[]` with `{ type, cycle, reviewer, startedAt, completedAt, counterStartedAt, counterCompletedAt }` and writes `context.pendingCodeReviewer` / `context.pendingSpecReviewer`.
- [ ] `code_review_in_progress` launch side-effect consumes `context.pendingCodeReviewer` to pass the next reviewer to `buildAgentLaunchInvocation`.
- [ ] Action registry exposes two distinct action candidates from `code_revision_complete` (and spec equivalent): `FEATURE_CODE_REVIEW_CYCLE` (with `requiresInput: 'agentPicker'`) and `FEATURE_PROCEED_AFTER_REVIEW`. Both fire the same `feature.code_revision.completed` event with different payloads.
- [ ] One-shot migration in `lib/migration.js` reads `review-state.json` per feature/research, synthesizes equivalent `feature.code_review.started`/`.completed` events into `events.jsonl` (idempotency check via existing event signature), then deletes the sidecar file.
- [ ] `lib/feature-review-state.js`, `lib/research-review-state.js`, `lib/workflow-read-model.js readFeatureReviewState` / `readResearchReviewState`, and `enrichSnapshotWithInfraData` review-specific fields are **deleted** after migration. Imports cleaned up.
- [ ] Snapshot consumers read `reviewCycles[]` directly; `reviewSessions` field on dashboard rows derives from `context.reviewCycles` filtered by active state.
- [ ] AutoConductor multi-cycle path: detect `code_revision_complete`, derive next action from latest event payload, no longer needs sidecar polling.

## Validation

```bash
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

Specific test files (new or updated):
- `tests/integration/review-cycle-loopback.test.js` (new) — full CLI round-trip: `feature-code-review cc` → review submitted → revise → choose-another-cycle=gg → ends in `code_review_in_progress` with reviewer gg and `reviewCycles[0..1]` populated.
- `tests/integration/sidecar-migration.test.js` (new) — pre-existing `review-state.json` with N history entries → migrated event log has N matching events; sidecar deleted; idempotent on rerun.
- `tests/workflow-core/review-cycles-projection.test.js` (new) — multi-cycle event stream → `context.reviewCycles` ordered correctly; `pendingCodeReviewer` cleared after loop-back fires.

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if multi-cycle regression tests require it.
- May delete `lib/feature-review-state.js` and `lib/research-review-state.js` outright once migration tests pass — no deprecated stub left behind (per AGENTS.md "Avoid backwards-compatibility hacks").

## Technical Approach

**Files touched:**
- `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js` — `code_revision_complete` / `spec_revision_complete` `always:` blocks; `FEATURE_CODE_REVIEW_CYCLE`, `FEATURE_PROCEED_AFTER_REVIEW`, spec equivalents.
- `lib/workflow-core/machine.js` — guard `anotherCycleRequested`; effect `recordNextCycle`.
- `lib/workflow-core/projector.js` — populate `context.reviewCycles[]` and `context.pendingCodeReviewer` / `context.pendingSpecReviewer` from events.
- `lib/workflow-core/engine.js` — extend `snapshotFromContext()` to publish `reviewCycles`; remove `reviewStatus`/`reviewSessions` enrichment hooks.
- `lib/workflow-read-model.js` — delete `readFeatureReviewState`/`readResearchReviewState`; rebuild `reviewSessions` payload from `reviewCycles[]` joined with tmux session data.
- `lib/feature-autonomous.js` — finish AutoConductor migration; multi-cycle aware.
- `lib/migration.js` — sidecar replay → engine events; sidecar deletion.
- **Delete entirely:** `lib/feature-review-state.js`, `lib/research-review-state.js`.
- `lib/dashboard-status-collector.js` — read `reviewCycles` for cycle history rendering hooks.

**Loop-back wiring (research §Q5):**
Operator triggers "Another review cycle" with agent picker → CLI/dashboard appends `feature.code_revision.completed { requestAnotherCycle: true, nextReviewerId: 'gg', at }` → projector enters `code_revision_complete` → `always:` evaluates `anotherCycleRequested` guard → matches → effect `recordNextCycle` runs → machine transitions to `code_review_in_progress` → snapshot publishes `pendingCodeReviewer: 'gg'` → launch path picks it up.

## Dependencies

- depends_on: review-cycle-redesign-2-code-states

## Out of Scope

- `STATE_RENDER_META` server-side render-meta map and dashboard frontend collapse — feature 4.
- Multi-reviewer-upfront-declaration UX (AutoConductor pre-configured cycle plan) — future research.
- Cross-feature inference of "prior cycle history" from git log — research §Agreed Design notes this is git's job, not the engine's.

## Open Questions

- For research entities, the sidecar `lib/research-review-state.js` mirror — is its data model identical enough that one shared `buildReviewCycle*` helper handles both? Or do entity-specific quirks force two implementations?
- During migration, should we preserve sidecar files as `.bak` for one release in case the migration mis-replays, or delete outright? Recommend outright deletion with a backup write to `.aigon/state/migrations-backup/` instead.

## Related

- Research: #37 State Machine & Review Cycle Redesign
- Set: review-cycle-redesign
- Prior features in set: review-cycle-redesign-1-spec-states, review-cycle-redesign-2-code-states
