---
commit_count: 1
lines_added: 126
lines_removed: 6
lines_changed: 132
files_touched: 5
fix_commit_count: 1
fix_commit_ratio: 1
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
---

# Implementation Log: Feature 744 - repair-terminal-workflow-after-legacy-bootstrap

## Status

Implemented. Ready to close.

## New API Surface

- `workflow-core.listEntityEvents(repoPath, entityType, entityId)` for lifecycle-safe diagnostics.

## Key Decisions

- Missing snapshots replay canonical events; folder placement never overwrites existing history.
- Repair only corrects a terminal regression when a prior close is followed exclusively by legacy bootstrap and lease events.

## Gotchas / Known Issues

- The dashboard smoke test used a hidden duplicate Start button; its locator now selects the visible action.

## Explicitly Deferred

- General automatic repair of ambiguous event histories.

## For the Next Feature in This Set

- None; standalone repair.

## Test Coverage

- `node tests/integration/bootstrap-engine-state.test.js` — 11 passed.
- `npm run test:iterate` — engine/integration checks passed; browser smoke exposed the unrelated hidden-button locator.
- Targeted Playwright rerun after locator correction — 1 passed.
