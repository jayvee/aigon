---
complexity: high
set: dash-arch
depends_on: [624]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:19.663Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-6-keyed-card-render

## Summary

Replace wholesale kanban column rebuilds with keyed, per-card reconciliation. Today `renderKanbanColCards` (pipeline.js) runs inside an Alpine `x-effect`, sets `colBody.innerHTML = ''`, and rebuilds every card in the column from scratch whenever anything in the repo's entity array changes — that's why open overflow menus snap shut, why the F454 fingerprint gate had to exist (skip render entirely or lose UI state), and why F525 had to bump array identities to force effects to re-run. With keyed rendering, a status change on one agent row updates exactly one card's DOM; unchanged cards are untouched, so transient UI state (open menus, hover, focus, drag state, scroll) survives every update. This is what makes the near-real-time updates from dash-arch-3 pleasant instead of disruptive: a board that updates every second must not rebuild itself every second.

## User Stories

- [ ] As a user with a card's ⋯ overflow menu open, a background status update on another card does not close my menu or move my scroll position.
- [ ] As a user watching a Fleet run with live push updates (dash-arch-3), only the agent row that changed repaints — no column-wide flicker, no image/icon re-fetch, no layout jump.
- [ ] As a user mid-drag of a kanban card, an incoming update doesn't yank the DOM out from under the drag.
- [ ] As a maintainer, per-card render cost is measurable: the F590 `?debug=perf` line reports how many cards were created / updated / removed per render.

## Acceptance Criteria

- [ ] A reconciler renders each kanban column: cards keyed by `entity type + ':' + stable entity key` (feature/research plus `displayKey || id || slug`; mind the slug-keyed inbox → numeric re-key at prioritise, F296 — a card whose key changes is a remove+add; acceptable). For each incoming render: new keys → create card node; departed keys → remove; surviving keys → update **only if** the card's content fingerprint changed (per-card fingerprint: the fields `buildKanbanCard` consumes — stage, name, agents/status/idle, badges, validActions, close-failure, set membership, schedule glyph…). Card DOM order matches sort order (move nodes, don't rebuild).
- [ ] Surviving-card update replaces the card's children (or the card node itself) — but never touches sibling cards, and preserves the column scroll position. An *open overflow menu on the updated card itself* may close (its data changed) — that's acceptable and should be noted in code.
- [ ] Set bundles (`pipelineGroupBySet` grouping, `kanban-set-bundle` wrappers) participate: bundle headers are keyed by set slug; members reconcile within bundles by the same card keys.
- [ ] The `x-effect` + array-identity-bump trigger mechanism is replaced by an explicit subscription: columns re-reconcile when `store.replaceData` lands or an overlay is applied (dash-arch-5's single entry point makes this clean). No `.slice()` identity bumps remain in the codebase (grep proves it).
- [ ] Monitor view: keep Alpine `x-for` (already keyed) but audit its `:key` expressions (`'f-' + feature.id + '-' + feature.name`) and heavy `x-html` spans; where a whole-card `x-html` rebuild happens on unrelated changes, apply the same per-card fingerprint short-circuit. (If the audit shows monitor is already well-behaved, record that in the feature log and leave it.)
- [ ] Drag & drop, click delegation, dev-server links, PR-status async fill-ins (`prStatusByFeature` cache), and expand/collapse ("Show more" overflow caps) all keep working — these currently rely on rebuild-time closures; convert to delegated handlers where the rebuild removal breaks them.
- [ ] Playwright e2e: existing suite green; add a test that opens an overflow menu, mutates unrelated status server-side (or via injected data), asserts the menu stays open; and a card-level update test asserting the changed card repaints while another card's DOM node is identical (`===`) before/after. Include at least one set-bundled card case so the bundle wrapper reconciliation is covered.
- [ ] MCP `browser_snapshot` of the pipeline before/after shows identical structure.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Hand-rolled keyed reconcile, not a library: ~100 lines — map of key→node on the column, walk sorted incoming cards, create/move/update/remove. `buildKanbanCard` already returns a detached card element; reuse it as the "create/update" renderer and add a cheap `cardFingerprint(entity)` alongside it.
- Per-card fingerprint replaces the *global* F454 fingerprint's UI-preservation role at finer grain (the global fingerprint was removed by dash-arch-1; the server-side version gate means renders only happen on real changes, and this feature makes those renders surgical).
- Preserve the DONE/OVERFLOW display caps (`DONE_CAP`, `OVERFLOW_CAP`, `expandedPipelineColumns`) — cap slicing happens before reconciliation, so a card scrolling out of the cap window is a keyed remove.
- Watch Alpine interplay: columns move from `x-effect` to imperative subscription, so make sure the component teardown (view switch away from pipeline) unsubscribes — the dash-arch-7 view registry will formalise this; until then, guard against duplicate subscriptions on re-entry and document the temporary subscription owner in code.
- Verify with `aigon preview` + snapshot if implemented in a worktree (CLAUDE.md hot rule #4); use `Skill(frontend-design)` only if any visual change sneaks in (there should be none).

## Dependencies

- depends_on: dash-arch-5-central-store-optimistic

## Out of Scope

- Virtualised/windowed lists — column card counts are capped and small.
- Monitor/settings/statistics view conversions (dash-arch-7 territory) beyond the monitor audit above.
- Visual redesign of cards (see `docs/card-design-wireframe.html` — unchanged canonical reference).
- Animation/FLIP transitions for card moves (nice-to-have; note as follow-up if trivial hooks fall out).

## Open Questions

- Card-node reuse vs replace on content change: replacing the whole card node on fingerprint change is simplest and probably fine (menus on *that* card close, acceptable); only go finer-grained (row-level) if e2e shows annoying focus loss on the changed card.
- Does drag-and-drop hold a reference to the dragged node across updates? If yes, suppress reconciliation of a column while a drag originating in it is active.

## Related

- Prior work: F454 (render-skip fingerprint), F525 (array identity bumps), F522/F527 (optimistic card moves this must keep smooth), F590 (perf instrumentation to extend).
- Set: dash-arch — wave 2 (client architecture: 4 → 5 → 6/7). Pairs with dash-arch-3: push makes updates frequent; this makes frequent updates cheap and non-disruptive.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 625" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-625" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-625)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-625)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#623</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 4 es modules</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#624</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 5 central store…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#625</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 6 keyed card re…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
