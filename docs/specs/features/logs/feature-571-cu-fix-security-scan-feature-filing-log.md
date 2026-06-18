# Implementation Log: Feature 571 - fix-security-scan-feature-filing
Agent: cu

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
Unit + integration tests in `tests/{unit,integration}/security-scan-feature-filing.test.js` cover backlog filing and prioritise/re-locate failure paths.

## Code Review

**Reviewed by**: cc
**Date**: 2026-06-18

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Root cause confirmed: `entityCreate` slugifies the feature's display name internally for the inbox filename, but the old code passed a separately-computed `buildFeatureSlug()` value to `feature-prioritise`, which rarely matched (verified via `resolveFeatureSlugs` unit test: legacy slug `remediate-xss-login` vs. create-time slug `remediate-xss-in-login-js`). The fix derives `createSlug` from the same `slugify(displayName)` path used by `feature-create` and uses it consistently for prioritise + re-locate, while still checking the legacy slug for duplicate-detection against specs filed before this fix.
- `createFeatureForFinding` now treats create/prioritise/re-locate as distinct steps, each with explicit failure reporting (`failed: true, step, reason`) instead of swallowing all errors into a generic `skipped`. This satisfies the spec's requirement that `feature-null` never be reported as success.
- The `AIGON_CLI_PATH` change (resolving the CLI script via `__dirname` instead of `path.join(repoPath, 'aigon-cli.js')`) is a real secondary fix — `repoPath` is the *target* repo being scanned, which won't contain `aigon-cli.js` when aigon is run against a separate project. Worth calling out since it wasn't explicitly named in the spec summary, but it's in-scope (filing pipeline) and necessary for the integration test to spawn a working `aigon-cli.js`.
- Conservative no-cleanup behavior on prioritise/re-locate failure (orphaned inbox spec left in place) matches the spec's Open Question guidance.
- Test coverage matches acceptance criteria 4 exactly: one test proves a HIGH finding reaches backlog with a numeric ID end-to-end via real CLI spawn, two tests prove the failure path never reports a created ID after prioritise/re-locate failures.
