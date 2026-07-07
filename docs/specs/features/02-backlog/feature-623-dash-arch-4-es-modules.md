---
complexity: high
set: dash-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:19.309Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-4-es-modules

## Summary

Convert the dashboard frontend from 22 load-order-dependent classic `<script>` tags (~14,500 lines, everything a global) to native ES modules with explicit `import`/`export` — **no bundler, no build step**. Today `index.html` carries a comment that says it all: *"load order matters: state → utils → api → features → views → init"*. Every function is a global; cross-module dependencies are invisible (`typeof fn === 'function'` guards, `window.__aigon*` hooks); ESLint can't fully enforce `no-undef` because the dependency graph is implicit. This feature makes the graph explicit so the later client-architecture features (store, keyed rendering, view registry) have real module boundaries to build on.

## User Stories

- [ ] As a maintainer, when I open `js/pipeline.js` I can read its imports and know exactly what it depends on, instead of grepping 21 other files for a global.
- [ ] As a maintainer, moving a function between files is safe: the import graph breaks loudly at load if I get it wrong, instead of silently rendering `undefined is not a function` at click-time.
- [ ] As a reviewer, ESLint `no-undef` now catches a typo'd function name in dashboard JS at lint time (extending the F556 work).
- [ ] As a user, the dashboard looks and behaves exactly the same — this is a pure refactor.

## Acceptance Criteria

- [ ] All files in `templates/dashboard/js/` (except vendored `js/vendor/**`) are ES modules; `index.html` loads a single entry (`<script type="module" src="/js/main.js">`) that imports the rest. The load-order comment block of script tags is gone.
- [ ] Server-injected data (`INITIAL_DATA`, `INSTANCE_NAME`, `window.__AIGON_AGENTS__`, `window.__AIGON_DEFAULT_AGENT__`) stays as the inline classic script it is today; modules read it via one small `js/injected.js` module that re-exports it — no other module touches `window.__AIGON_*` directly.
- [ ] The Pro stub-override mechanism keeps working: `templates/dashboard/stubs/*.js` (backup-sync, benchmark-matrix, insights-dashboard, pro-reports) — trace how the server chooses stub vs Pro implementation when serving these paths, and preserve that swap under ESM (the URL-based swap should survive as-is since imports resolve by URL; verify both with and without aigon-pro installed, or with `?forcePro=0`).
- [ ] Alpine integration: `monitorView` / `pipelineView` component factories and the `alpine:init` store registration are explicitly registered (e.g. `window.monitorView = ...` from a dedicated `js/alpine-bindings.js`, or `Alpine.data()` registration) — chosen mechanism documented in the file header. Alpine's CDN/vendored script and `x-data` markup keep working with `defer` + module execution order (modules are deferred by default; ensure store registration happens before Alpine starts — keep the `alpine:init` listener pattern).
- [ ] Inline `onclick`/`onmouseover` handlers in `index.html` and in string-built HTML that reference former globals are converted to event listeners or delegated handlers (grep for `onclick=`, `onmouseover=`, `window.open*` panel hooks like `window.openCloseLogPanel`, `window.finalizeCloseLogPanel`, `window.__aigonSyncStatusFingerprint`).
- [ ] Circular dependencies: `state ↔ api ↔ init` style cycles must be broken by design (e.g. `render()` currently called from `api.js` — pass callbacks, use a tiny event emitter, or import from a dispatcher module), not papered over with `window.` escape hatches. Zero `window.<fn>` cross-module calls remain except documented Alpine/DOM-attribute boundaries.
- [ ] `typeof someFn === 'function'` feature-detection guards for functions that are always present after the refactor are removed (keep only genuine Pro-optional probes).
- [ ] ESLint config for `templates/dashboard/js/**` switches to `sourceType: "module"` with `no-undef` enforced and per-file globals removed; `npm run test:core` lint stage passes.
- [ ] Module URLs carry a cache-busting version query (`/js/main.js?v=<aigon version>`) or the server sends suitable cache headers, so an `aigon` upgrade never serves a mixed old/new module graph. Match whatever `/styles.css` does today; make both consistent.
- [ ] Preview servers (`aigon preview <id>`) serve modules with a JS MIME type (`text/javascript`) — verify the static file handler's MIME map.
- [ ] Full `npm run test:browser` e2e suite passes unchanged (behaviour-identical refactor); MCP `browser_snapshot` of monitor + pipeline + settings + a spec drawer shows no regression.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Do it in one feature but as mechanical waves committed separately: (1) add exports + a `main.js` that imports everything in the old order and re-exposes needed globals; flip `index.html` to the module entry; verify. (2) File-by-file, replace global references with imports and delete the re-exposure shims. (3) Break the cycles, remove `window.` bridges, tighten lint. This keeps every intermediate commit green.
- `js/state.js` currently mixes constants, localStorage reads, and the Alpine store bootstrap — keep its contents intact here; restructuring state is dash-arch-5's job. Only its module surface changes.
- Watch for `let state` rebinding on `alpine:init` (`state = Alpine.store('dashboard')`): ESM live bindings export the *binding*, so `export let state` + reassignment works for importers — but be explicit and add a comment; this is the one subtle ESM semantics point in the codebase.
- No import maps, no TypeScript, no bundler — native ESM only, consistent with Aigon's zero-build philosophy and the vendored-xterm precedent.
- The dashboard HTML is a template processed by `buildDashboardHtml` (`${INITIAL_DATA}` substitution) — confirm `processTemplate`/builder doesn't mangle `import` syntax or `?v=` queries.

## Dependencies

- None hard. Strongly recommended to land after dash-arch-1 (its client-side changes are small) and before dash-arch-5/6/7 which build on module boundaries. Coordinate with any in-flight dashboard features to avoid mega-conflicts — this touches every JS file's top and bottom.

## Out of Scope

- Any behavioural change, state restructuring (dash-arch-5), render changes (dash-arch-6/7), or CSS work (dash-arch-9).
- Bundlers, minification, TypeScript, JSX, import maps.
- Vendored libraries under `js/vendor/**` (xterm) — untouched.

## Open Questions

- `stubs/` swap mechanism: confirm whether Pro overrides are served at the same URL (server-side path resolution) or injected differently — the acceptance criterion stands either way, but the implementation must follow the actual mechanism found.
- Whether `logs.js`, `statistics.js`, `settings.js` share functions today via accidental global reuse (e.g. `buildInsightsMetricsSection` used from `init.js`) — expect to discover and make several of these dependencies explicit; list them in the feature log as they're found.

## Related

- Prior work: F556 (ESLint no-undef groundwork), the js/ split from the original monolithic index.html.
- Set: dash-arch — wave 2 (client architecture: 4 → 5 → 6/7).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 623" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-623" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-623)"/><path d="M 244 66 C 377 66, 491 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-623)"/><path d="M 544 66 C 584 66, 584 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-623)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-623)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#623</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 4 es modules</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#624</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 5 central store…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#625</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 6 keyed card re…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="156" font-size="14" font-weight="700" fill="#0f172a">#626</text><text x="636" y="178" font-size="13" font-weight="500" fill="#1f2937">dash arch 7 view shell un…</text><text x="636" y="198" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
