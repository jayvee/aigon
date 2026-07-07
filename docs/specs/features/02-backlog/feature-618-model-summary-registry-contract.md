---
complexity: medium
depends_on: []
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T01:10:59.615Z", actor: "cli/feature-prioritise" }
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

- [ ] Document `summary` in `docs/model-inclusion-policy.md` §5 (Lifecycle requirements) with the shape below. `summary` is **optional** on legacy rows until the weekly task backfills; **required on any new model added after this feature ships** — but this "required on new adds" rule is a **policy/review-gate** rule, not a `validateModelOptions` hard error. Rationale: the validator runs over a single `agentConfig` and has no signal for "new vs legacy" at validate time; enforcement happens at PR review against this policy. The validator only checks shape *when `summary` is present*.
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

- [ ] `bestFor` / `avoidFor` use Aigon role vocabulary only (same five keys as matrix operations: `implement`, `review`, `spec`, `spec_review`, `research`). No free-form tags like "planning", "code review", "spec drafting".
- [ ] `headline` must not duplicate `label` (case-insensitive, trimmed). `body` may reference benchmarks but must not contradict `quarantined.reason` when quarantined — this contradiction check is a **policy/maintainer-review note**, not a validator rule (semantic; not machine-checkable).

### Validation (`lib/agent-registry.js`)

- [ ] Extend `validateModelOptions(agentConfig)` with a `validateSummary(opt, where)` helper:
  - If `summary` absent: no-op (legacy rows pass).
  - If `summary` present: require `headline`, `confidence`, `researchedAt` (non-empty string / valid ISO for `researchedAt`); validate `confidence` ∈ {high, medium, low}; validate `bestFor`/`avoidFor` are arrays containing only roles from `{implement, review, spec, spec_review, research}`; reject duplicate roles within either array.
  - `headline` length >120 → validation error. `headline` case-insensitive-trim equal to `opt.label` → validation error.
  - `body` length >500 → validation error (when `body` present).
  - `sources` present → must be an array; each entry must have `kind` ∈ {aigon-bench, benchmark, community, provider}; warn (not fail) if `sources` empty when `confidence === 'high'`.
  - `summary` on `archived` entries: warn (not fail) if `headline` is missing — archived rows usually have no summary, so a partial one is suspicious but not blocking.
  - Keep error messages actionable and prefix with the model `where` (e.g. `[op] modelOptions "openrouter/qwen/qwen3-235b-a22b-07-25": summary.headline exceeds 120 chars`).
- [ ] `tests/integration/agent-registry-contract.test.js` covers: valid summary passes; missing `headline` fails; invalid role in `bestFor` fails; free-form role like `"code review"` fails; `headline` duplicating `label` fails; `body` >500 fails; `sources[].kind` outside enum fails; exemplar entries in `cc.json` / `op.json` pass `validateModelOptions` with zero errors (regression guard against future drift).
- [ ] **Custom entries validation path.** `validateModelOptions` currently runs over a single `agentConfig` and never sees `customModelOptions` (those live in project/global config and are merged in `getModelOptions`). To honour Open Question #2 ("same validation when custom entries present"), add a thin helper `validateCustomModelOptions(customArr, agentId)` that re-uses `validateSummary` (and the existing per-opt checks) on each custom entry, and call it from the same place `_getCustomModelOptions` is consumed for the picker. Custom entries with invalid `summary` warn at load and are dropped from the picker (matching existing quarantine-skip behaviour); they do not block startup. Add one contract test for a custom entry with a bad role.

### Read model

- [ ] `lib/agent-matrix.js` `buildMatrix()` includes `summary: opt.summary || null` on each `MatrixRow` (update JSDoc to add `summary { ... } | null` as the last field). The null-value "Default" placeholder row gets `summary: null`.
- [ ] `GET /api/agent-matrix` response rows expose `summary` without transformation (dashboard DTO stays server-owned via matrix module).
- [ ] **Matrix projection scope:** `buildMatrix()` iterates `agent.cli.modelOptions` (shipped registry only) — user `customModelOptions` from project/global config are **not** projected into the agent matrix. Custom entries are validated separately (see Validation → custom path below), but they do not appear in `/api/agent-matrix`. This keeps the dashboard matrix as the curated-registry view.
- [ ] No change to dashboard frontend in this feature.

### Seed data (exemplars only)

