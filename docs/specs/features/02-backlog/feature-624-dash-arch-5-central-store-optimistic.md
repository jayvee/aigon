---
complexity: high
set: dash-arch
depends_on: [623]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:19.484Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-5-central-store-optimistic

## Summary

Consolidate dashboard-owned client state into a single store module with typed mutations, a declarative localStorage persistence map, and — the core of the feature — a **generic optimistic-update overlay** that replaces the hand-rolled optimistic machinery in `templates/dashboard/js/api.js`. Today, optimistic updates are bespoke per action: `applyOptimisticEntityStart` returns a rollback closure that must re-look-up live objects because polls replace `state.data` wholesale; `reapplyPendingOptimisticEntityStarts` must re-apply pending starts after *every* snapshot replace; array identities must be manually bumped so Alpine effects fire. Three consecutive features (F522, F525, F527) each patched a hole in this design, and `applyOptimisticEntityDelete` / `closeFailedFeatures` are further one-off variants. The overlay design makes "snapshot replaced" a non-event: pending optimistic patches are *reapplied by construction* over whatever data arrives, and rollback is just deleting the patch.

## User Stories

- [ ] As a user clicking Start on a feature, the card jumps to In-Progress instantly and *stays* there across polls until the server confirms or the action fails — same UX as today, but guaranteed by architecture instead of by three layers of re-application fixes.
- [ ] As a maintainer adding an optimistic behaviour for a new action, I write one declarative patch (`{key, patch(data), settled(data)}`) instead of a rollback closure + re-apply hook + array-bump.
- [ ] As a maintainer, I can see every store-owned persisted UI preference (view, filter, collapsed repos, selected repo, pipeline settings…) in one table in one file, with its localStorage key derived consistently.

## Acceptance Criteria

- [ ] A `templates/dashboard/js/store.js` module owns: the raw state shape (everything currently in `_rawState`), the Alpine store registration, and exported mutation functions (`setView`, `setFilter`, `toggleCollapse`, `setSelectedRepo`, `toggleRepoVisibility`, `setPipelineType`, `replaceData`, …). `templates/dashboard/js/state.js` is either deleted or reduced to a compatibility shim that exposes existing globals (`state`, `lsKey`, constants) while callers are migrated.
- [ ] Direct writes to store-owned state from other modules are eliminated except inside `store.js` and any explicit compatibility shim. The feature log includes the grep/ESLint evidence used to check this, including `state.data =`, `state.pendingActions`, `state.pendingDevServerPokes`, and `state.closeFailedFeatures`.
- [ ] Persistence map: one declarative structure `{ stateKey → { lsKey, serialize, deserialize, default, migrate? } }` drives both hydration at boot and write-through on mutation for dashboard-owned preferences currently initialized in `_rawState` (`view`, `filter`, `collapsed`, `hiddenRepos`, `sidebarHidden`, `selectedRepo`, settings repo selectors, pipeline/monitor preferences, expanded pipeline columns). Legacy key migrations (`console→logs`, `submitted→complete`, legacy Pro tabs) are preserved as explicit migration entries.
- [ ] The persistence pass does not try to absorb every `localStorage`/`sessionStorage` user in the dashboard. Module-private caches and preferences with separate ownership (`logs` event cache, statistics tab state, terminal/xterm preferences, action-picker choices, PR-status `sessionStorage`, budget widget state, drawer font size, debug flags) either remain module-local or are moved only if the implementation can name a store-owned state key and preserve behavior without broadening scope.
- [ ] Optimistic overlay engine: `store.addOptimistic({ key, patch, settled, ttlMs })` where `patch(snapshotDraft)` mutates the current data draft and `settled(rawSnapshot)` returns true when the server state has caught up (e.g. entity stage is `in-progress` server-side). Engine behaviour:
  - `store.replaceData(next)` applies `applyForceProOverride(next)`, evaluates `settled()` against that raw incoming data, drops settled overlays, then applies remaining overlays before assigning the Alpine store's `data`.
  - Applied immediately to current data and re-applied automatically whenever data is replaced by poll, `/api/refresh`, or any future SSE-triggered fetch.
  - Removed when `settled()` is true, when the owning request fails (explicit `store.dropOptimistic(key)` = rollback), or when `ttlMs` expires (safety valve, default generous, e.g. 60s) without leaving stale `startupPhase` fields behind.
  - Multiple concurrent overlays compose deterministically in insertion order, with stable keys that include action, repo path, entity type, and entity id so simultaneous actions in different repos cannot collide.
