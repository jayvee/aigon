---
commit_count: 1
lines_added: 308
lines_removed: 123
lines_changed: 431
files_touched: 7
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---
# Implementation Log: Feature 137 - unified-workflow-read-model

## Plan
- Extract a shared read-side module for workflow state/action derivation.
- Switch dashboard recommendation/valid-action plumbing to that module.
- Replace board next-action heuristics with the same shared read model and fix stale research stage mappings.
- Add focused tests that prove the board and dashboard now consume the same read-side action logic.

## Progress
- Added `lib/workflow-read-model.js` to centralize `StateContext` construction, valid/recommended action derivation, and consumer-facing action formatting.
- Updated `lib/dashboard-server.js` to use the shared read model for `nextAction`, `nextActions`, and `validActions` instead of duplicating recommendation logic.
- Updated `lib/board.js` to stop hardcoding next actions in `getBoardAction()` and to use the shared read model, including corrected research stage folder mappings (`04-in-evaluation`, `05-done`, `06-paused`).
- Added focused assertions in `aigon-cli.test.js` covering the new shared module and board behavior.
- Updated `AGENTS.md` and `docs/architecture.md` to document the new module.

## Decisions
- Kept entity discovery in the dashboard and board local for now, but centralized the read-side workflow derivation layer those consumers depend on.
- Limited the shared module to read concerns only: building state context, deriving valid/recommended actions, and formatting action suggestions.
- Treated the board’s stale research folder assumptions as part of the same feature because they directly prevented consistent consumption of the unified read model.

## User Interaction Summary
- Reviewed the feature spec after the earlier dashboard-read-only fix.
- Implemented the follow-on refactor to unify read-side action derivation across dashboard and board.
- Updated docs because the change adds a new shared module and architectural pattern.

## Validation
- `node -c lib/workflow-read-model.js`
- `node -c lib/dashboard-server.js`
- `node -c lib/board.js`
- `node -c aigon-cli.test.js`
- `node -c aigon-cli.js`
- `node aigon-cli.test.js 2>&1 | rg "inferDashboardNextActions|workflow read model|board action uses shared read model|collectDashboardStatusData does not mutate|^  ✗"`

## Issues Encountered
- The repository still has unrelated pre-existing failing tests in `aigon-cli.test.js`, so full green-suite validation was not possible.
- The shared refactor intentionally stops short of extracting all dashboard entity discovery into the new module; that remains a possible follow-up if more read-path consolidation is needed.
