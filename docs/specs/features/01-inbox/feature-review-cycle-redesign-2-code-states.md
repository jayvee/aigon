---
complexity: high
set: review-cycle-redesign
---

# Feature: review-cycle-redesign-2-code-states

## Summary

Rename the existing `reviewing` engine state to `code_review_in_progress`, add `code_review_complete` and `code_revision_in_progress` / `code_revision_complete` states, and retarget AutoConductor to poll the engine snapshot/event log instead of the `review-complete` agent-status sidecar. This brings code review parity with the spec-review states landed in feature 1 and prepares the ground for the cycle loop in feature 3.

## User Stories

- [ ] As an operator, I want code review and code revision visible as distinct engine states (not a single `reviewing` blob) so the dashboard shows what is actually happening.
- [ ] As an implementer, I want the implementing agent automatically resolved as the owner of code revision (no manual selection on revise).
- [ ] As a maintainer, I want AutoConductor reading the engine, not the sidecar, so the next sidecar deletion (feature 3) is safe.

## Acceptance Criteria

- [ ] `reviewing` renamed to `code_review_in_progress` across `FEATURE_ENGINE_STATES`, `RESEARCH_ENGINE_STATES`, machine guards, projector cases, snapshot adapter, paths, and action registry.
- [ ] `code_review_complete`, `code_revision_in_progress`, `code_revision_complete` added to engine state tables. `*_complete` states use the `TRANSIENT_STATES` idiom from feature 1.
- [ ] `code_review_complete` `always:` routes to `code_revision_in_progress` (default — operator must address) or `submitted` (when `feature.code_review.completed` carries `requestRevision: false`).
- [ ] Owning-agent for code revision = implementing agent: solo → first key of `context.agents`; fleet → `context.winnerAgentId` if set, else `authorAgentId`.
- [ ] `FEATURE_CODE_REVIEW` and `FEATURE_CODE_REVISE` action candidates are machine-governed; eligibility derives from `currentSpecState`, not `reviewStatus` enrichment.
- [ ] AutoConductor (`lib/feature-autonomous.js`) polls `currentSpecState === 'code_revision_complete'` (or the matching event in `events.jsonl`) instead of the `review-complete` agent-status signal. The `review-complete` signal is still accepted as a synonym during the migration window.
- [ ] Sidecar `lib/feature-review-state.js` writers are deprecated (read-only mode). Reads still work; deletion happens in feature 3.
- [ ] Versioned migration rewrites legacy snapshots: `lifecycle === 'reviewing'` → `lifecycle === 'code_review_in_progress'`. Idempotent.
- [ ] Projector accepts both `feature.review_requested` (legacy) and `feature.code_review.started` (new) for one release.
- [ ] Snapshot consumers (`workflow-snapshot-adapter.js`, `dashboard-status-collector.js`, `workflow-read-model.js`) updated in lockstep — no read path silently degrades.

## Validation

```bash
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

Specific test files (new or updated):
- `tests/integration/dashboard-review-statuses.test.js` — review session shape from engine state, not enrichment.
- `tests/integration/autoconductor-code-review.test.js` (new) — AutoConductor solo loop transitions on engine state, not `review-complete` status file.
- `tests/workflow-core/projector-code-review.test.js` (new) — old + new event log produces equivalent projected state.
- `tests/integration/code-review-rename-migration.test.js` (new) — snapshot with `lifecycle: 'reviewing'` migrates idempotently.

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +50 LOC if AutoConductor retarget regression tests require it.
- May skip `npm run test:ui` for the AutoConductor-only commits (no dashboard surface change in those commits).

## Technical Approach

**Files touched:**
- `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js` — rename `reviewing`, add 3 new states, register them in `TRANSIENT_STATES` where applicable, action candidates `FEATURE_CODE_REVIEW`/`FEATURE_CODE_REVISE`.
- `lib/workflow-core/machine.js` — guards (`isCodeReviewInProgress`, `isCodeReviewComplete`, `isCodeRevisionInProgress`, `isCodeRevisionComplete`); `code_review_complete` `always:` routing.
- `lib/workflow-core/projector.js` — new event cases (`feature.code_review.started`, `.completed`; `feature.code_revision.started`, `.completed`); legacy `feature.review_requested` retained with warn.
- `lib/workflow-core/engine.js` — `applyTransition()` routes new events through XState; `canCloseFeature()` reads machine state instead of `reviewStatus` enrichment.
- `lib/workflow-core/paths.js`, `lib/workflow-snapshot-adapter.js` — extend lifecycle maps.
- `lib/feature-autonomous.js` — replace `review-complete` agent-status polling with snapshot/event polling. Keep `--stop-after=review` arg semantics; switch the detection site (cc findings §10).
- `lib/feature-review-state.js` — mark writers as deprecated; reads still publish to dashboard until feature 3 replaces them.
- `lib/migration.js` — versioned migration for `reviewing` → `code_review_in_progress`.
- `lib/commands/feature.js` — `feature-code-review` / `feature-code-revise` dispatch routes through machine.

**AutoConductor retargeting (cc findings §10):**
The Solo loop currently keys on `lib/agent-status.js review-complete` writes. The new detection reads either the latest event in `events.jsonl` or the snapshot `currentSpecState`. Bridging is a one-switch change at the polling site; both signals accepted during transition.

## Dependencies

- depends_on: review-cycle-redesign-1-spec-states

## Out of Scope

- `reviewCycles[]` projected context array — feature 3.
- `always:` loop-back from `code_revision_complete` to `code_review_in_progress` (multi-cycle) — feature 3.
- Sidecar deletion (`lib/feature-review-state.js`, `lib/research-review-state.js`) — feature 3.
- Dashboard `STATE_RENDER_META` collapse — feature 4.

## Open Questions

- Should `feature-code-review` agent-status writes still produce `review-complete` for one release (back-compat with externally-launched review agents that don't go through the engine), or should the migration force every reviewer through the engine immediately?
- AutoConductor fleet flow polls `winner_selected` via the eval file — should this also move into the engine in this feature, or stay as eval-file polling for now?

## Related

- Research: #37 State Machine & Review Cycle Redesign
- Set: review-cycle-redesign
- Prior features in set: review-cycle-redesign-1-spec-states
