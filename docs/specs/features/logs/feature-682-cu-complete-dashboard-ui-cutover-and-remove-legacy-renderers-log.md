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

## Code Review

**Reviewed by**: op
**Date**: 2026-07-15

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Dead helper functions remain in `pipeline.js` (lines ~378–1060: `buildAgentSectionHtml`, `buildReviewerSectionHtml`, `buildReadyToCloseHtml`, `buildCloseFailureHtml`, `buildGitHubSectionHtml`, `buildSpecReviewBlockHtml`, `buildReviewCycleHistoryHtml`, `buildAutonomousControllerStatusHtml`, `buildAutonomousPlanSectionHtml`, `buildAgentBadgesHtml`, `buildSpecAuthorHtml`, `buildStartupPhaseHtml`). These are no longer called from any card builder path. The implementer explicitly deferred bulk deletion to keep the diff reviewable — documented in § Explicitly Deferred above. The spec criterion ("legacy card builders ... are removed") is arguably satisfied for the main builder logic, but ~600 lines of dead helpers remain in production assets. Recommend a follow-up dead-code sweep.
- `scripts/check-alpine-bindings.js` lines 42–43 still check for `monitorView()` in Alpine expressions. Now dead code since `monitorView` is no longer registered as an Alpine component and no longer appears in `index.html`. Harmless (will never fire) but stale — recommend removing on the dead-code sweep.
- Non-contract fallback (`else` branch in `buildKanbanCard`) renders identity + headline + timeline + agent summary + `renderActionButtons`. For feedback cards without `uiContract` this is minimal but functional; actions remain available. `buildCardHeadlineHtml` and `buildCardAgentSummaryHtml` gracefully return empty strings when `cardPresentation`/`cardHeadline` are absent.
- No out-of-scope deletions. No dangling references to `contractCardsPreview`, `monitor-legacy-root`, `monitorView`, `isLiveMonitorEnabled`, or `hasLiveMonitorPreview` in production assets.
- `data-feature-name` attribute correctly set on cards (pipeline.js:1084), matching the updated test selectors.
- Monitor visibility correctly managed via view-registry `display` toggling (`alpineVisibility: false`); `renderLiveMonitor` manages `root.hidden` dynamically.
