---
commit_count: 5
lines_added: 558
lines_removed: 19
lines_changed: 577
files_touched: 16
fix_commit_count: 2
fix_commit_ratio: 0.4
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 584 - spec-author-provenance-recommendations
Agent: cu

## Status
Implemented immutable `specAuthor` / `lastSpecRevision` provenance, create-path stamping, dashboard cards, and spec-review/revise picker behavior.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-06-24

### Fixes Applied
- 29c850abd fix(review): restore scoped provenance changes
- a49a450ee fix(review): show spec author triplet in review picker

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Restored unrelated spec/package changes to keep the branch scoped to F584.
- Added dashboard detail provenance exposure and preserved the legacy `authorAgentId` fallback order while keeping `specAuthor` available for frontmatter-only legacy specs.
- Spec-review picker badges now include the original author model/effort when known.
