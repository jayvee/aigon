---
complexity: high
set: dash-arch
depends_on: [623]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:19.484Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-5-central-store-optimistic

## Summary

Consolidate client state into a single store module with typed mutations, a declarative localStorage persistence map, and — the core of the feature — a **generic optimistic-update overlay** that replaces the hand-rolled optimistic machinery in `js/api.js`. Today, optimistic updates are bespoke per action: `applyOptimisticEntityStart` returns a rollback closure that must re-look-up live objects because polls replace `state.data` wholesale; `reapplyPendingOptimisticEntityStarts` must re-apply pending starts after *every* snapshot replace; array identities must be manually bumped so Alpine effects fire. Three consecutive features (F522, F525, F527) each patched a hole in this design, and `applyOptimisticEntityDelete` / `closeFailedFeatures` are further one-off variants. The overlay design makes "snapshot replaced" a non-event: pending optimistic patches are *reapplied by construction* over whatever data arrives, and rollback is just deleting the patch.

## User Stories

- [ ] As a user clicking Start on a feature, the card jumps to In-Progress instantly and *stays* there across polls until the server confirms or the action fails — same UX as today, but guaranteed by architecture instead of by three layers of re-application fixes.
- [ ] As a maintainer adding an optimistic behaviour for a new action, I write one declarative patch (`{key, patch(data), settled(data)}`) instead of a rollback closure + re-apply hook + array-bump.
- [ ] As a maintainer, I can see every persisted UI preference (view, filter, collapsed repos, sidebar width…) in one table in one file, with its localStorage key derived consistently.

## Acceptance Criteria

- [ ] A `js/store.js` module owns: the raw state shape (everything currently in `_rawState`), the Alpine store registration, and exported mutation functions (`setView`, `setFilter`, `toggleCollapse`, `setSelectedRepo`, `toggleRepoVisibility`, `setPipelineType`, …). Direct writes to `state.*` from other modules are eliminated; ESLint or a grep check in the feature log demonstrates no stragglers.
- [ ] Persistence map: one declarative structure `{ stateKey → { lsKey, serialize, deserialize, default } }` drives both hydration at boot and write-through on mutation. All scattered `localStorage.getItem/setItem(lsKey(...))` calls in `state.js`, `init.js`, `api.js`, view modules collapse into it. Legacy key migrations (`console→logs`, `submitted→complete`, legacy Pro tabs) are preserved as explicit migration entries.
- [ ] Optimistic overlay engine: `store.addOptimistic({ key, patch, settled, ttlMs })` where `patch(snapshotDraft)` mutates a copy/draft of incoming data and `settled(snapshot)` returns true when the server state has caught up (e.g. entity stage is `in-progress` server-side). Engine behaviour:
  - Applied immediately to current data and re-applied automatically whenever `state.data` is replaced (poll, SSE-triggered fetch, `/api/refresh`).
  - Removed when `settled()` is true, when the owning request fails (explicit `store.dropOptimistic(key)` = rollback), or when `ttlMs` expires (safety valve, default generous, e.g. 60s).
  - Multiple concurrent overlays compose (start on F12 + delete on R3 simultaneously).
- [ ] `applyOptimisticEntityStart`, `reapplyPendingOptimisticEntityStarts`, `applyOptimisticEntityDelete`, and their rollback-closure plumbing in `requestAction` are ported onto the engine and deleted. The F527 startup-phase clock (client-only `startupPhase` / `startupPhaseStartedAt` while start is in flight) is carried inside the start overlay's `patch`.
- [ ] `pendingActions`, `pendingDevServerPokes`, `closeFailedFeatures` move into the store with mutation APIs (they are already state, just untyped).
- [ ] Array-identity bumps (`repo[entityKey] = (repo[entityKey] || []).slice()` — the F525 hack) are centralised: the overlay engine bumps identities for anything it patched, callers never do it manually. (Full removal of the need happens with dash-arch-6's keyed rendering; until then the engine preserves the behaviour.)
- [ ] Behaviour parity validated by the existing Playwright e2e suite plus targeted new tests: optimistic start survives a poll replacing data mid-flight; failed start rolls back to backlog; delete hides the card immediately.
- [ ] No UI/visual changes.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Keep Alpine as the reactivity layer — the store module wraps `Alpine.store('dashboard', ...)` exactly as `state.js` does today; this feature is about *ownership and write discipline*, not a reactivity framework change.
- The overlay engine's re-application point is a single `store.replaceData(next)` function — make it the only way any code sets `state.data` (poll, refresh, SSE fetch). That is the architectural fix: today three call sites each remember (or forget) to call `reapplyPendingOptimisticEntityStarts`.
- `settled()` predicates run against raw incoming data *before* overlays are applied (otherwise an overlay can mask its own settlement — the F522 class of bug in reverse).
- Deliberately dumb, ~150 lines, no library. No immer, no proxies beyond Alpine's own.
- Coordinate with `startupReadiness` server phases (F527): server-provided phases always win over the client-only startup clock — preserve `markEntityStartupPhase` semantics inside the overlay.
- Restart server not needed for pure `templates/dashboard` changes, but MCP `browser_snapshot` verification is (hot rule #4).

## Dependencies

- depends_on: dash-arch-4-es-modules

## Out of Scope

- Keyed/diffed rendering (dash-arch-6) — this feature keeps render call patterns as-is.
- View registry / render dispatch (dash-arch-7).
- Server-side anything.
- Undo/redo, offline queueing, or cross-tab state sync.

## Open Questions

- Should overlays also cover `requestEntityNudge` / dev-server pokes (currently just pending-spinners)? Only if free — the engine should make it trivial, but don't gold-plate.
- `state.lastStatuses` (Map) appears write-only today — verify and delete if truly unused.

## Related

- Prior work: F522 (optimistic entity start), F525 (array identity bumps for Alpine set-traps), F527 (client startup phase), F454 (fingerprint gate — removed by dash-arch-1).
- Set: dash-arch — wave 2 (client architecture: 4 → 5 → 6/7).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 624" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-624" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><path d="M 244 66 C 377 66, 491 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><path d="M 544 66 C 584 66, 584 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-624)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#623</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 4 es modules</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#624</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 5 central store…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#625</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 6 keyed card re…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="156" font-size="14" font-weight="700" fill="#0f172a">#626</text><text x="636" y="178" font-size="13" font-weight="500" fill="#1f2937">dash arch 7 view shell un…</text><text x="636" y="198" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