- [ ] `applyOptimisticEntityStart`, `reapplyPendingOptimisticEntityStarts`, `applyOptimisticEntityDelete`, and their rollback-closure plumbing in `requestAction` are ported onto the engine and deleted. The F527 startup-phase clock (client-only `startupPhase` / `startupPhaseStartedAt` while start is in flight) is carried inside the start overlay's `patch`; server-provided `startupReadiness.phaseLabel` still wins whenever present.
- [ ] `pendingActions`, `pendingDevServerPokes`, `closeFailedFeatures` move into the store with mutation/query APIs such as `markActionPending`, `clearActionPending`, `markDevServerPokePending`, `recordCloseFailure`, and `clearCloseFailure`. Existing callers in `api.js`, `pipeline.js`, and `actions.js` use those APIs rather than mutating `Set`/`Map` instances directly.
- [ ] Array-identity bumps (`repo[entityKey] = (repo[entityKey] || []).slice()` — the F525 hack) are centralised in one store/overlay helper for entity lists that were patched. Callers never do this manually. Full removal of the need remains out of scope for dash-arch-6 keyed rendering.
- [ ] Behaviour parity validated by the existing Playwright e2e suite plus targeted new dashboard tests: optimistic start survives a poll replacing data mid-flight; failed start rolls back to backlog and clears startup phase; delete hides the card immediately; two concurrent optimistic actions on different repos/entities do not clobber one another.
- [ ] No UI/visual changes.

## Validation

```bash
npm run test:iterate
npm run test:browser
npm run lint
```

## Technical Approach

- Keep Alpine as the reactivity layer — the store module wraps `Alpine.store('dashboard', ...)` exactly as `state.js` does today; this feature is about *ownership and write discipline*, not a reactivity framework change.
- Preserve load order from `templates/dashboard/index.html`: `store.js` must be loaded before modules that read `state`, and any shim must keep existing inline-script globals working during the migration.
- The overlay engine's re-application point is a single `store.replaceData(next)` function — make it the only way any code sets dashboard status data (poll, refresh, SSE fetch). That is the architectural fix: today three call sites each remember (or forget) to call `reapplyPendingOptimisticEntityStarts`.
- `settled()` predicates run against raw incoming data *before* overlays are applied (otherwise an overlay can mask its own settlement — the F522 class of bug in reverse).
- Keep patch functions synchronous and local to dashboard data. They may mutate the draft but must not call `render()`, touch `localStorage`, make network requests, or read live DOM.
- Deliberately dumb, ~150 lines, no library. No immer, no proxies beyond Alpine's own.
- Coordinate with `startupReadiness` server phases (F527): server-provided phases always win over the client-only startup clock — preserve `markEntityStartupPhase` semantics inside the overlay.
- Restart server not needed for pure `templates/dashboard` changes, but browser verification is required. Use the dashboard e2e path and/or in-browser checks to confirm the first load, a poll refresh, and an action request still render.

## Dependencies

- depends_on: dash-arch-4-es-modules

## Out of Scope

- Keyed/diffed rendering (dash-arch-6) — this feature keeps render call patterns as-is.
- View registry / render dispatch (dash-arch-7).
- Server-side anything.
- Undo/redo, offline queueing, or cross-tab state sync.

## Open Questions

- Should overlays also cover `requestEntityNudge` / dev-server pokes (currently just pending-spinners)? Only if it falls out of the new pending mutation APIs without changing visible behavior; otherwise leave it for a follow-up.
- `state.lastStatuses` (Map) appears write-only today — verify and delete if truly unused.

## Related

- Prior work: F522 (optimistic entity start), F525 (array identity bumps for Alpine set-traps), F527 (client startup phase), F454 (fingerprint gate — removed by dash-arch-1).
- Set: dash-arch — wave 2 (client architecture: 4 → 5 → 6/7).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 624" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-624" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><path d="M 244 66 C 377 66, 491 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><path d="M 544 66 C 584 66, 584 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#623</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 4 es modules</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#624</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 5 central store…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#625</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 6 keyed card re…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="156" font-size="14" font-weight="700" fill="#0f172a">#626</text><text x="636" y="178" font-size="13" font-weight="500" fill="#1f2937">dash arch 7 view shell un…</text><text x="636" y="198" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
