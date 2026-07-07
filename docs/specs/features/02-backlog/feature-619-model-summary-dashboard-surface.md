---
complexity: medium
depends_on: [618]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T01:10:59.948Z", actor: "cli/feature-prioritise" }
---

# Feature: model-summary-dashboard-surface

## Summary

Surface the curated **`summary`** field from `/api/agent-matrix` in the dashboard so operators see a visible one-line model verdict without hovering per-role score cells. Update **Settings → Agent Matrix** (headline + expand), **matrix peek** (headline), and **model dropdowns** in start/review/autonomous pickers (contextual headline + avoid warning). Read-only — all writes stay in agent JSON via maintainer / weekly recurring task.

Depends on `model-summary-registry-contract` for schema, API projection, and exemplar data.

## User Stories

- As an operator in Settings, I want each model row to show a **summary headline** under the model name so I immediately know what it is good and bad at.
- As an operator opening the matrix peek from the agent picker, I want the same headline without navigating to Settings.
- As an operator choosing a **review** model in the start modal, I want to see the summary headline and a warning when `avoidFor` includes `review`.
- As an operator, I want to expand a matrix row to read `body`, bestFor/avoidFor chips, confidence badge, and researched date.

## Acceptance Criteria

### Settings → Agent Matrix (`templates/dashboard/js/settings.js`)

- [ ] Under each `matrix-model-label`, render `row.summary.headline` when present (class `matrix-model-summary`, muted secondary text, max 2 lines ellipsis).
- [ ] When `summary` absent, show nothing (no placeholder — legacy rows unchanged).
- [ ] Row expand affordance (chevron or click row): reveals `body`, `bestFor` / `avoidFor` chips (role labels from `operationLabels`), `confidence` badge, `researchedAt` formatted date.
- [ ] `sources` render as compact link list when URLs present; `kind: aigon-bench` with `ref` only shows ref text.
- [ ] Quarantined rows: headline still visible; strikethrough model label unchanged; quarantine badge takes precedence in agent cell.
- [ ] Per-role score cell hover notes (`matrix-notes-tip`) unchanged.
- [ ] Section intro copy updated to mention summaries (one sentence).

### Matrix peek (`templates/dashboard/js/matrix-peek.js`)

- [ ] Model column shows label + headline (smaller, tertiary) when `summary.headline` present.
- [ ] No expand panel in peek (keep lightweight); full detail remains in Settings.

### Model pickers (`templates/dashboard/js/actions-picker.js` and autonomous/schedule pickers if they share model `<select>` builder)

- [ ] When building model `<option>` elements, set `option.title` to `summary.headline` when present (native tooltip).
- [ ] Below or beside the model `<select>` (start modal + review triplet + autonomous review row): render a one-line `model-summary-hint` div when selected model has `summary.headline`.
- [ ] **Contextual warn:** when current picker action is review (review agent slot or `feature-code-review` launch path) and selected model's `summary.avoidFor` includes `review`, show `model-summary-warn` with headline + "Not recommended for code review per maintainer summary."
- [ ] Hint reads from `window.AIGON_AGENTS[].modelOptions[].summary` (already loaded for pickers) — no new API route.

### Styles (`templates/dashboard/styles.css`)

- [ ] `.matrix-model-summary`, `.matrix-summary-expand`, `.matrix-summary-chips`, `.model-summary-hint`, `.model-summary-warn` — use existing design tokens; invoke `Skill(frontend-design)` before finalising.
- [ ] Screenshot verification: save to `./tmp/` after UI changes (`aigon preview` if implementing in worktree).

### Tests

- [ ] Extend dashboard smoke or add focused unit: matrix row builder includes headline when mock row has `summary` (if no DOM test exists, document manual verify in log).
- [ ] `npm run test:iterate` passes with dashboard path trigger for smoke subset.

## Validation

```bash
npm run test:iterate
# After UI edits — from main or aigon preview <id>:
# Playwright smoke or manual: Settings → Agent Matrix shows headline on cc Sonnet + op Qwen exemplars
```

## Technical Approach

1. **Data** — consume existing `/api/agent-matrix` `summary` field; for pickers, ensure `AIGON_AGENTS` bootstrap includes `summary` on each `modelOptions` entry (audit `lib/agent-registry.js` or dashboard config payload — add projection if pickers only get `{value,label}` today).
2. **Matrix table** — extend `renderMatrixTable` model cell to two-line stack; add expand row (`<tr class="matrix-summary-detail">`) toggled per model row.
3. **Pickers** — centralise `formatModelOptionLabel(opt)` → label only in `<option>` text; hint div listens to `change` on select.
4. **Action context** — pass `pickerRole: 'review' | 'implement' | null` into hint renderer from call sites (start vs code-review modal).
5. **a11y** — expand button `aria-expanded`; warn uses `role="note"`.

### Audit: picker model payload

Before coding, grep dashboard agent bootstrap (`/api/status` or settings load) for `modelOptions` shape. If `summary` is stripped, extend server DTO in `lib/agent-registry.js` `mergedModelOptions` export path or dashboard config collector — **must not** read `templates/agents/*.json` from frontend.

### Key files

| File | Change |
|------|--------|
| `templates/dashboard/js/settings.js` | matrix summary UI |
| `templates/dashboard/js/matrix-peek.js` | headline |
| `templates/dashboard/js/actions-picker.js` | hint + warn |
| `templates/dashboard/styles.css` | styles |
| `lib/agent-registry.js` or dashboard config | ensure summary in picker payload |
| `tests/dashboard-e2e/` or smoke | matrix headline visible |

## Dependencies

- `depends_on: model-summary-registry-contract` — schema + `/api/agent-matrix` + exemplars.

## Out of Scope

- Writing or editing `summary` from the dashboard (read-only).
- Weekly web research / recurring task implementation.
- Pro model-catalog-refresh command.
- Showing summary on pipeline cards or feature detail drawer.

## Open Questions

- Expand-in-table vs side drawer for summary detail? **Spec choice: inline expand row** (matches matrix density).
- Show summary on fleet multi-agent picker rows? **Defer — start/review/autonomous only in v1.**

## Related

- `model-summary-registry-contract` (blocker)
- `docs/specs/recurring/weekly-model-catalog-intelligence.md`
- F370 agent matrix, F519 matrix peek, F313 recommendation banner

## Pre-authorised

- May skip full `npm run test:browser` mid-iteration per default template; smoke runs automatically when dashboard paths change.
- Screenshot to `./tmp/` only.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 619" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-619" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-619)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#618</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">model summary registry co…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#619</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">model summary dashboard s…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
