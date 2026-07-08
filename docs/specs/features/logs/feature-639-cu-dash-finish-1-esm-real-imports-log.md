---
commit_count: 4
lines_added: 227
lines_removed: 275
lines_changed: 502
files_touched: 38
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 639 - dash-finish-1-esm-real-imports
Agent: cu

## Status
Wave 2 landed: cross-module dashboard calls use real `import` statements; `Object.assign(globalThis, …)` shims retained for Alpine/index.html. F623 codemod scripts removed.

## Key Decisions
- Added named `export { … }` beside every existing `globalThis` shim so importers resolve at load time.
- Moved `isCompleteStatus` to `utils.js` to break `monitor↔pipeline` cycle.
- `actions-picker↔budget-widget`: kept `typeof quotaEntryForModel/benchTooltip/…` guards (picker loads before budget widget in `main.js`).
- `js/actions/*` lazy modules still use `actions/shared.js` window bridges (open question — dash-finish-3).

## Gotchas / Known Issues
- Cycle interim (`typeof fn === 'function'` bare reads): `init↔live` (`poll`, `setPollInterval`, `connectLive`, `setHealth`), `init↔api` (`requestRefresh`, `refreshTimestamps`), `view-registry↔settings` (`renderSettings`), `close-log-panel→actions` (`handleCloseWithAgent`), Pro stubs (`fmtSyncTime`, `renderBackupSync`, `renderScheduledFeatures`). Structural break = dash-finish-3.
- `main.js` side-effect import list unchanged — boot order still mirrors F623; pruning deferred to dash-finish-3.

## Test Coverage
- `npm run test:iterate` green (lint + scoped integration + browser @smoke 14/14).
