# Implementation Log: Feature 515 - simplify-centralise-paths-and-json-io
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
**Date**: 2026-06-16

### Fixes Applied
- 21ba665c fix(review): catch embedded stage path literals

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- FIX_NOW: The new path-literal guard only detected exact quoted folder names and missed embedded path strings such as `/03-in-progress/` or `docs/specs/features/04-in-evaluation/...`. The review fix strengthens the guard and updates the exposed embedded path literals in touched `lib/` code to use `STAGE_FOLDERS`.
