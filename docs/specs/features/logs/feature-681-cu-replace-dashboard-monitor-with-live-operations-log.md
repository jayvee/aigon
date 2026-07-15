---
commit_count: 1
lines_added: 0
lines_removed: 0
lines_changed: 0
files_touched: 0
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 681 - replace-dashboard-monitor-with-live-operations
Agent: cu

## Status
Live-operations Monitor ships behind the same `dashboard.contractCards` preview gate as F679/F680. A server-owned `monitorOperational` projection on `/api/status` classifies preview-repo entities into needs-attention, running, and recently-completed groups (2-hour retention). The browser renders a gallery-aligned queue/detail workspace via `live-monitor.js`, reusing F679 contract-card primitives for run progress, Peek, and decisions. Legacy Alpine monitor stays when preview is off.

## New API Surface
`/api/status.monitorOperational` — `{ retentionMinutes, summary, groups }` with per-item `{ key, repoPath, entityType, entityId, group, urgency, identity, activityLine, contextLine, updatedAt, contract }`. Fingerprinted in `computeStatusFingerprint` via `monitorOperationalFingerprint`.

## Key Decisions
Operational grouping is a pure read model over `uiContract` (`lib/monitor-operational-projection.js`); recovery actions alone do not imply attention — only error/warning severity, attention tones, failed/needs-attention agents, or blockers with a primary decision. Recently completed uses server retention (120 min), not a browser constant. Mobile stacks queue/detail with an explicit back control at 760px.

## Gotchas / Known Issues
Selection resets to the first queue item when the prior key disappears after refresh. Recent events in detail prefer `presentation.timeline` and `history`; many live rows still show the empty-state line until collectors populate history.

## Explicitly Deferred
Default-on Monitor and legacy removal (F682). Populating richer `history` on contracts for the detail events panel.

## For the Next Feature in This Set
F682: drop the preview gate, make live Monitor unconditional, and delete `#monitor-legacy-root` plus Alpine `monitorView` card grid. Reuse `monitorOperational` as-is — only the client toggle goes away.

## Test Coverage
`tests/unit/monitor-operational-projection.test.js` (classification + fingerprint); three new `@smoke` cases in `contract-cards-preview.spec.js` (live groups, 390px stack/back, preview-off legacy). `npm run test:iterate` green (22 smoke). Gallery unit 22/22.

## Visual check vs gallery
Composition matches gallery Monitor (summary stats, three queue sections, focus detail with run progress + events). Intentional divergence: production queue rows inline the server primary action and Peek; gallery uses static demo timestamps and hard-coded event prose.

## Code Review

**Reviewed by**: op
**Date**: 2026-07-15

### Fixes Applied
- `1d7058bb5` fix(review): action dispatch, nested buttons, and click order in live monitor
  - Action dispatch was broken: `va` was looked up from `item.contract.decisions.actions` (whose objects carry `actionId`, not `action`), then passed to `handleFeatureAction` / `handleSetAction` which read `va.action`. Every action-button click in the queue and detail dispatched `requestAction(undefined, ...)`. Fixed by looking up `va` from `entity.validActions` by `.action`, mirroring `pipeline.js`.
  - Queue items rendered a `<button class="monitor-item">` wrapping action/peek `<button>` elements — invalid nested buttons that browsers auto-close, breaking layout and event delegation. Changed to `<div role="button" tabindex="0">`.
  - Click handler order: queue-item select ran before peek/action checks, so clicking a button inside a queue item selected the item and returned instead of dispatching. Reordered to check peek/action first.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `handleFeatureAction` / `handleSetAction` are async but called without `await` in `handleLiveMonitorClick` — consistent with legacy `monitor.js`, so not changed. Unhandled rejections would surface in console.
- The `@smoke` tests don't click action buttons in the live monitor, so the dispatch bug wasn't caught. F682 (cutover) should add an action-click smoke test before removing the preview gate.

