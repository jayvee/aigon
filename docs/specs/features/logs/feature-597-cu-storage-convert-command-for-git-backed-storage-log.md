---
commit_count: 3
lines_added: 467
lines_removed: 2
lines_changed: 469
files_touched: 5
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 597 - storage-convert-command-for-git-backed-storage
Agent: cu

## Status
Added `aigon storage convert --backend=git-ref --remote=origin` with dry-run, remote validation, idempotent rerun, and import-on-first-enable via existing sync path.
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
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- ESCALATE:ambiguous — SSH-shorthand remotes (`git@host:path`) are not matched by
  `isDirectRemote()` (no `://`, not starting with `/`, `./`, `../`), so they fall through
  to the named-remote path and `git remote get-url` fails with "remote not found". Not
  specced or tested; the documented path is named remotes (`--remote=origin`) or explicit
  URLs. Left as-is to avoid expanding remote-format handling beyond the spec.

### Notes
- Core AC (import on first enable) is correctly delegated to `createSpecStore().sync()`,
  which runs `importLocalProjectionRefs()` before `mergeAllRefs()` — verified against
  `lib/spec-store/git-ref-backend.js:183`. Convert does not reinvent the import path,
  matching the spec's Technical Approach.
- All helper imports match their module exports (projection, git-plumbing, event-merge,
  storage-config, config). Remote access (get-url + fetch + push --dry-run via a probe
  ref that is cleaned up) is validated *before* config is written, satisfying the
  "no half-convert" AC. Idempotent rerun and mismatched git-ref config both handled.
- Reported `importCount` is the pre-sync local-projection key count, a close approximation
  of what sync imports; acceptable for a status line.
- Implementation log body sections (New API Surface, Key Decisions, etc.) were left blank
  by the implementer — doc completeness, not a code issue.
