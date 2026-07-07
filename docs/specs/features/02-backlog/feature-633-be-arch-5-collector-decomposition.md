---
complexity: high
set: be-arch
depends_on: [629]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:28.926Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-5-collector-decomposition

## Summary

Decompose `lib/dashboard-status-collector.js`. The AGENTS.md module map documents it at ~900 lines; it is actually **2,211** — it has more than doubled past its design and is now the read-side god module: `collectFeatures` alone is a ~480-line function (lines 768–1248), `collectResearch` (~260 lines) substantially re-implements the same enumeration/agent-row/session logic for the second entity type, and the file also owns set-card derivation, tier caching, dev-server state, GitHub remote detection, schedule metadata, feedback collection, health, and the top-level poll assembly. Meanwhile F517 created `lib/read-model/entity-view.js` precisely to be the canonical "state of entity N" answer (one snapshot read, one spec read, one session enumeration) — but the collector still derives most of this itself in parallel. This feature splits the collector into a package of focused read-model modules with an entity-agnostic core, converging on `buildEntityView` where the two derivations overlap. It also matters across sets: **dash-arch-1** (server-side status fingerprint) and **dash-arch-2** (fs-watch triggered per-repo collection) integrate against exactly this code — a decomposed collector gives those features clean seams instead of a 2,211-line merge surface.

## User Stories

- [ ] As a maintainer adding a field to feature cards, I edit one focused module (feature row building) with an obvious unit-test seam — not a 480-line function inside a 2,211-line file.
- [ ] As an implementing agent on a research-side bug, the shared enumeration logic is written once — a fix for features cannot silently miss research (the F294/F296 class of parallel-path drift).
- [ ] As the dash-arch implementer, the fingerprint (dash-arch-1) and per-repo refresh (dash-arch-2) hooks attach to a small, named assembly module.

## Acceptance Criteria

- [ ] `lib/dashboard-status-collector.js` becomes a thin assembly/facade (target ≤ ~300 lines: `collectRepoStatus`, `collectDashboardStatusData[Async]`, `refreshRepoInDashboardStatus`, `collectDashboardHealth`, re-exports for compatibility). Internals move to a `lib/dashboard-collect/` package (or `lib/read-model/` extension — pick one and document why), suggested seams from the current section structure:
  - entity-agnostic core: identity resolution, manifest reading, agent-row building (`buildFeatureAgentRow`, `buildFeatureAgentsFromSnapshot`), liveness/pending-signal computation — parameterised by entity definition (the `FEATURE_DEF`/`RESEARCH_DEF` pattern already proven in `lib/commands/entity-commands.js`);
  - per-entity thin wrappers: `collectFeatures` / `collectResearch` / `collectFeedback` become entity-def instantiations plus their genuinely-specific extras (eval status, PR/GitHub section, review sessions);
  - set cards (`buildSetDashboardCard` + helpers) → own module (it already reads like one);
  - infra probes (dev-server state, caddy routes, GitHub remote detection, tier/mtime caches) → own module;
  - the tier cache (`getTierCache`, warm/cold mtime buckets) → explicit cache module with its invalidation rules documented (dash-arch-2's watchers will need exactly this knowledge).
- [ ] Convergence on F517: where the collector re-derives what `buildEntityView` already answers (lifecycle/stage/closed/blocked/agent rows/spec path), the shared core calls or shares implementation with `entity-view.js` instead of duplicating. Dashboard-specific DTO shaping stays in the collector package (per the F517 note: "Dashboard DTO shaping stays in the collector, not here"). Document any place where full convergence is deferred and why (per-call cost across N features is the likely reason — measure before deciding; the F590 `_perf` timings are the tool).
- [ ] `/api/status` payload is **byte-identical** for a fixture repo before/after (modulo `generatedAt`): capture and diff as the parity gate. The dashboard e2e suite passes untouched.
- [ ] The read-only rule holds: no new file-format parsing enters the dashboard path — moved code keeps consuming the owner modules (`workflow-snapshot-adapter`, `agent-status`, `state-queries`, `feature-spec-resolver`, `spec-reconciliation`, `dashboard-spec-index`). Encode the collector package into the be-arch-1 boundary rules.
- [ ] Perf parity: `AIGON_DASH_TIMING=1` poll totals within noise of main for the same repos (record numbers in the log). No extra snapshot/spec reads per entity versus today (the F517 "one read each" discipline).
- [ ] Unit seams used: at least the entity-agnostic core and set-card module gain focused tests (respect T3 budget — prefer converting existing broad tests to the new seams over net-new lines).
- [ ] AGENTS.md module map updated (including correcting the stale ~900 figure and the F517 note if convergence shifts it).

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- Extract in dependency order: leaf helpers (safe reads, fingerprints, badges) → infra probes → set cards → entity core → per-entity wrappers → final facade slim-down; one commit each, payload-diff gate after each.
- The features/research duplication is the heart of the feature: build the entity-def parameterisation by diffing `collectFeatures` vs `collectResearch` line-block by line-block — every divergence is either (a) genuinely entity-specific (keep, in the wrapper), or (b) drift (unify, and note which side was right; check git blame for the feature that added one side only).
- Coordinate scheduling with dash-arch-1/2: if those land first, rebase their fingerprint/refresh hooks into the assembly module here; if this lands first, their specs get clean seams. Either order works; note the interaction in the feature log.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3); MCP `browser_snapshot` of monitor + pipeline as a final visual check (hot rule #4).

## Dependencies

- depends_on: be-arch-1-module-graph-guard

## Out of Scope

- Changing the `/api/status` payload shape (that is dash-arch territory, and even there only additively).
- Rewriting `workflow-read-model.js` / `workflow-snapshot-adapter.js` (owner modules stay as-is; only their *callers* reorganise).
- Feedback lifecycle changes (feedback stays outside the engine; its collection just moves).
- Collector performance optimisation beyond parity (watchers/versioning in dash-arch already address freshness; don't double-solve).

## Open Questions

- `lib/dashboard-status-helpers.js` (425 lines, fan-in 15) overlaps this package — fold it in or keep it as the leaf-helper module? Decide by import direction once the package shape exists.
- Whether `collectAllFeaturesLean` (F590 off-hot-path endpoint) belongs in the entity core or stays a separate lean path — measure, then decide.

## Related

- Prior work: F517 (`entity-view.js` — the canonical read model this converges on), F590 (perf timings used as the parity instrument), F294/F296/F397 (the parallel-path drift incidents that motivate single-sourcing entity logic).
- Set: be-arch — cross-set tie-in: dash-arch-1 (fingerprint) and dash-arch-2 (watch-triggered collection) integrate against the assembly module this feature creates.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 633" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-633" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-633)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#629</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 1 module graph gu…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#633</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 5 collector decom…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
