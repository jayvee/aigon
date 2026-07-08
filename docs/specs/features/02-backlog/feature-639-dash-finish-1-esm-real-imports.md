---
complexity: high
set: dash-finish
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T00:14:51.395Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-finish-1-esm-real-imports

## Summary
F623 (dash-arch-4) converted the dashboard frontend to native ES modules but stopped at "wave 1": every module still publishes its API via `Object.assign(globalThis, …)` shims (22 files) and cross-file calls are still bare globals. This feature is the deferred **wave 2**: replace bare-global consumption with real `import` statements, file by file, so each module's dependencies are explicit at the top of the file. The `globalThis` shims themselves stay for now (Alpine expressions in `index.html` and the Pro stubs still need them — sunset is dash-finish-3); this feature only changes *consumers* to imports. Also deletes the one-shot codemod helpers `scripts/dashboard-esm-migrate.js` and `scripts/dashboard-esm-fix-exports.js` that F623's log marked safe to remove.

## User Stories
- [ ] As a maintainer reading any `templates/dashboard/js/` module, I can see its full dependency list in its import block instead of guessing which bare identifiers resolve via `globalThis`.
- [ ] As a maintainer, renaming or moving an exported function breaks loudly at load time (unresolved import), not silently at click time (undefined global).

## Acceptance Criteria
- [ ] Every module under `templates/dashboard/js/` (including `js/views/` and `js/actions/`) references cross-module app functions/constants via `import { … } from './x.js'` — no reads of app identifiers off implicit globals remain in converted files.
- [ ] Import graph mirrors the `main.js` order without introducing top-level-await or execution-order regressions; `main.js`'s side-effect import list shrinks to only modules that genuinely need boot-time side effects (registration, init).
- [ ] Cycles that block a clean conversion (`state↔api↔init` family) are documented in the implementation log with the chosen interim shape (late-bound accessor, callback parameter, or `subscribeDataChange`) — breaking them structurally is dash-finish-3's job, not this one's.
- [ ] `scripts/dashboard-esm-migrate.js` and `scripts/dashboard-esm-fix-exports.js` are deleted.
- [ ] Vendored libraries, Pro stubs (`templates/dashboard/stubs/`), and the `/js/*.js` Pro asset swap URLs in `main.js` keep working exactly as before (stub vs `@aigon/pro` resolution untouched).
- [ ] `npm run test:browser` passes; interactive smoke via `aigon preview <id>` shows all eight tabs render and actions fire.

## Validation
```bash
```

## Technical Approach
Mechanical but judgment-heavy: convert leaf modules first (no dependents), then work up the graph. Where module A needs a function that lives in a cycle with A, prefer passing it as a parameter or subscribing via `store.js subscribeDataChange` over adding a new global. Do NOT delete the `Object.assign(globalThis, …)` export lines in this feature — `index.html` Alpine expressions and the eslint config still assume them; removal is sequenced in dash-finish-2/3. Keep each file's conversion an isolated commit so bisection works.

## Dependencies
-

## Out of Scope
- Deleting `globalThis` shims, the eslint `dashboardAppGlobals` allowlist (`eslint.config.js:109`), or the 66 `typeof fn === 'function'` guards — dash-finish-3.
- Alpine expression boundary in `index.html` — dash-finish-2.
- Any behaviour, layout, or CSS change.

## Open Questions
- Whether `js/actions/` lazy `import()` modules (F519) should switch their `ctx.helpers` indirection to direct imports now or stay as-is until dash-finish-3.

## Related
- Prior work: F623 (dash-arch-4-es-modules) — wave 1; its implementation log lists the deferred waves this set completes.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 639" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-639" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-639)"/><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-639)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-639)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#639</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 1 esm real im…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#640</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 2 alpine bind…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#641</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 3 globals sun…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
