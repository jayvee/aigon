# Implementation Log: Feature 613 - git-branch-convert-and-git-ref-removal
Agent: cu

## Status
git-branch convert (local + legacy git-ref import/verify/lease-migrate/ref-delete); git-ref backend removed; loud config error + doctor hint. Grep survivors: `convert.js` import-only readers, `storage-config`/`doctor`/`dashboard-storage` error paths, CHANGELOG + history docs.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-07-06

### Fixes Applied
- 4cdafc565 fix(review): respect --keep-refs for local ref deletion and fix stale comments

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- **`--keep-refs` bug**: `deleteLegacyRefs` deleted local `refs/aigon/specs/*` unconditionally; `--keep-refs` only gated remote deletion. Spec AC states both are skipped. Fixed by wrapping local deletion loop in `if (!keepRefs)`.
- **Stale comments**: `lease-api.js` ("used by local and git-ref backends") and `lease-coordination.js` ("Coordinate git-ref sync") still named the removed backend, causing grep discipline failures. Fixed.
- **Grep discipline survivors (enumerated)**: `lib/spec-store/convert.js` (all `refPrefix`/`refs/aigon/specs`/`git-ref` hits — intentional import-only migration readers); `lib/spec-store/storage-config.js` (error message + raw reader); `lib/spec-store/doctor.js` (early-return error path); `lib/dashboard-storage.js` (`git-ref-removed` DTO string); `lib/spec-store/git-branch-backend.js` (three historical comparison comments explaining design rationale); `templates/dashboard/js/settings.js` and `utils.js` (`git-ref-removed` DTO handling); all `docs/specs/features/05-done/` done-spec files (historical docs); CHANGELOG.
