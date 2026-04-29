# Implementation Log: Feature 448 - prioritise-dep-validate
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: composer (code-review pass)

**Date**: 2026-04-29

### Fixes Applied

- `fix(review): restore F442 spec/log and benchmark dashboard CSS from main` (`2b4f1d38`) — the branch had regressed unrelated work: feature 442’s done spec and implementation log, plus benchmark-matrix token/sort styles in `templates/dashboard/styles.css`, none of which belong to prioritise dependency validation.

### Residual Issues

- **Dependency validation catch block** (`lib/entity.js`): if reading/parsing the spec throws, the code logs a warning and continues without validating `depends_on:`. That can mask a corrupt spec and allow prioritise when validation was intended. Consider failing non-zero when `depends_on:` was expected but parsing failed (narrow exception handling).

- **Spec acceptance checklist**: the feature spec markdown still has unchecked boxes; sync when the implementer marks criteria verified.

### Notes

- Core 448 implementation (`lib/feature-deps.js`, `entityPrioritise` hook, `--skip-dep-check`, integration tests) matches the intended behaviour: block when parents are inbox or missing, allow `04-in-evaluation` / `06-paused`, error shape matches the spec’s template aside from minor wording parity.
