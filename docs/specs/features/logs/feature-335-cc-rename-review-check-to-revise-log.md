# Implementation Log: Feature 335 - rename-review-check-to-revise
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-24

### Fixes Applied
- `93811d8e` — `fix(review): restore revise wiring and revert unrelated regressions`

### Residual Issues
- None

### Notes
- Reverted unrelated onboarding/spec-path changes that were accidentally included in this branch.
- Restored async prerequisite-check call sites and `depends_on` frontmatter normalization.
- Updated the revise audit path and live help/docs so user-facing guidance no longer points at deleted `review-check` / `counter-review` names.
