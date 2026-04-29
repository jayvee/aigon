# Research Findings: dashboard perf and state architecture

**Agent:** Gemini (gg)
**Research ID:** 47
**Date:** 2026-04-30

---

## Key Findings

### Short-Term Architecture (Current Polling Model)
I analyzed `collectRepoStatus` and the broader polling loop. The 2.5s poll floor is primarily driven by synchronous, unbatched I/O and lack of caching for active items:

1. **Unconditional Snapshot Reads:** In `collectFeatures` (`lib/dashboard-status-collector.js`), the `workflowReadModel.getFeatureDashboardState` is called for every feature ID, which in turn calls `readFeatureSnapshotSync` and `readFeatureAutoState`. This reads `.aigon/state/feature-{id}/snapshot.json` unconditionally on every poll cycle for hundreds of features, driving massive I/O.
2. **Missing mtime Caches for Active Stages:** F454 added mtime caching for `inbox`, `backlog`, `paused`, and `done` directories. However, `in-progress` and `in-evaluation` are read via `listStageSpecFiles` every poll without any `mtime` check.
3. **Sequential Repo Collection:** `collectDashboardStatusData` uses a synchronous `.forEach` to iterate over repos (`readConductorReposFromGlobalConfig().forEach(...)`). Repos are collected strictly sequentially.
4. **Unbatched Directory Listings:** `fs.readdirSync` is called separately for every stage directory. 
5. **Over-fetching:** The response payload includes full `workflowEvents` arrays and `autonomousPlan` for every active feature. Most of this data is only needed when a user expands a specific feature drawer.

### Long-Term Architecture
* **State Backend:** The filesystem is excellent for version-controlled, human-readable specs, but terrible for O(N) read queries. A pure SQLite backend loses git integration. The ideal "door" (preserving optionality) is a **CQRS Hybrid**: specifications remain in Markdown (source of truth), but all derived state (kanban stage, agent status, snapshots, events) is projected into a local SQLite database. This gives <5ms cold reads for 10k features without losing git-friendliness.
* **Transport:** Polling should be replaced by Server-Sent Events (SSE). The Aigon engine already emits `events.jsonl`; a tailer can push differential state updates to connected clients. Polling is an artifact of CLI design and does not scale to multi-user or instant-feedback dashboards.
* **Topology & Multi-user:** Moving derived state to SQL (SQLite for local, Postgres for central) naturally enables multiple dashboards (read-only mirrors) and sets the foundation for team collaboration with standard row-level authorization, keeping the daemon as a thin event-broker and API server.

## Sources

* `lib/dashboard-status-collector.js` (`collectFeatures`, `collectDashboardStatusData`)
* `lib/workflow-read-model.js` (`getBaseDashboardState`, `getFeatureDashboardState`)
* CQRS and Local-first architecture patterns (Ink & Switch)

## Recommendation

**Short-term:** We can comfortably drop the poll p95 below 500ms by introducing a snapshot `mtime` cache, parallelising repo collection, and caching active directory listings.

**Long-term:** We should adopt a CQRS Hybrid architecture. Keep specs in git-tracked Markdown, but project all engine state and derived kanban data into SQLite. Move the dashboard transport from 20s polling to SSE (Server-Sent Events) tailing the engine's event log. This preserves the local-first ethos while unlocking fast queries, multi-client sync, and a path to a central Postgres server for teams.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| perf-cache-feature-snapshots | Cache `snapshot.json` reads behind an `mtime` check in `workflowReadModel` | high | none |
| perf-parallelise-repo-collection | Convert `collectDashboardStatusData` to `Promise.all` across repos | high | none |
| perf-cache-active-dirs | Add `mtime` gates for `in-progress` and `in-evaluation` in `collectFeatures` | high | none |
| perf-trim-dashboard-payload | Strip heavy fields like `workflowEvents` from the list view payload, fetching on demand | medium | none |
| arch-sqlite-projection-layer | Introduce a background projector that mirrors filesystem state to a local SQLite db | medium | none |
| arch-sse-dashboard-transport | Replace 20s dashboard polling with Server-Sent Events driven by file watchers/event logs | medium | arch-sqlite-projection-layer |

