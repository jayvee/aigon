# Implementation Log: Feature 682 - complete-dashboard-ui-cutover-and-remove-legacy-renderers
Agent: cu

## Status
Production dashboard cutover complete: contract-driven Pipeline cards, responsive kanban, and live-operations Monitor are unconditional. Removed `dashboard.contractCards` settings entry, `contractCardsPreview` collector flag, legacy Alpine monitor grid, and the legacy kanban card body builder (contract path + lean done / feedback fallbacks remain).

## New API Surface
None — removed `dashboard.contractCards` and `/api/status` `contractCardsPreview`.

## Key Decisions
Monitor view uses view-registry `display` toggling (`alpineVisibility: false`) instead of Alpine `x-show`, matching other vanilla views. Non-contract kanban rows (feedback, test injections) keep a minimal presentation fallback with identity + `renderActionButtons`, not the deleted agent-section legacy builder.

## Gotchas / Known Issues
Feedback cards still lack `uiContract` and render via the presentation fallback until a future contract projector lands.

## Explicitly Deferred
Bulk deletion of unused legacy helper functions still present in `pipeline.js` (agent-section builders) — they are dead code after cutover but left for a follow-up dead-code sweep to keep the diff reviewable.

## For the Next Feature in This Set
Set `dashboard-ui-rollout` is complete. Any new state/action work follows gallery → production feature flow documented in `docs/architecture.md`.

## Test Coverage
`npm run test:iterate` green (21 smoke). Updated `contract-cards-preview.spec.js`, `close-failure-event`, `keyed-card-render`, `optimistic-start`, `view-shell`, and `monitor-operational-projection` unit tests for production-only paths.
