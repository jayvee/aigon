---
complexity: high
set: architecture-simplify-2026-05
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:46.440Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-unified-entity-view

## Summary

Read-side logic for "what's the state of feature N?" is currently spread across **five modules totalling ~4,000 lines**: `dashboard-status-collector.js` (1,891), `workflow-read-model.js` (847), `workflow-snapshot-adapter.js` (552), `feature-status.js` (~500), and `dashboard-status-helpers.js`. Each re-derives overlapping facets — *closed?*, *blocked?*, *agent rows*, *stage label*, *engine-vs-folder precedence*. The "Write-Path Contract" section in `CLAUDE.md` exists *because* of this fragmentation — F294 (compat-state removal) and F397 (`entity-lifecycle.js#isEntityDone`) are both incidents where producers and consumers fell out of sync. F397 already started the consolidation by introducing one shared `isEntityDone(repoPath, entityType, id, folderFallback)` helper. **This feature finishes the job**: introduce one canonical `buildEntityView(repoPath, entityType, id)` that returns the full state object, and migrate `collectDashboardStatusData` plus CLI `feature-status` plus `set-conductor` plus `feature-dependencies` to project from it.

Important boundary correction: `buildEntityView` is a read-model/application view, **not workflow-core**. It joins workflow snapshots with spec metadata, sidecars, agent status, and optional tmux/session observations. Putting that module under `lib/workflow-core/` would make the lifecycle engine depend on runtime/read-side concerns. The module should live outside workflow-core and consume workflow-core only through its public read APIs.

This is the highest-impact item in the architecture-simplify set for bug reduction. It is also the riskiest — the read path is load-bearing for every dashboard poll. Do it as a strangler-pattern migration: introduce `buildEntityView` alongside existing code, migrate one consumer at a time, delete the redundant projections only after all consumers have moved.

## User Stories

- [ ] As an agent asked "how does the dashboard know feature 480 is blocked?", I trace through one file, not four.
- [ ] As a maintainer adding a new entity facet (e.g. "spec drift detected"), I add it once to `buildEntityView` and all consumers see it — no producer/consumer drift incident.
- [ ] As a customer with many features in the board, dashboard poll cost drops because the read path is done in one pass instead of redundant snapshot reads across modules.

## Acceptance Criteria

- [ ] A new `lib/read-model/entity-view.js` exports `buildEntityView(repoPath, entityType, id, options)` that returns the canonical shape: `{ id, type, lifecycle, stage, closed, blocked, blockedBy, agentRows, specPath, snapshotPath, complexity, set, source: 'engine'|'folder' }`. The shape is documented in a top-of-file JSDoc.
- [ ] `entity-view.js` does **one** snapshot read, **one** spec read, and **one** sidecar enumeration per call. Hot paths (manifest reads on poll) memoize within the call.
- [ ] At least three consumers are migrated: `collectDashboardStatusData` (dashboard poll), `lib/commands/feature.js#feature-status` (CLI), and `lib/feature-dependencies.js#checkUnmetDependencies`. Each migration removes the consumer's local re-derivation logic.
- [ ] Once all listed consumers are migrated, any read functions whose only caller is now `buildEntityView` are deleted from `dashboard-status-collector.js` / `workflow-read-model.js`. Net `lib/` LOC delta should be negative.
- [ ] `lib/read-model/entity-view.js` imports workflow data through the public workflow read facade (`require('../workflow-core')` or a new `lib/workflow-service.js` facade), not through `workflow-core/engine`, `workflow-core/paths`, or `workflow-core/entity-lifecycle` internals.
- [ ] Dashboard-specific DTO shaping stays outside `entity-view.js` in `dashboard-status-collector.js` or a small `lib/read-model/dashboard-entity-dto.js`; `EntityView` is reusable by CLI, set-conductor, board, and dashboard.
- [ ] `npm run test:browser` passes (board, kanban, set cards all render correctly). Add an integration test in `tests/integration/` that exercises `buildEntityView` for every entity type × every lifecycle stage.
- [ ] Dashboard poll cost (wall-clock, measured via the dashboard's existing `pollStatus` timing log) drops by ≥10% on a repo with ≥20 features. If not, the consolidation is incomplete or there's a regression.

## Validation

```bash
npm run test:core
npm run test:browser
# Bench: time dashboard /api/status before and after on a repo with many features
```

## Technical Approach

- **Strangler pattern.** Introduce `buildEntityView` alongside the existing five modules. Do not delete anything until all consumers are migrated.
- **One consumer at a time.** Order: `feature-status` (CLI, lowest blast radius) → `feature-dependencies` (medium) → `collectDashboardStatusData` (highest, last).
- **Shape lock-in.** Before migrating any consumer, write the JSDoc for the return shape and review it. Every facet a consumer needs must be in the shape; resist adding optional fields per-consumer. Keep transport/UI fields out of the canonical view unless they are genuinely reusable.
- **Engine-first.** Reuse `entity-lifecycle.js#isEntityDone` and the F397 precedence rule — `buildEntityView` never duplicates that logic, it composes.
- **Caching.** `entity-view.js` may export an `EntityViewCache` for the dashboard poll, but only if measurement shows the redundant reads are real. Don't add caching speculatively.

## Dependencies

- depends_on: simplify-centralise-paths-and-json-io

Touching every read path in `lib/` is much safer once stage-folder strings and JSON IO are centralised — the migration is mostly mechanical instead of partly mechanical.

## Out of Scope

- Changing the dashboard `/api/status` response shape. The HTTP API stays stable; only the internal projection changes.
- Migrating the dashboard frontend. JS files in `templates/dashboard/js/` are not touched by this feature.
- Replacing `workflow-snapshot-adapter.js` entirely — it stays as the low-level snapshot reader; `entity-view.js` calls into it or into a public workflow read facade.

## Open Questions

- Should `EntityView` also include `setMembers` for set-aware projections, or stay strictly single-entity and let `set-conductor` compose? Lean toward strict single-entity.
- Do we need a sync and async variant, or does one async API suffice? CLI callers prefer sync today.
- Should the public workflow read facade be introduced here or in a follow-up? If consumers still need many direct `workflow-core/*` imports during the migration, introduce it here as `lib/workflow-service.js` with read-only operations first.

## Related

- Set: architecture-simplify-2026-05
- Prior: F294 (compat-state removal), F296 (producer-side cleanup), F397 (`isEntityDone` helper)
