---
commit_count: 8
lines_added: 850
lines_removed: 612
lines_changed: 1462
files_touched: 33
fix_commit_count: 3
fix_commit_ratio: 0.375
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 25849801
output_tokens: 47492
cache_creation_input_tokens: 0
cache_read_input_tokens: 25589504
thinking_tokens: 12195
total_tokens: 25897293
billable_tokens: 25909488
cost_usd: 57.1974
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
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
