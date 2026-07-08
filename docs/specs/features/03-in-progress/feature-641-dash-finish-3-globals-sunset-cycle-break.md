---
complexity: high
set: dash-finish
depends_on: [639, 640]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T00:14:51.695Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-finish-3-globals-sunset-cycle-break

## Summary
The finale of the ES-module migration (F623 "wave 3"). With consumers on real imports (dash-finish-1) and Alpine on an explicit binding surface (dash-finish-2), nothing should resolve through the blanket `Object.assign(globalThis, …)` shims — so delete them, break the remaining `state↔api↔init`-family import cycles structurally, remove the 66 defensive `typeof fn === 'function'` guards that exist only because load order used to be uncertain, and delete the `dashboardAppGlobals` allowlist from `eslint.config.js` so lint enforces the new world (an undeclared global becomes a lint error, permanently).

## User Stories
- [ ] As a maintainer, `rg "Object.assign(globalThis" templates/dashboard/js` returns only the deliberate Alpine/bootstrap surface (or nothing), so accidental global coupling can't creep back.
- [ ] As a maintainer, eslint fails the iterate gate if new dashboard code references an undeclared global.

## Acceptance Criteria
- [ ] All blanket `Object.assign(globalThis, …)` shims are removed from `templates/dashboard/js/**`. Remaining intentional globals (if any) are the documented Alpine binding surface from dash-finish-2 and the server-swapped Pro stub exports — each with a one-line comment saying why.
- [ ] The `state↔api↔init` cycles (and any others found by a module-graph check) are broken by moving the shared pieces to their natural owner (most belong in `store.js` or a small `poll.js`), not by lazy `import()` tricks.
- [ ] `typeof fn === 'function'` existence guards that only defended against load-order gaps are removed (66 at spec time); guards that defend against genuinely optional surfaces (Pro-only hooks) stay and gain a comment.
- [ ] `dashboardAppGlobals` (eslint.config.js:109) is deleted; the dashboard eslint block declares only real environment globals (Alpine, marked, Chart, Terminal/xterm, browser). `npm run lint` passes with no new suppressions.
- [ ] Pro stubs in `templates/dashboard/stubs/` still work — they are served in place of `/js/<pro-module>.js` and may keep their own export shims; document the contract they must satisfy.
- [ ] `npm run test:deploy` passes (this is the riskiest change in the set — full gate, not just smoke).

## Validation
```bash
```

## Technical Approach
Work from the module-graph outward: run a quick import-graph scan (madge or a small script) to enumerate remaining cycles, fix each by relocating the contested export, then delete shims module-by-module with the browser console open (`aigon preview`) — a missed consumer surfaces as a ReferenceError immediately. Delete the eslint allowlist LAST so lint catches stragglers during the shim removal. Watch the two known tricky spots from the dash-arch logs: `live.js` ↔ `init.js` (`poll`, `setPollInterval`, `loadNotifications`, `showServerRestartBanner`) and `view-registry.js`'s calls into sidebar/header renderers.

## Dependencies
- depends_on: dash-finish-1-esm-real-imports
- depends_on: dash-finish-2-alpine-binding-boundary

## Out of Scope
- Introducing a bundler or build step — the no-build constraint stands.
- Rewriting string-built views as components.
- Inline style migration (dash-finish-4).

## Open Questions
- Whether to add a tiny lint-time or test-time module-graph cycle check for `templates/dashboard/js/` so cycles can't return (note: be-arch F629 builds exactly this for `lib/` — reuse its scanner if it has landed by then rather than writing a second one).

## Related
- Prior work: F623 (waves plan in its implementation log), F624 (store), F626 (view registry), F519 (actions `ctx.helpers` pattern).
- Cross-set: be-arch-1 `check-module-graph` (F629) — potential shared cycle-detection tooling.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 641" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-641" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-641)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-641)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-641)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#639</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 1 esm real im…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#640</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 2 alpine bind…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#641</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 3 globals sun…</text><text x="636" y="90" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
