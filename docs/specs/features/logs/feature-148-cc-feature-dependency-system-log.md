---
commit_count: 4
lines_added: 479
lines_removed: 1
lines_changed: 480
files_touched: 3
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---
# Implementation Log: Feature 148 - feature-dependency-system
Agent: cc

## Plan
- Add dependency helpers to `lib/entity.js` (buildFeatureIndex, resolveDepRef, detectCycle, rewriteDependsOn)
- Integrate into `entityPrioritise()` for feature-only dependency resolution
- Mirror canonical `dependsOn` array into coordinator manifest JSON
- Write unit tests for all dependency helpers

## Progress
- Verified `parseFrontMatter()` already handles `depends_on: [121, 126]` via `parseYamlScalar()`
- Implemented `buildFeatureIndex()` — scans all spec folders, indexes by padded/unpadded ID and slug
- Implemented `resolveDepRef()` — resolves numeric IDs, slugs, and names to canonical padded IDs
- Implemented `detectCycle()` — iterative DFS with gray/black coloring, returns full cycle path
- Implemented `rewriteDependsOn()` — rewrites frontmatter depends_on line with canonical IDs using `modifySpecFile()`
- Integrated into `entityPrioritise()`: resolve deps, reject non-existent refs, detect cycles, rewrite spec, mirror to manifest
- Added `dependsOn` field to manifest write (undefined when no deps, avoiding noise in manifest JSON)
- Wrote 15 unit tests covering all helpers — all pass
- Full test suite: 0 new failures (17 pre-existing failures unrelated to this feature)

## Decisions
- **Dependency resolution is feature-only**: research topics don't support depends_on (per spec scope)
- **Error handling during dep resolution**: non-existent refs cause hard error (return early); cycle detection also causes hard error. Parse/IO errors during dep reading are warnings (non-blocking) to avoid breaking prioritisation for unrelated issues
- **Iterative DFS over recursive**: avoids stack overflow for large graphs, uses explicit stack with parent tracking for cycle path reconstruction
- **dependsOn in manifest is undefined when empty**: avoids polluting manifest JSON for features without dependencies
- **Exported helpers for testing**: buildFeatureIndex, resolveDepRef, detectCycle, rewriteDependsOn are exported from entity.js module for direct unit testing

## Code Review

**Reviewed by**: gg (Gemini)
**Date**: 2026-03-26

### Findings
- **Inconsistent state on dependency error**: `entityPrioritise` was moving the spec file from `01-inbox` to `02-backlog` *before* validating dependencies and checking for cycles. If an error occurred (e.g., non-existent dependency or circular reference), the function returned early, leaving the file moved but uncommitted and without a manifest entry.

### Fixes Applied
- **Reordered operations in `entityPrioritise`**: Moved dependency resolution, validation, and cycle detection logic *before* the `u.moveFile` call. This ensures that the prioritisation process only proceeds if dependencies are valid.
- **Updated `rewriteDependsOn` call**: Ensured it uses the new path after the file is successfully moved.
- **Improved `featureIndex` registration**: When resolving dependencies for a new feature, its future path is correctly registered in the index to allow self-reference detection (cycles).

### Notes
- Implementation of iterative DFS for cycle detection is solid and handles cycle path reconstruction correctly via `parent` tracking.
- All unit tests in `lib/entity.test.js` pass.
