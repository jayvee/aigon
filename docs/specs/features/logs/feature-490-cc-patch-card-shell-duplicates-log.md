# Implementation Log: Feature 490 - patch-card-shell-duplicates
Agent: cc

## Status

Implementation complete. 5 defects patched; all integration tests pass; 4 smoke tests pass.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu (code review pass)  
**Date**: 2026-05-07

### Fixes Applied

- `8f8ebb54` — `fix(review): undo out-of-scope diffs and fix solo eval card routing` — Reverted unrelated branch drift (F487 spec moved to backlog with expanded scope, `development_workflow` Key Rule 5 removal, binary tarball + op-model-video output deletions). Restored those paths to match `main`. Added `hasEvalSurface` / solo branch to `isFleet` in `templates/dashboard/js/pipeline.js` so solo features in eval still use the fleet layout and the eval section is not dropped when `agents.length === 1`.

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- **ESCALATE:ambiguous** — Title row suppresses all of `buildStateRenderBadgeHtml` when `isSoloCard`. The spec calls for suppressing only lifecycle-verb duplicates of `cardHeadline.verb`, while keeping orthogonal `stateRenderMeta` badges. If product still needs those signals inline on solo cards, narrow the condition (compare meta vs headline) in a follow-up.

### Notes

- `mark-complete` E2E and overflow selectors were updated appropriately for card-level chrome on solo cards; behaviour aligns with moving mark-complete into overflow alongside other agent actions in the status row path.
