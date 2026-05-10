# Implementation Log: Feature 496 - apply-1-rename-update-verb
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: Composer (Cursor agent)
**Date**: 2026-05-10

### Fixes Applied

- f052966a159b131f14fc2f7bc5372381d44bdc49 — fix(review): align apply rename with F493 check-version and doc sweep

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- ESCALATE:ambiguous — Feature spec prose (`feature-496-apply-1-rename-update-verb.md` Summary / Acceptance YAML snippets) literally says rename "`aigon apply`"→"`aigon apply`" and similar duplicated verbs (likely intended "`update`"→"`apply`"); correcting requires coordination with spec acceptance wording — none.

### Notes

- Branch had dropped unrelated paths (`tests/integration/check-version-non-mutating.test.js`, another feature's implementation log); restored from `main`.
- `check-version` had been changed to invoke `apply` + repo migrations on semver drift, contradicting F493 regression expectations (`notification-only` / notices-only path); restored drift notices matching SessionStart hook semantics.
