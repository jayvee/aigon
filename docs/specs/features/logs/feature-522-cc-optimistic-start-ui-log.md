# Implementation Log: Feature 522 - optimistic-start-ui
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: Composer (code review pass)  
**Date**: 2026-05-12

### Fixes Applied
- `2a86e4f0` — fix(review): keep optimistic start through status poll/refresh — periodic `/api/status` and `/api/refresh` replace `state.data`; re-apply pending `feature-start` / `research-start` stage bumps so the card stays in In-Progress until the action completes or the server advances.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Pipeline column grouping uses `entity.stage` (`templates/dashboard/js/pipeline.js`); setting `in-progress` matches the implementer’s approach.
- `stderrError` / exit-0 warning paths intentionally do not roll back optimistic state (treated as success with warnings), matching prior `requestAction` behavior.
