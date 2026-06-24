# Implementation Log: Feature 574 - deprecate-feedback-into-research-origins
Agent: cu

## Status
Deprecated feedback CLI/dashboard surfaces; added `feedback-migrate`, research origin metadata, and idempotent migration (doctor + migration 2.68.0).
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-06-25

### Fixes Applied
- efe2bb151 fix(review): bootstrap migrated research workflow state

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Migrated research specs now use repo-scoped research ID allocation and receive workflow-core bootstrap state as part of migration, so they are immediately reachable by normal research commands.
