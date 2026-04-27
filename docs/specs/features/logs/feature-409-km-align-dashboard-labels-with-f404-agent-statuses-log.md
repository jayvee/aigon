---
commit_count: 2
lines_added: 140
lines_removed: 80
lines_changed: 220
files_touched: 17
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "km-cli"
---
# Implementation Log: Feature 409 - align-dashboard-labels-with-f404-agent-statuses
Agent: km

## Status

Complete. All dashboard rendering, server-side aggregation, notification labels, and public docs aligned with F404 canonical agent-status vocabulary.

## Key Decisions

- **Single source of truth**: Introduced `COMPLETION_STATUSES` Set and `isCompleteStatus(s)` helper in `templates/dashboard/js/pipeline.js`, used by `monitor.js`, `detail-tabs.js`, and `pipeline.js` itself. This makes the next vocabulary change a one-line edit.
- **Server-side summary renamed**: `summary.submitted` → `summary.complete` in both the server (`lib/dashboard-status-collector.js`) and client fallback. Server now aggregates all completion signals (`implementation-complete`, `revision-complete`, `research-complete`, `review-complete`, `spec-review-complete`) into the `complete` bucket.
- **localStorage migration**: One-line shim in `state.js` silently migrates persisted filter key `submitted` → `complete` on load.
- **Dead alias cleanup**: Removed `submitted`, `feedback-addressed`, and `addressing-review` from `AGENT_STATUS_META`, `NON_WORKING_AGENT_STATUSES`, `computePendingCompletionSignal`, `deriveFeatureDashboardStatus`, and the snapshot-override guard. These aliases are no longer written by the CLI (F404 remap/no-op).
- **CSS classes unchanged**: `.status-submitted`, `.submitted`, `.all-submitted` remain as internal style hooks; only user-visible label strings changed.
- **Engine event types untouched**: `submittedAt`, `byType.submitted`, `signal.agent_submitted` etc. are internal wire names; renaming them is out of scope per spec.

## Gotchas / Known Issues

- Playwright e2e could not be run because the dashboard server fails to start with a pre-existing `pro-bridge.js` null-reference (`Cannot read properties of null (reading 'register')`). This is unrelated to F409.
- Two integration tests (`submit-signal-loss.test.js`, `worktree-state-reconcile.test.js`) were already failing before any F409 edits. Confirmed by `git stash` + rerun.

## Test Coverage

- Updated `tests/integration/dashboard-review-statuses.test.js` to test `revision-complete` preservation instead of the deprecated `feedback-addressed` / `addressing-review` paths.
- Updated `tests/dashboard-e2e/state-consistency.spec.js` to assert `complete` instead of `submitted` in the `/api/status` summary shape.
- `npm test` passes: 49/51 integration tests green (2 pre-existing failures).
- Syntax validation passes for all modified JS/HTML files.
