---
complexity: medium
depends_on: []
---

# Feature: model-summary-registry-contract

## Summary

Add a first-class **`summary`** object to every curated `cli.modelOptions` entry in `templates/agents/*.json` — the operator-facing qualitative verdict ("great for code review, weak on deep spec work") distinct from per-role `notes` / `score`. Wire the contract through `docs/model-inclusion-policy.md`, `validateModelOptions`, and `/api/agent-matrix` so dashboard and maintainer tooling can read it. Seed **two exemplar summaries** on flagship models (`cc` Sonnet, `op` Qwen3 235B) as shape references for the weekly `weekly-model-catalog-intelligence` recurring task.

This is the **data + API foundation**. UI surfacing is feature `model-summary-dashboard-surface`. Population at scale is the recurring template `docs/specs/recurring/weekly-model-catalog-intelligence.md` (Pro scheduler + maintainer review gate).

## User Stories

- As an operator, I want each model in the registry to carry a short **headline** and structured **bestFor / avoidFor** roles so I do not have to read five matrix cells to learn what a model is for.
- As a maintainer running the weekly catalog task, I want a **validated JSON shape** for `summary` so research output can be merged without ad-hoc fields.
- As the dashboard read path, I want `/api/agent-matrix` rows to include `summary` verbatim from agent JSON so the frontend never parses template files directly.

## Acceptance Criteria

### Schema

- [ ] Document `summary` in `docs/model-inclusion-policy.md` §5 (Lifecycle requirements) with the shape below. `summary` is **optional** on legacy rows until the weekly task backfills; **required** on any **new** model added after this feature ships.
- [ ] Shape (all fields documented in policy):

```json
"summary": {
  "headline": "string, ≤120 chars, role-opinionated",
  "body": "string, ≤500 chars, evidence-backed",
  "bestFor": ["implement" | "review" | "spec" | "spec_review" | "research"],
  "avoidFor": ["implement" | "review" | "spec" | "spec_review" | "research"],
  "confidence": "high" | "medium" | "low",
  "researchedAt": "ISO-8601",
  "sources": [
    { "kind": "aigon-bench" | "benchmark" | "community" | "provider", "title": "string", "url": "string optional", "ref": "string optional" }
  ]
}
```

- [ ] `bestFor` / `avoidFor` use Aigon role vocabulary only (same five keys as matrix operations). No free-form tags like "planning".
- [ ] `headline` must not duplicate `label`. `body` may reference benchmarks but must not contradict `quarantined.reason` when quarantined.

### Validation (`lib/agent-registry.js`)

- [ ] Extend `validateModelOptions(agentConfig)`:
  - If `summary` present: require `headline`, `confidence`, `researchedAt`; validate `confidence` enum; validate `bestFor`/`avoidFor` arrays contain only known roles; warn (not fail) if `sources` empty when `confidence === 'high'`.
  - Reject `summary` on `archived` entries only if `headline` missing when archived block has no reason (soft — prefer warn).
  - Headline length >120 → validation error.
- [ ] `tests/integration/agent-registry-contract.test.js` covers: valid summary passes; missing headline fails; invalid role in `bestFor` fails; exemplar entries in `cc.json` / `op.json` pass.

### Read model

- [ ] `lib/agent-matrix.js` `buildMatrix()` includes `summary: opt.summary || null` on each `MatrixRow` (update JSDoc).
- [ ] `GET /api/agent-matrix` response rows expose `summary` without transformation (dashboard DTO stays server-owned via matrix module).
- [ ] No change to dashboard frontend in this feature.

### Seed data (exemplars only)

- [ ] Add complete `summary` to **one** `cc` model with full per-role notes (e.g. `claude-sonnet-4-6`) — headline reflects balanced implement/review strength.
- [ ] Add complete `summary` to **one** `op` model (`openrouter/qwen/qwen3-235b-a22b-07-25`) — headline reflects value implement/review, avoid spec/research.
- [ ] Do **not** bulk-backfill all models; weekly recurring task owns scale population.

### Docs

- [ ] `AGENTS.md` Agent registry / model policy pointer mentions `summary` in one sentence (or defer to model-inclusion-policy only — prefer policy as SSOT).
- [ ] `CHANGELOG.md` entry under Added.

## Validation

```bash
npm run test:quick
node -e "
const m = require('./lib/agent-matrix');
const r = m.buildMatrix().find(x => x.modelValue === 'claude-sonnet-4-6');
if (!r?.summary?.headline) throw new Error('cc exemplar missing summary');
const op = m.buildMatrix().find(x => x.modelValue && x.modelValue.includes('qwen3-235b'));
if (!op?.summary?.headline) throw new Error('op exemplar missing summary');
console.log('ok');
"
```

## Technical Approach

1. **Policy** — append §5 bullet for `summary`; add confidence ladder cross-ref to recurring template.
2. **`validateModelOptions`** — add `validateSummary(opt, where)` helper; keep errors actionable (`[op] modelOptions "…": summary.headline exceeds 120 chars`).
3. **`agent-matrix.js`** — one-line projection; no scoring logic in matrix (summary is curated, not derived).
4. **Exemplars** — hand-write summaries consistent with existing `notes`/`score` on those rows; `researchedAt` = ship date; `confidence: medium` until weekly task upgrades with sources.
5. **Tests** — contract test fixtures: minimal valid summary object; invalid role array.

### Key files

| File | Change |
|------|--------|
| `docs/model-inclusion-policy.md` | `summary` contract |
| `lib/agent-registry.js` | validation |
| `lib/agent-matrix.js` | projection |
| `templates/agents/cc.json` | exemplar |
| `templates/agents/op.json` | exemplar |
| `tests/integration/agent-registry-contract.test.js` | regression |

## Dependencies

- None (first in chain).
- Blocks: `model-summary-dashboard-surface`.
- Operational backfill: `docs/specs/recurring/weekly-model-catalog-intelligence.md` (no feature ID — recurring template).

## Out of Scope

- Dashboard UI (sibling feature).
- Pro `model-catalog-refresh` command (aigon-pro follow-up).
- Bulk backfill of all `modelOptions` rows.
- Auto-generating summary from web research in OSS CLI (recurring maintainer task only).
- Changing per-role `notes` / `score` semantics.

## Open Questions

- Should `validateModelOptions` **require** `summary` on all non-quarantined models immediately, or only on new adds? **Spec choice: new adds only; weekly task backfills under maintainer gate.**
- Include `summary` in `customModelOptions` merge path (`agent-registry` merged options)? **Yes — same validation when custom entries present.**

## Related

- Recurring: `docs/specs/recurring/weekly-model-catalog-intelligence.md`
- Prior work: F370 agent matrix, F313 model picker, `docs/model-inclusion-policy.md`
- Follow-up: `model-summary-dashboard-surface` (UI)

## Pre-authorised

- May skip full `npm run test:browser` mid-iteration (no dashboard JS in this feature).
- Edit `templates/agents/cc.json` and `op.json` exemplar rows only — no drive-by score changes on other models.