- [ ] Add complete `summary` to **one** `cc` model with full per-role notes (e.g. `claude-sonnet-4-6`) — headline reflects balanced implement/review strength.
- [ ] Add complete `summary` to **one** `op` model (`openrouter/qwen/qwen3-235b-a22b-07-25`) — headline reflects value implement/review, avoid spec/research. Note: this model's existing `score` only covers `implement`; the `summary` may express role verdicts (e.g. `avoidFor: ["spec", "research"]`) for roles that have no `score`/`notes` entry — `summary` is the curated entry point, not a projection of `notes`.
- [ ] `researchedAt` for both exemplars = the ISO timestamp at authoring time (use the merge date of this feature's PR; do not backdate).
- [ ] Do **not** bulk-backfill all models; weekly recurring task owns scale population.

### Docs

- [ ] `AGENTS.md` Agent registry / model policy pointer mentions `summary` in one sentence (or defer to model-inclusion-policy only — prefer policy as SSOT).
- [ ] `CHANGELOG.md` entry under Added.
- [ ] **Fix the recurring template's `summary` example** to use canonical role vocabulary. `docs/specs/recurring/weekly-model-catalog-intelligence.md` currently shows `bestFor: ["code review", "implement"]` and `avoidFor: ["spec drafting", "research synthesis"]` — these are free-form labels, contradicting the same doc's stated vocabulary. Replace with `["review", "implement"]` and `["spec", "research"]` so the recurring task's output matches the contract this feature defines. (Editing the recurring doc is in-scope because this feature owns the canonical shape the recurring task must follow.)

## Validation

```bash
npm run test:quick
node -e "
const reg = require('./lib/agent-registry');
const m = require('./lib/agent-matrix');
const r = m.buildMatrix().find(x => x.modelValue === 'claude-sonnet-4-6');
if (!r?.summary?.headline) throw new Error('cc exemplar missing summary in matrix');
const op = m.buildMatrix().find(x => x.modelValue && x.modelValue.includes('qwen3-235b'));
if (!op?.summary?.headline) throw new Error('op exemplar missing summary in matrix');
for (const id of ['cc', 'op']) {
  const { errors } = reg.validateModelOptions(reg.getAgent(id));
  if (errors.length) throw new Error(id + ' validateModelOptions errors: ' + errors.join('; '));
}
console.log('ok');
"
```

## Technical Approach

1. **Policy** — append §5 bullet for `summary`; add confidence ladder cross-ref to recurring template.
2. **`validateModelOptions`** — add `validateSummary(opt, where)` helper; keep errors actionable (`[op] modelOptions "…": summary.headline exceeds 120 chars`).
3. **`agent-matrix.js`** — one-line projection; no scoring logic in matrix (summary is curated, not derived).
4. **Exemplars** — hand-write summaries consistent with existing `notes`/`score` on those rows; `researchedAt` = the merge date of this feature's PR (see Seed data); `confidence: medium` until weekly task upgrades with sources.
5. **Tests** — contract test fixtures: minimal valid summary object; invalid role array.

### Key files

| File | Change |
|------|--------|
| `docs/model-inclusion-policy.md` | `summary` contract (§5) |
| `lib/agent-registry.js` | `validateSummary` helper + `validateCustomModelOptions` entry point |
| `lib/agent-matrix.js` | projection + JSDoc |
| `templates/agents/cc.json` | exemplar |
| `templates/agents/op.json` | exemplar |
| `docs/specs/recurring/weekly-model-catalog-intelligence.md` | fix `bestFor`/`avoidFor` example to canonical role names |
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

- _None remaining._ The two original questions are resolved by the body: "required on new adds" is a policy/review-gate rule (validator only checks shape when `summary` present), and `customModelOptions` validation is added as a thin `validateCustomModelOptions` helper that warns + drops bad entries rather than blocking startup. Matrix projection intentionally stays shipped-registry-only.

## Related

- Recurring: `docs/specs/recurring/weekly-model-catalog-intelligence.md`
- Prior work: F370 agent matrix, F313 model picker, `docs/model-inclusion-policy.md`
- Follow-up: `model-summary-dashboard-surface` (UI)

## Pre-authorised

- May skip full `npm run test:browser` mid-iteration (no dashboard JS in this feature).
- Edit `templates/agents/cc.json` and `op.json` exemplar rows only — no drive-by score changes on other models.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 618" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-618" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-618)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#618</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">model summary registry co…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#619</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">model summary dashboard s…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
