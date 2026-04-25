# Implementation Log: Feature 342 - review-cycle-redesign-2-code-states
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: op
**Date**: 2026-04-25

### Fixes Applied
- `04dc4040` fix(review): add missing close transitions and pass-through states for code review/revision
  - `canCloseFeature` pass-through states: added `code_review_in_progress` and `code_revision_in_progress` (old `reviewing` was pass-through but its replacements were not)
  - Feature/research workflow rules: added `feature.close`/`research.close` transitions from `code_review_in_progress` and `code_revision_in_progress` (old `reviewing` state allowed close; new states missed it — dashboard close button would appear but machine would reject)
  - `readResearchReviewState`: added `snapshot` parameter and engine-backed early returns matching `readFeatureReviewState` — all review writers now go to the engine but the research read model still read from the sidecar store (producer/read-path mismatch)

### Residual Issues
- `resolveCodeRevisionAgent` is duplicated across `engine.js`, `machine.js`, and `projector.js`. Not fixing — would require refactoring working code and introducing a shared import that doesn't currently exist.
- `isCodeRevisionComplete` in `feature-autonomous.js` checks `snapshot.currentSpecState === 'code_revision_complete'` which is dead code since `code_revision_complete` is transient and always resolves to `submitted`. The function still works via the other checks (event log + `revisionCompletedAt`). Not fixing — would be refactoring working code.
- `feature-review-state.js` sync writers (`startReviewSync`, `completeReviewSync`) are now no-ops but are still called from `workflow-read-model.js` as a legacy reconciliation fallback. This only affects features without engine-backed review state (pre-migration or `MISSING_SNAPSHOT`). After migration, the engine-backed early returns handle these cases. Not fixing — cleanup belongs in feature 3 (sidecar deletion).
- `research-review-state.js` writers were not deprecated (only `feature-review-state.js` was per spec). The research sidecar is still written to by its own sync functions but no longer by the engine-facing callers (`agent-status`, dashboard). For research features that go through the new engine paths, the sidecar will be stale but `readResearchReviewState` now reads from `snapshot.codeReview` first. Legacy research features that go through the old sidecar paths will continue to work.

### Notes
- Implementation is solid and well-structured. The three bugs were all of the same class: the `reviewing` → multi-state rename left gaps where the old single state was referenced but the new replacements were not.
- Test coverage for the new machine states and projector events is good. The existing tests were appropriately updated.
