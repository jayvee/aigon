# Implementation Log: Feature 271 - single-source-2-engine-based-read-paths
Agent: cx

## Plan
- Move lifecycle read decisions into `lib/workflow-read-model.js` so snapshot-backed numeric entities, no-ID inbox items, and legacy numeric missing-snapshot items follow one shared matrix.
- Re-bucket board items by read-model stage instead of visible folder stage.
- Make dashboard collector consume the same read-model state and surface explicit legacy/missing-workflow markers.

## Progress
- Verified the worktree was already on `feature-271-cx-single-source-2-engine-based-read-paths` and attached via `aigon feature-do 271`.
- Marked the feature as implementing with `aigon agent-status implementing`.
- Refactored `lib/workflow-read-model.js` to classify reads into three sources:
  - `workflow-snapshot`
  - `compatibility-inbox`
  - `legacy-missing-workflow`
- Changed legacy numeric entities with no snapshot to remain visible but read-only, with no synthetic lifecycle actions derived from folder position.
- Updated `lib/board.js` to scan visible specs only for discovery, then place each item into the board column derived from the read model.
- Updated `lib/dashboard-status-collector.js` to use the read model for stage resolution, action availability, and legacy/missing-workflow metadata.
- Added dashboard badges for legacy missing-workflow items in monitor and pipeline views.
- Added `tests/integration/workflow-read-model.test.js` to cover snapshot-first reads, legacy compatibility fallback, and board re-bucketing.

## Decisions
- Workflow snapshots are the authority only when a numeric entity actually has workflow state. Missing-snapshot numeric items are not silently upgraded from folder position.
- Compatibility fallback remains read-only for two cases only:
  - no-ID inbox items
  - legacy numeric items missing workflow state
- Legacy numeric items now expose explicit metadata (`readOnly`, `legacy`, `missingWorkflowState`, `readModelSource`) so downstream consumers can render warnings and suppress transitions.
- The board no longer trusts the folder it discovered an item in for display stage. It discovers specs from the filesystem, then reassigns each item to the read-model stage before rendering.
- The dashboard keeps showing legacy numeric items, but labels them `legacy` and removes transition actions until migration/backfill occurs.

## Conversation Summary
- The requested implementation was feature 271 from the existing worktree, with direct implementation rather than plan mode.
- The work focused on the spec-named files and on preserving compatibility fallback without creating workflow snapshots from reads.

## Issues Encountered
- A `git commit` initially failed because `git add` and `git commit` were launched in parallel, which created a transient index lock. Retrying the commit sequentially resolved it.
- `npm test` does not currently pass in this worktree because `tests/integration/pro-gate.test.js` already fails in the existing suite (`AIGON_FORCE_PRO "true" -> isProAvailable()=true`).

## Validation
- `node --check aigon-cli.js`
- `node --check lib/workflow-read-model.js`
- `node --check lib/board.js`
- `node --check lib/dashboard-status-collector.js`
- `node tests/integration/workflow-read-model.test.js`
- `node tests/integration/lifecycle.test.js`
- Dashboard screenshot captured after UI changes: `feature-271-dashboard.png`
- `npm test` remains blocked by the pre-existing `pro-gate` failure above
