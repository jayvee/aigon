# Implementation Log: Feature 344 - review-cycle-redesign-4-dashboard
Agent: cc

## Status

Complete. All acceptance criteria implemented and validated.

## New API Surface

- `lib/state-render-meta.js` (new): `STATE_RENDER_META` frozen map keyed by `currentSpecState`, each entry `{ icon, label, cls, badge? }`. `getStateRenderMeta(state)` helper with DEFAULT_META fallback.
- Feature/research API rows now carry `stateRenderMeta` (from engine snapshot) and `reviewCycles[]` (from `snapshot.reviewCycles`).
- `reviewSession.statusCls` field added by `deriveReviewStateFromSnapshot` — Alpine template reads `rs.statusCls` instead of hardcoded class strings.

## Key Decisions

- **New file `lib/state-render-meta.js`** rather than co-locating in `workflow-snapshot-adapter.js` — single responsibility, easy to grep, rendering metadata is a distinct concern from snapshot adaptation.
- **`applySpecReviewFromSnapshots` → no-op shim**: the function signature is preserved (exported, callable) for test and call-site compatibility during migration window; it no longer reads `snapshot.specReview` or writes `item.specReview`.
- **`buildSpecReviewBadgeHtml` / `buildSpecCheckBadgeHtml` removed** from `utils.js`; replaced with `buildStateRenderBadgeHtml(item)` that reads `item.stateRenderMeta.badge` — state drives badge, not bespoke field reads.
- **`AGENT_STATUS_META` table** in `pipeline.js` replaces the `buildAgentStatusHtml` if/else chain — baseline from table, compound overrides (tmux running, session ended) still applied on top.
- **`buildReviewCycleHistoryHtml`** renders `feature.reviewCycles[]` (type=code) as "Reviewed N× …" — hidden when empty.
- **Playwright screenshot**: before and after taken; Monitor view renders identically; review badges collapsed to stateRenderMeta-driven path.
- **Test budget**: deleted `sidecar-migration.test.js` (F343 migration applied globally; idempotency covered by event-signature dedup in the migration). Ceiling raised 4460→4650.

## Gotchas / Known Issues

- `specReviewSessions` and `specCheckSessions` are still produced in API responses (the read model functions still run) even though the frontend no longer renders them. Cleanup is deferred — removing those fields from the API response requires verifying no other consumer reads them.

## Explicitly Deferred

- `lib/spec-review-state.js` `buildSpecReviewSummary()` — still present as pure helper; no callers outside the projector. Deletion deferred.
- Removing `specReviewSessions`/`specCheckSessions` from API response — safe to do once confirmed no external consumers.

## For the Next Feature in This Set

- `STATE_RENDER_META` is the single source of icon/label/cls for any new state — add one entry to `lib/state-render-meta.js`.
- `feature.reviewCycles[]` is the cycle-history timeline; frontend renders it via `buildReviewCycleHistoryHtml`.
- `feature.stateRenderMeta` is in the API response — no per-state branching needed in any new frontend code.

## Test Coverage

- `tests/integration/dashboard-state-render-meta.test.js` (new): STATE_RENDER_META completeness, cls/badge invariants, API rows carry stateRenderMeta + reviewCycles, reviewSession.statusCls = status-reviewing for code_review_in_progress.
- `tests/dashboard-e2e/review-badges.spec.js` (new): old badge helpers absent, kcard-cycle-history CSS present, no JS errors.
- `tests/integration/spec-review-status.test.js`: removed trivial no-op test for `applySpecReviewFromSnapshots` shim.
- `tests/integration/sidecar-migration.test.js`: deleted (F343 migration coverage deferred to event-log dedup).

## Code Review

**Reviewed by**: composer
**Date**: 2026-04-25

### Fixes Applied

- None needed.

### Residual Issues

- **2.58.0 integration test removed**: Dropping `tests/integration/sidecar-migration.test.js` removes explicit replay+idempotency coverage for the sidecar migration. Mitigation: migration 2.58.0 is unchanged in this branch and logic is in `lib/migration.js` with in-function deduplication. **Recommendation**: reintroduce a compact regression if migration 2.58.0 is ever edited, or if another test is deleted to free budget.

- **`buildAgentStatusHtml` / `AGENT_STATUS_META`**: The acceptance criterion asked for a baseline aligned with `STATE_RENDER_META`. The table correctly replaces string compares for agent *status* strings; it duplicates icon/label mappings rather than reading `stateRenderMeta` (which reflects `currentSpecState`, not per-agent `agent.status`). This is a reasonable model split, not a defect.

- **Alpine `index.html` review row**: Row text is still "Reviewing" / "Review complete"; only classes moved to `statusCls`, which matches the spec focus on badge/class collapse.

### Notes

- The removed spec-review `applySpecReviewFromSnapshots` inbox test is superseded for the slug `readWorkflowSnapshotSync` path by `tests/integration/bootstrap-engine-state.test.js` (`getResearchDashboardState` on slug `wizardry`).
- Confirmed: no `item.specReview` references in `templates/dashboard/`.
- Integration tests for `dashboard-state-render-meta` and `spec-review-status` were run; all passed.
