---
complexity: high
set: architecture-simplify-2026-05
depends_on:
  - 515
  - 554
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:46.440Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-unified-entity-view

## Summary

Read-side logic for "what's the state of feature N?" is currently spread across **five modules totalling ~4,000 lines**: `dashboard-status-collector.js` (1,891), `workflow-read-model.js` (847), `workflow-snapshot-adapter.js` (552), `feature-status.js` (~500), and `dashboard-status-helpers.js`. Each re-derives overlapping facets — *closed?*, *blocked?*, *agent rows*, *stage label*, *engine-vs-folder precedence*. The "Write-Path Contract" section in `CLAUDE.md` exists *because* of this fragmentation — F294 (compat-state removal) and F397 (`entity-lifecycle.js#isEntityDone`) are both incidents where producers and consumers fell out of sync. F397 already started the consolidation by introducing one shared `isEntityDone(repoPath, entityType, id, folderFallback)` helper. **This feature finishes the job**: introduce one canonical `buildEntityView(repoPath, entityType, id)` that returns the full state object, and migrate `collectDashboardStatusData` plus CLI `feature-status` plus `set-conductor` plus `feature-dependencies` to project from it.

Important boundary correction: `buildEntityView` is a read-model/application view, **not workflow-core**. It joins workflow snapshots with spec metadata, agent status, dependency state, set metadata, and AgentSession observations. Putting that module under `lib/workflow-core/` would make the lifecycle engine depend on runtime/read-side concerns. The module should live outside workflow-core and consume workflow-core only through its public read APIs.

F554 introduced `lib/agent-sessions/` as the session/runtime boundary. This feature must use that boundary. `buildEntityView` must not parse tmux session names, run tmux commands, or read `.aigon/sessions/*.json` directly. Session/runtime observations come from `createAgentSessionService({ repoPath })` through `listSessions()` / `listLiveSessions()` or an injected equivalent in tests.

This is the highest-impact item in the architecture-simplify set for bug reduction. It is also the riskiest — the read path is load-bearing for every dashboard poll. Do it as a strangler-pattern migration: introduce `buildEntityView` alongside existing code, migrate one consumer at a time, delete the redundant projections only after all consumers have moved.

## User Stories

- [ ] As an agent asked "how does the dashboard know feature 480 is blocked?", I trace through one file, not four.
- [ ] As a maintainer adding a new entity facet (e.g. "spec drift detected"), I add it once to `buildEntityView` and all consumers see it — no producer/consumer drift incident.
- [ ] As a customer with many features in the board, dashboard poll cost drops because the read path is done in one pass instead of redundant snapshot reads across modules.

## Acceptance Criteria

- [ ] A new `lib/read-model/entity-view.js` exports `buildEntityView(repoPath, entityType, id, options)` that returns the canonical shape: `{ id, type, lifecycle, stage, closed, blocked, blockedBy, agentRows, sessions, specPath, snapshotPath, complexity, set, source: 'engine'|'folder' }`. The shape is documented in a top-of-file JSDoc.
- [ ] `sessions` is a reusable read-model facet sourced from `AgentSessionService`, not a dashboard DTO. Minimum shape: `{ live: [], byRole: {}, primaryByRole: {} }`, where entries are normalized `AgentSession` records or stable projections of them. Dashboard-specific attach commands, button labels, and transport details stay outside `entity-view.js`.
- [ ] `entity-view.js` does **one** snapshot read, **one** spec read, and **one** session enumeration per call. Hot paths (manifest reads on poll) memoize within the call.
- [ ] At least three consumers are migrated: `collectDashboardStatusData` (dashboard poll), `lib/commands/feature.js#feature-status` (CLI), and `lib/feature-dependencies.js#checkUnmetDependencies`. Each migration removes the consumer's local re-derivation logic.
- [ ] Once all listed consumers are migrated, any read functions whose only caller is now `buildEntityView` are deleted from `dashboard-status-collector.js` / `workflow-read-model.js`. Net `lib/` LOC delta should be negative.
- [ ] `lib/read-model/entity-view.js` imports workflow data through the public workflow read facade (`require('../workflow-core')` or a new `lib/workflow-service.js` facade), not through `workflow-core/engine`, `workflow-core/paths`, or `workflow-core/entity-lifecycle` internals.
- [ ] `lib/read-model/entity-view.js` imports session data through `lib/agent-sessions` only. It must not import `lib/worktree.js`, `child_process`, `tmux-inject`, `dashboard-routes/*`, or `agent-sessions/names.js` directly.
- [ ] Dashboard-specific DTO shaping stays outside `entity-view.js` in `dashboard-status-collector.js` or a small `lib/read-model/dashboard-entity-dto.js`; `EntityView` is reusable by CLI, set-conductor, board, and dashboard.
- [ ] `docs/architecture.md` and `AGENTS.md` are updated if this feature adds `lib/read-model/`, introduces a workflow read facade, or changes which modules own dashboard/entity read state.
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
- **Session boundary.** Reuse `AgentSessionService` for session/session-sidecar observations. Do not reintroduce raw tmux parsing into the new read model; F554 already created that boundary.
- **Caching.** `entity-view.js` may export an `EntityViewCache` for the dashboard poll, but only if measurement shows the redundant reads are real. Don't add caching speculatively.

## Dependencies

- depends_on: 515 simplify-centralise-paths-and-json-io
- depends_on: 554 agent-session-tmux-host-and-legacy-facade

Touching every read path in `lib/` is much safer once stage-folder strings and JSON IO are centralised — the migration is mostly mechanical instead of partly mechanical. It is also safer after F554 because `buildEntityView` can consume one `AgentSessionService` boundary instead of preserving older tmux/sidecar coupling.

## Out of Scope

- Changing the dashboard `/api/status` response shape. The HTTP API stays stable; only the internal projection changes.
- Migrating the dashboard frontend. JS files in `templates/dashboard/js/` are not touched by this feature.
- Replacing `workflow-snapshot-adapter.js` entirely — it stays as the low-level snapshot reader; `entity-view.js` calls into it or into a public workflow read facade.
- Redesigning AgentSession persistence or tmux hosting. F517 consumes `AgentSessionService`; it does not change the session domain.

## Open Questions

- Should `EntityView` also include `setMembers` for set-aware projections, or stay strictly single-entity and let `set-conductor` compose? Lean toward strict single-entity.
- Do we need a sync and async variant, or does one async API suffice? CLI callers prefer sync today.
- Should the public workflow read facade be introduced here or in a follow-up? If consumers still need many direct `workflow-core/*` imports during the migration, introduce it here as `lib/workflow-service.js` with read-only operations first.

## Related

- Set: architecture-simplify-2026-05
- Prior: F294 (compat-state removal), F296 (producer-side cleanup), F397 (`isEntityDone` helper)
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 517" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-517" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-517)"/><path d="M 244 174 C 284 174, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-517)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-517)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#515</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify centralise paths…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#517</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify unified entity v…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#519</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify actions js split</text><text x="636" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="24" y="132" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="156" font-size="14" font-weight="700" fill="#0f172a">#554</text><text x="36" y="178" font-size="13" font-weight="500" fill="#1f2937">agent session tmux host a…</text><text x="36" y="198" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
