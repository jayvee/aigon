---
commit_count: 2
lines_added: 105
lines_removed: 3
lines_changed: 108
files_touched: 3
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "km-cli"
---
# Implementation Log: Feature 418 - onboarding-demo-feature-run-on-brewboard
Agent: km

## Status
Implemented demo step in onboarding wizard.

## New API Surface
- `STEP_IDS` in `lib/onboarding/state.js` now includes `'demo'` between `'server'` and `'vault'`.
- New demo step block in `lib/onboarding/wizard.js`.

## Key Decisions
- Used `fs.existsSync` to check Brewboard path and backlog directory before attempting demo.
- Checked `claude --version` to verify agent CLI availability.
- Dynamic feature ID detection from `02-backlog/` — no hardcoded ID.
- Non-blocking on `feature-start` failure: logs warning, marks step skipped, continues to vault.

## Gotchas / Known Issues
- `feature-start` with `cc` requires `claude` binary in PATH.

## Explicitly Deferred
- Supporting agents other than `cc` for the demo.

## For the Next Feature in This Set

## Test Coverage
- Validation snippet from spec passes (`demo` index between `server` and `vault`).
- `npm test` passes (52/52 integration, 1/1 workflow-core).
