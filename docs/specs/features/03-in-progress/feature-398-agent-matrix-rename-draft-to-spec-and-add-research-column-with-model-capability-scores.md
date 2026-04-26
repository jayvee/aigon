---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T23:29:36.169Z", actor: "cli/feature-prioritise" }
---

# Feature: Agent Matrix — Rename "draft" → "spec" and Add Research Column

## Summary

The agent capability matrix has four operation columns: `draft`, `spec_review`, `implement`, `review`. "Draft" is misleading — it actually measures spec scaffolding quality (the `feature-create --agent` / `research-create --agent` flow), not prose drafting. Rename it to `spec` for clarity.

Additionally, the matrix has no column for **research execution** (`research-do` / `ard`), even though models differ meaningfully on open-ended synthesis, web-search quality, and turning findings into actionable feature recommendations. The default model for research is already `opus` in `cc.json`, but the matrix doesn't surface why. Add a `research` column and populate it with real scores and notes for every registered model via web research before shipping.

## User Stories

- [ ] As an operator choosing a model for `research-do`, I can see a dedicated Research column in the matrix with scores and notes that explain how each model performs on synthesis and investigation tasks.
- [ ] As an operator reading the matrix, I see "Spec" (not "Draft") as the column header so the meaning is immediately clear — it's about spec scaffolding quality.

## Acceptance Criteria

- [ ] `OPERATIONS` in `lib/agent-matrix.js` reads `['spec', 'spec_review', 'implement', 'review', 'research']` — `draft` removed, `research` appended.
- [ ] `OPERATION_LABELS` maps `spec → 'Spec'` and `research → 'Research'`.
- [ ] Fallback arrays in `templates/dashboard/js/actions.js` and `templates/dashboard/js/settings.js` updated to match (these are only hit when the API is unreachable, but must stay in sync).
- [ ] `lib/matrix-apply.js` default score skeleton updated: `draft` key removed, `spec` and `research` keys present.
- [ ] `lib/spec-recommendation.js` JSDoc comment updated (operation key list on line ~95).
- [ ] Every `templates/agents/*.json` (cc, gg, cx, km, op, cu) has `notes.draft` → `notes.spec` and `score.draft` → `score.spec` in every model option.
- [ ] Every `templates/agents/*.json` has `notes.research` and `score.research` populated for every model option with real scores sourced from web research (not placeholders or nulls except for unscored/quarantined models like Kimi K2.6 where benchmarks don't exist).
- [ ] The matrix panel in the dashboard shows "Spec" and "Research" columns with populated scores. Screenshot with Playwright to verify.
- [ ] `npm test` passes.

## Validation

```bash
node -e "const m = require('./lib/agent-matrix'); console.assert(m.OPERATIONS.includes('spec'), 'spec missing'); console.assert(m.OPERATIONS.includes('research'), 'research missing'); console.assert(!m.OPERATIONS.includes('draft'), 'draft still present'); console.log('OK')"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May take Playwright screenshots when the dashboard assets are touched.

## Technical Approach

### 1. Rename `draft` → `spec` everywhere

The key is `OPERATIONS` in `lib/agent-matrix.js`. The dashboard rendering in `actions.js` and `settings.js` is fully data-driven (`ops.forEach(...)`) so no structural JS changes needed — only the fallback string arrays. All six agent JSONs need `notes.draft` → `notes.spec` and `score.draft` → `score.spec`.

### 2. Add `research` to `OPERATIONS`

Add after `review`. The dashboard table auto-adds a column. Populate `notes.research` + `score.research` in every model option across all agent JSONs.

### 3. Web research for research column scores

Before writing scores, do web research on each model's performance on **open-ended research tasks**: multi-source synthesis, connecting disparate findings, judgment about what's relevant, and ability to produce structured actionable outputs (not just "here are the links"). Useful sources:
- Official benchmark pages and blog posts (Anthropic, Google DeepMind, OpenAI, Moonshot)
- Independent evals: GAIA, WebArena, τ-bench, Agentic evals
- Community comparisons on agentic/research tasks (LMSys Arena research category, Twitter/X ML community)

Score scale 1–5. Research is about synthesis quality and judgment, not raw code ability. Expected ordering for CC: Opus 4.7 ≥ Sonnet 4.6 >> Haiku 4.5. For GG: Pro > Flash. Gap between Opus and Sonnet on research is wider than on implement.

### Files changed

| File | Change |
|------|--------|
| `lib/agent-matrix.js` | Rename `draft`→`spec` in OPERATIONS + OPERATION_LABELS; add `research` |
| `lib/matrix-apply.js` | Update default score skeleton |
| `lib/spec-recommendation.js` | Update JSDoc comment |
| `templates/dashboard/js/actions.js` | Update fallback ops array |
| `templates/dashboard/js/settings.js` | Update fallback ops array |
| `templates/agents/cc.json` | Rename draft key; add research scores (Haiku, Sonnet, Sonnet 1M, Opus, Opus 1M) |
| `templates/agents/gg.json` | Rename draft key; add research scores (Flash, Pro, Flash Preview, Flash3) |
| `templates/agents/cx.json` | Rename draft key; add research scores (all cx model options) |
| `templates/agents/km.json` | Rename draft key; add research scores (Kimi K2.6 — null if no benchmark data) |
| `templates/agents/op.json` | Rename draft key; add research scores (all op model options) |
| `templates/agents/cu.json` | Rename draft key; add research scores if applicable |

## Dependencies

- None

## Out of Scope

- Changing how `research-do` selects its model (that's `cli.models.research` in agent JSONs, already set to `opus` for cc)
- Adding a research-specific model recommendation flow
- Changing the scoring methodology or adding tooltips/legends to the matrix UI

## Open Questions

- Should `research` sit before or after `review` in column order? Proposed: append at end (`…implement, review, research`) so existing column positions don't shift for users who have memorised the layout.

## Related

- Research: none
- Set: none
