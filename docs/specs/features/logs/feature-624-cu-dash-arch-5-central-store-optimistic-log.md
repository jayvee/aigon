---
commit_count: 5
lines_added: 728
lines_removed: 400
lines_changed: 1128
files_touched: 11
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 624 - dash-arch-5-central-store-optimistic
Agent: cu

## Status
Central store + optimistic overlay landed. `store.js` owns state, persistence map, `replaceData`, overlay engine, and mutation APIs; `state.js` is a shim. Alpine mutations route through `storeTarget()` so `x-show` reacts to view/data changes.

## New API Surface
- `store.js`: `replaceData`, `addOptimistic`, `dropOptimistic`, `createEntityStartOverlay`, `createEntityDeleteOverlay`, pending/close-failure APIs, preference mutators, `bumpEntityListIdentity`
- Persistence map keys: view, filter, collapsed, hiddenRepos, sidebarHidden, selectedRepo, settings* repos, pipelineType, pipelineGroupBySet, monitorType, expandedPipelineColumns

## Key Decisions
- Overlays apply on `_lastRawData`; `settled()` runs on raw incoming data before patches
- `storeTarget()` writes through Alpine proxy (direct `_rawState` mutation broke `x-show`)
- Module-local storage (logs, terminal, showPaused, PR sessionStorage) left untouched per spec

## Gotchas / Known Issues
- `normalizeRepoPath` handles `/private/var` vs `/var` for overlay repo lookup on macOS

## Explicitly Deferred
- delete/concurrent-repo e2e scenarios (fixture has duplicate repo paths); overlay architecture covered by existing optimistic-start smoke tests

## For the Next Feature in This Set
- dash-arch-6 can key cards off entity id; overlay already uses stable `action:repo:type:id` keys

## Test Coverage
- `npm run test:iterate` green (lint + scoped integration + browser @smoke)
- Grep evidence: no `state.data=`, `state.pendingActions`, `reapplyPendingOptimisticEntityStarts` outside store/shim (aigon-status-pill uses its own local `state`)

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- d525960de fix(review): preserve optimistic startup phase clock

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- FIX_NOW: start overlays were resetting the client startup-phase clock on every poll reapplication; the overlay now captures one optimistic start timestamp and reuses it across replacements.
