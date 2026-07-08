---
complexity: medium
set: dash-finish
depends_on: [639]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T00:14:51.549Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-finish-2-alpine-binding-boundary

## Summary
`index.html` Alpine expressions (`x-text`, `x-html`, `x-on`, `x-data` component factories) still call bare globals (`STAGE_LABELS`, `buildAgentStatusSpan`, `monitorView()`, …) — the boundary F623's log documented as intentional-until-later. This feature makes that boundary explicit and minimal: everything Alpine needs from app code is registered through ONE module (`js/alpine-bindings.js`, which already exists as the registration point) — via `Alpine.data(...)` component factories and a single explicit bindings namespace — so the set of Alpine-reachable functions is a short, auditable list instead of "whatever happens to be on `globalThis`". This is the precondition for dash-finish-3 to delete the blanket `globalThis` shims.

## User Stories
- [ ] As a maintainer, I can open `js/alpine-bindings.js` and see the complete surface area that HTML markup can call — nothing else in the app is reachable from `index.html`.
- [ ] As a maintainer adding a new Alpine binding, I get a loud failure (lint or console error) if I reference an unregistered function, instead of a silently-dead expression.

## Acceptance Criteria
- [ ] Every function/constant referenced by an Alpine expression in `index.html` is registered explicitly in `js/alpine-bindings.js` (via `Alpine.data`, `Alpine.store`, or one exported bindings object attached under a single name, e.g. `window.aigon = { … }`), and the markup references it through that path.
- [ ] No Alpine expression in `index.html` resolves through an unregistered bare global. Verification approach documented (e.g. grep of `x-text|x-html|x-on|x-data|x-show|:class` expressions cross-checked against the registered surface).
- [ ] The registered surface is deliberately small: view component factories (`monitorView`, pipeline bindings), formatting helpers actually used in markup, and the `$store.dashboard` store — not a wholesale re-export of every module.
- [ ] `alpine:init` timing is preserved (bindings registered before Alpine processes the DOM; the `defer`-loaded vendored Alpine + module execution order relationship is documented in the log).
- [ ] `npm run test:browser` passes; `aigon preview <id>` snapshot confirms Monitor and Pipeline (the two Alpine-visibility views) render and their toggles/filters work.

## Validation
```bash
```

## Technical Approach
Inventory first: extract every identifier used in Alpine attributes in `index.html` (and any `x-` attributes in JS-built markup that Alpine re-scans). Classify: component state → `Alpine.data` factory; shared state → existing `$store.dashboard`; pure formatters → the single bindings namespace. Update markup to qualify calls where needed. Keep the diff reviewable: registration module + markup edits, no logic rewrites.

## Dependencies
- depends_on: dash-finish-1-esm-real-imports

## Out of Scope
- Deleting `Object.assign(globalThis, …)` lines from modules (dash-finish-3 — they can only go once nothing resolves through them).
- Converting string-built `innerHTML` views to Alpine templates.
- Any visual change.

## Open Questions
- Single namespace object (`window.aigon.*` in markup) vs registering each helper as an Alpine magic/directive — pick whichever keeps `index.html` expressions shortest and grep-able.

## Related
- Prior work: F623 log § "Gotchas" (documents the bare-global Alpine boundary), F626 (view-shell unification — introduced `js/alpine-bindings.js`).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 640" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-640" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-640)"/><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-640)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-640)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#639</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 1 esm real im…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#640</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 2 alpine bind…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#641</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash finish 3 globals sun…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
