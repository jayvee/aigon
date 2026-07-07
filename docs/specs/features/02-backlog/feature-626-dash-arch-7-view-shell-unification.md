---
complexity: high
set: dash-arch
depends_on: [623, 624]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:19.838Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-7-view-shell-unification

## Summary

Replace the hand-rolled `render()` dispatch in `js/init.js` with a declarative view registry. Today `render()` is a 100-line if/else ladder where every branch manually `style.display`-toggles eight view containers plus sidebar/header/mobile-select — adding a view means editing every branch (the `var _ivSet/_ivSes/_ivStat/_ivAi/_ivLogs/_ivMon` pattern is the scar tissue). Views are also inconsistent about lifecycle: monitor/pipeline are Alpine components, while sessions/logs/statistics/insights/all-items/settings are ad-hoc `innerHTML` rebuilds with their own fetch logic, so switching tabs refetches and rebuilds entire views even when nothing changed. This feature introduces one `ViewRegistry` where each view declares `{ id, elementId, usesRepoSidebar, usesRepoHeader, mount, update, unmount }`, the shell derives all visibility from `store.view`, and each leaf view is migrated onto the lifecycle.

## User Stories

- [ ] As a maintainer adding a new dashboard view, I register one object and add one container div + one tab button — no edits to a dispatch ladder.
- [ ] As a user switching from Pipeline to Sessions and back, the views don't refetch/rebuild from scratch when their data hasn't changed; tab switches feel instant.
- [ ] As a user on the Sessions view, a status push (dash-arch-3) refreshes the session list data without me clicking ↺ Refresh.
- [ ] As a maintainer, every view has the same shape: I know where its fetch lives, where its render lives, and that its `unmount` cleans up timers/subscriptions.

## Acceptance Criteria

- [ ] `js/view-registry.js`: registry + shell logic. Each registry entry declares `{ id, elementId, usesRepoSidebar, usesRepoHeader, mount, update, unmount }`, and every referenced `elementId` is validated at startup with a console-visible error for missing containers. Shell responsibilities: toggle container visibility off `store.view` (single loop, no per-view branches), toggle sidebar/mobile-select/repo-header per view flags (`viewUsesRepoSidebar` logic absorbed), call `unmount(oldView)` → `mount(newView)` on switches, and route data updates (`store.replaceData` events / poll / SSE fetches) to the active view's `update(data)`.
- [ ] `render()`'s if/else ladder and the per-branch `getElementById(...).style.display` blocks in `init.js` are deleted. View-tab click handling, localStorage view persistence, unknown-view fallback to `pipeline`, and legacy view-name migrations move to store mutations (dash-arch-5's `setView`).
- [ ] Monitor and Pipeline register as views whose `mount/update` delegate to the existing Alpine components (their `x-show="$store.dashboard.view === ..."` can remain the visibility mechanism for these two — the registry entry documents that).
- [ ] Sessions view migrated fully: fetch-on-mount with cached data, `update()` refreshes on status changes (debounced — `/api/sessions` shells out to tmux), repo-filter re-render without refetch (existing `_sessionsFilterFn` mechanism replaced by the lifecycle), and `unmount` aborts in-flight requests and ignores any stale async completion from an inactive view. Module-level mutable singletons (`_sessionsFilterFn`) removed.
- [ ] Logs, All-Items, and Insights views migrated to the same lifecycle (they are small-to-medium innerHTML views; internals may stay string-built — the *lifecycle and dispatch* is what unifies).
- [ ] Settings and Statistics/Reports register in the registry with thin adapters around their existing `renderSettings()` / `renderStatistics()` internals — full internal refactor of these two (2,136 and 1,102 lines) is explicitly out of scope, but their mount/update/unmount contract must be honest (e.g. the `settingsNeedsRerender` repo-list check becomes their `update()` guard, and one-shot section navigation such as `settingsInitialSectionId` is consumed during mount/update rather than in global shell code).
- [ ] View switching preserves per-view scroll positions where views stay mounted (monitor/pipeline), matching today's behaviour.
- [ ] Keyboard/deep-link behaviours preserved: initial view from localStorage, `settingsInitialSectionId` legacy remap, toast "Logs" action buttons that jump views.
- [ ] Playwright e2e: full suite green; add a view-switch round-trip test (all 8 tabs, assert each container visible/hidden correctly, sidebar/header/mobile-select flags match the registry entry, localStorage restores the last valid view, invalid stored views fall back to `pipeline`, and no console errors occur) — this becomes the regression net the old ladder never had.
- [ ] MCP `browser_snapshot` per migrated view, with screenshots stored under `./tmp/` and not committed.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Land in two commits: (1) registry + shell with *all* views as thin adapters (pure mechanical move of the ladder, behaviour identical); (2) real lifecycle migration for sessions/logs/all-items/insights. Keeps bisectability.
- The registry is ~80 lines, not a framework: no routing library, no components, no virtual DOM. It is the same "single entry point" discipline dash-arch-5 applies to data, applied to views.
- `update(data)` should be cheap-by-default: views receive the already-version-gated snapshot (dash-arch-1 means `update` only fires on real changes), and each view may keep its own finer guard (settings repo-list check).
- Keep registry state client-local. The registry must derive from the dashboard store and existing DOM containers; it must not add server state, workflow events, or dashboard API fields.
- Audit for orphaned view containers (`backup-sync-view`, `scheduled-features-view` divs in index.html look legacy post-F236) — delete them and their references if truly dead; that's exactly the kind of cruft the registry migration should flush out.
- Coordinate with dash-arch-6 on the pipeline column subscription teardown noted there.
- MCP `browser_snapshot` after each view migration (hot rule #4); screenshots to `./tmp/` only.

## Dependencies

- depends_on: dash-arch-4-es-modules
- depends_on: dash-arch-5-central-store-optimistic

## Out of Scope

- Internal refactor of `settings.js` and `statistics.js` bodies (thin adapters only) — if the registry work reveals a clean seam, file a follow-up feature rather than expanding scope.
- Converting string-built HTML in leaf views to Alpine templates.
- URL-hash routing / shareable deep links (worth a future feature; the registry makes it easy later).
- New views or view redesigns.
- Reworking dashboard server routes, workflow-core state, or status DTO shapes for view lifecycle purposes.

## Open Questions

- Should monitor/pipeline eventually drop `x-show` in favour of registry-controlled visibility for full consistency? Decide during implementation; consistency wins if it costs nothing, but don't fight Alpine.
- Insights view is Pro-gated with async loads — confirm its loading/empty states survive the mount/update split.

## Related

- Prior work: F236 (legacy Pro tabs → settings remap the shell still carries), F294 (grid rendering for snapshotless rows — untouched, lives below view level).
- Set: dash-arch — wave 2 (client architecture: 4 → 5 → 6/7). This is the last structural client feature; 8/9 are asset-level.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 626" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-626" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-626)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-626)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-626)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#623</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 4 es modules</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#624</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 5 central store…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#626</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 7 view shell un…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
