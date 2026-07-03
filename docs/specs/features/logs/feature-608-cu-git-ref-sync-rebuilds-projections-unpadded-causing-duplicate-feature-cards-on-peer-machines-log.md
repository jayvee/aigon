---
commit_count: 4
lines_added: 165
lines_removed: 4
lines_changed: 169
files_touched: 5
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 608 - git-ref-sync-rebuilds-projections-unpadded-causing-duplicate-feature-cards-on-peer-machines
Agent: cu

## Status
Pad feature ids when normalizing git-ref keys (`F1`→`01`); numeric-equivalent dedup in `collectFeatures` for legacy unpadded dirs.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-07-03

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Producer fix is correctly scoped to the string-ref branch of `normalizeEntityRef`
  (the peer-rebuild path where `projectionRefForKey` returns the bare key `F1`). The
  object-ref branch — already-padded ids read from disk via `listNumericProjectionRefs`
  — is left untouched, so there is no double-transform.
- `padFeatureEntityId` correctly no-ops for research (`entityType !== 'feature'`),
  non-numeric slugs, and ids already ≥2 digits (`608`→`608`); pads single-digit
  (`F1`→`01`) and preserves multi-digit (`F10`→`10`).
- Read-side `workflowFeatureIdsCovers` matches by numeric equivalence, so a legacy
  unpadded `1` dir dedupes against a padded `01` spec without a migration. Non-numeric
  inbox/slug ids fall through to exact match — no risk of falsely deduping distinct
  features (feature ids are numerically unique).
- Both new tests use real, exported helpers (`_readCanonicalEvents`, `clearTierCache`,
  `collectRepoStatus`, `readEventsSync`) and assert both ACs: padded rebuild path on the
  peer and single deduped `collectFeatures` row. Wiring verified; not executed per policy.
