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
