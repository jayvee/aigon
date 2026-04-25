# Research Findings: agent model capability matrix

**Agent:** Claude (cc)
**Research ID:** 41
**Date:** 2026-04-25

---

## Key Findings

### 1. The substrate for "capabilities" already exists — most of the matrix can be *derived*, not authored

Three existing pieces of infrastructure between them already produce ~70% of the columns the spec asks for. The matrix is mostly a *view*, not a new data store.

| Existing source | What it already gives the matrix | Where it lives |
|---|---|---|
| `templates/agents/<id>.json` `cli.modelOptions[]` | The full enumerable cell index `(agent × model)`, plus the existing `quarantined: { since, reason, evidence, supersededBy }` schema. Also `cli.complexityDefaults[<bucket>] → { model, effort }` is itself an opinionated capability mapping per agent. | `lib/agent-registry.js` |
| `lib/telemetry.js` `PRICING` table (per-token USD rates for Anthropic, Gemini, OpenAI/GPT-5) + `getModelPricing(modelId)` with prefix/family fallback | The **public-API pricing** column out of the box; family fallback already handles unknown SKUs. Cache read/write multipliers already modelled. | `lib/telemetry.js:22-69` |
| `.aigon/workflows/<entity>/<id>/stats.json` — per-feature `cost.costByAgent[<agent>]` and `cost.costByActivity[<activity>]` with token breakdowns, model/effort overrides, sessions, real `costUsd` | The **benchmark history** for free — every feature/research close already writes a normalised, model-attributed cost record. `lib/stats-aggregate.js` already rolls these up into `.aigon/cache/stats-aggregate.json` with a `perTriplet` rollup keyed on `agent|model|effort`. | `lib/stats-aggregate.js`, `feature-close.js` |

**Implication:** Phase A doesn't need a new persistence layer. It needs (a) one new field on `modelOptions[]` for hand-curated qualitative notes, (b) a read-only `lib/agent-matrix.js` collector that joins the three sources above, and (c) a Settings-tab view that renders that collector's output. The "data model" question collapses into "what does the join look like." See §Data model below.

### 2. Pricing should move from `telemetry.js` to the agent JSON, with `telemetry.js` reading from there

Today `PRICING` is a hand-maintained constant in `lib/telemetry.js`. That table is **also** the natural source of the matrix's cost column, and it's exactly the thing Phase C should keep refreshed. Two consumers of the same data living in different places is a write-path-contract problem waiting to happen (`AGENTS.md` § Write-Path Contract — exactly the failure mode listed in F285→F293).

**Recommendation:** move per-model pricing into `templates/agents/<id>.json` `cli.modelOptions[<i>].pricing = { input, output, cacheReadMultiplier?, cacheWritePremium? }`. `lib/telemetry.js:getModelPricing()` becomes a thin lookup against `agent-registry`. Then both telemetry cost computation **and** the matrix view read from one source of truth, and Phase C only has to write to one place. This also makes "is `gpt-5.5` priced?" a registry assertion (and a doctor check) instead of a silent fallback to sonnet pricing in `telemetry.js:55`.

### 3. The four core operations don't all map cleanly to existing prompt verbs — define them explicitly

The spec lists four operations: *create-spec*, *review-spec*, *implement-feature*, *review-feature-implementation*. The current `cli.complexityDefaults` per agent doesn't separate them — it has one `{model, effort}` per complexity bucket, regardless of activity. But `stats.json` `cost.costByActivity[<activity>]` already breaks costs out by activity (`implement`, `review`, `evaluate`, etc.).

**Recommendation:** define the canonical operation enum in one place (`lib/agent-matrix.js` `OPERATIONS = ['create-spec', 'review-spec', 'implement', 'review-implementation']`) and map each agent's existing prompt fields onto it:

| Operation | Existing per-agent surface | Existing telemetry activity |
|---|---|---|
| create-spec | `feature-draft.js` / `research-draft.js` (drafting agent) | `implement` (drafting writes a spec file) — needs new activity tag `draft` |
| review-spec | `cli.reviewPrompt` for spec? Currently no explicit verb — uses generic `aigon:feature-spec-review` slash. F341 made this a first-class state | `spec_review` — new |
| implement | `cli.implementPrompt` | `implement` ✓ |
| review-implementation | `cli.reviewPrompt` (`/aigon:feature-code-review`) | `review` ✓ (or `evaluate` for Fleet) |

The matrix forces a small but useful tightening: every agent gains an explicit per-operation prompt mapping, and telemetry gains two missing activity tags (`draft`, `spec_review`) so Phase A's benchmark column has a place to land. **Sequencing implication:** add the activity tags in Phase A's data-model feature, not later, or the benchmark column has nothing to display for two of the four operations.

### 4. Phase A ships in two features, not one — and the benchmark runner should *not* be bespoke

**Phase A1 — schema + read API + Settings view (no benchmark runner):** the moment the join collector exists, the Settings table has data to render from `stats-aggregate.json` for any feature/research already closed. No new instrumentation needed. This ships immediately.

**Phase A2 — canonical benchmark via Brewboard/seed-reset:** rather than a new `aigon benchmark` command, lean on the existing recurring-features mechanism (`lib/recurring.js` + `docs/specs/recurring/*.md`). Add a recurring template `weekly-agent-matrix-benchmark.md` that, for each (agent × model) cell with stale data, runs a fixed canonical feature against a fresh seed-reset of Brewboard and lets the existing close path write `stats.json`. The matrix collector picks it up automatically. Same machinery that produces `weekly-dep-sweep`, no bespoke runner.

**Why not a new command:** because the recurring-features system already handles cadence, dedup, ID assignment, prioritise, and commits. Inventing a parallel "benchmark scheduler" duplicates `lib/recurring.js`. The fact that Brewboard's `seed-reset` makes runs reproducible is the entire reason this works.

**Caveat:** running a real implement cycle on every (agent × model) every week is expensive. Default the benchmark to weekly for **the implement operation only** on a tiny canonical feature, and have the cheaper operations (review-spec, create-spec) run on every actual user feature opportunistically — the data is already being collected. Brewboard handles `implement`; review/eval data accumulates from real-world use.

### 5. Other seed repos are useful for `review-spec` only if they have a stable spec corpus

The spec asks whether trailhead is better suited for review-spec. Today neither seed repo carries a frozen "review me" spec corpus. **Recommendation:** for the benchmark, don't try to use a different seed per operation. Add a `docs/benchmarks/` folder inside Brewboard (one per operation) — a fixed implement spec, a fixed spec-to-review, a fixed feature-to-review. The benchmark recurring template runs each agent against the appropriate fixture. One seed repo, one canonical fixture per operation, fully reproducible.

### 6. Phase B's recommender is `lib/spec-recommendation.js` extended with capability scoring

`lib/spec-recommendation.js` already resolves `(complexity, agent) → {model, effort}` from `cli.complexityDefaults`. That **is** the recommender — it just doesn't currently consult the matrix or rank across agents.

**Minimum viable Phase B:** add `rankAgentsForOperation(op, complexity, { excludeOverBudget = true, excludeQuarantined = true })` to `lib/spec-recommendation.js` (rename the file later if needed). Score = qualitative score (1–5 from matrix) − cost penalty (normalised public-API $/op from `stats-aggregate.perTriplet[<triplet>].costUsd / sessions`) − quarantine. The function returns a ranked list with `{ agentId, model, effort, score, rationale }`.

**Sparse cells:** if a `(agent × model × operation)` triplet has zero benchmark sessions, fall back to the qualitative score with `confidence: 'low'` and a `rationale: 'no benchmark data — qualitative only'`. **Never invent numbers** to fill an empty cell — the matrix is honest about gaps; that honesty drives Phase B to recommend running a benchmark.

**Selection-point integration:** the recommender returns ranked options; the existing `/api/recommendation/:type/:id` endpoint already pre-selects start-modal dropdowns from `spec-recommendation`. Phase B extends that endpoint to return a ranked list with badges (`✨ best value`, `⚡ fastest`, `🎯 highest quality`), and the start modal renders them. Review-spec/review-implementation surfaces are CLI prompts — they already pass through `lib/agent-prompt-resolver.js`; add a "(suggest agent?)" prompt there that calls `rankAgentsForOperation`.

**Boundary between A and B:** Phase A only needs to ship: (1) the join collector, (2) the Settings view, (3) the new `pricing` field on `modelOptions[]`. Phase B can then ship independently because it consumes the collector's output.

### 7. Phase C — the refresh fits standard recurring-features cleanly, but the *output* needs to be a feedback item, not a silent merge

Confirming the working assumption: the refresh **does** fit `lib/recurring.js`. Concrete shape:

- New recurring template: `docs/specs/recurring/weekly-agent-matrix-refresh.md`
- Schedule: weekly (with manual trigger via the standard recurring system; no new infra)
- Agent: `cc-opus-4-7` by default (configurable via standard agent picker pattern), because reasoning over conflicting public sources is exactly its strength
- Inputs (passed via the spec template body): current matrix dump (JSON), list of agent IDs, last-refresh per (agent × model)
- Tools: `WebSearch`, `WebFetch` (for vendor pricing pages, model cards, release notes, LMArena/SWE-bench/Aider leaderboard pages)

**Sources, ranked:**
1. **Authoritative (auto-merge candidates):** vendor pricing pages (anthropic.com/pricing, ai.google.dev/pricing, openai.com/api/pricing), vendor model cards / release notes
2. **Signal but needs review:** SWE-bench Verified, Aider polyglot leaderboard, LMArena (these change ranks frequently)
3. **Noise (cite but don't merge):** HN, lobste.rs, r/LocalLLaMA — surface as "community sentiment notes" only

**Output flow — must respect dashboard-read-only rule (`feedback_dashboard_read_only.md`):**

The refresh agent **does not** mutate `templates/agents/<id>.json` directly. Instead, it writes a structured patch (JSON diff) to `.aigon/matrix-refresh/<YYYY-MM-DD>/proposed.json` and creates a feedback item via the existing `aigon feedback-create` infra (one feedback per kind of change: `pricing-update`, `new-model`, `quarantine-candidate`, `deprecation`). The user reviews via the standard feedback flow, accepts, and a follow-up command (`aigon matrix-apply <feedback-id>`) writes the registry change. This way the refresh produces *reviewable artefacts*, not silent state changes.

**Failure modes:**
- No internet / source 404 → the recurring feature itself fails closed (existing recurring system surfaces it on the board); no diff produced; matrix rows just keep their stale `lastRefreshAt`
- Conflicting data across sources → the agent emits a feedback item with both sources cited and `confidence: 'conflict'`; user picks
- Whole refresh job hangs / OOM → the standard supervisor idle/heartbeat detection (display only — never auto-kills) flags it; user can `feature-reset` the recurring instance

**Cadence trade-off:** weekly is right for **prices and new models** (they don't change daily, weekly is below the noise floor). Quarterly is right for **strengths/weaknesses qualitative notes** (they don't change weekly and the noise of constantly-shifting "vibes" would erode trust). **Recommendation:** one weekly template for pricing/release-notes, one separate quarterly template for qualitative notes. Two templates, both via the standard recurring system.

### 8. The dependency on `feature-agent-cost-awareness` is one-directional and not blocking for Phase A or A2

Confirmed from reading `docs/specs/features/06-paused/feature-agent-cost-awareness.md`: that feature tracks **user quota** (cycle dates, monthly budget, warning thresholds for subscription-style billing). Phase A's pricing column is **public API $/M tokens**, completely independent. Phase A and A2 ship without `agent-cost-awareness` shipping first.

**Phase B's `excludeOverBudget` flag depends on it.** Sequence: ship Phase A → Phase A2 → Phase B (without `excludeOverBudget` — score on capability + public-API cost only) → `agent-cost-awareness` (separate feature, currently paused) → Phase B v2 adds the `excludeOverBudget` filter. No need to wait.

### 9. Settings-tab UI: rows = model, columns = operation, with a single drill-down modal

Information-architecture only (visual polish via `frontend-design` skill at implementation time):

- **Default view:** rows are `(agent, model)` pairs, columns are the 4 operations, plus 3 metadata columns (Pricing, Last benchmark, Status).
- **Cell content:** capability score (1–5, color-graded) · "$0.42/op" derived from `stats-aggregate` (or "—" if no data) · small confidence badge (`hi`/`lo`/`stale`).
- **Drill-down:** clicking a cell opens a side panel with: full qualitative notes, last 10 benchmark runs from `stats-aggregate.perTriplet[<triplet>]`, link to the underlying feature stats, last-refresh timestamp + source citations from Phase C.
- **Filters:** `[ ] Installed only` (default on), `[ ] Hide quarantined` (default on), `[ ] Show stale (>30d)`. Quarantined models render in a strikethrough greyed style with the quarantine reason on hover — never silently hidden when the user opts in.
- **Cost label:** column header says "Public API $/op (value-for-money proxy)" with an info-tooltip explaining "this is what the operation would cost on metered API pricing — your actual subscription bill differs." This addresses the spec's exact concern about subscription opacity.

### 10. Producer-of-each-cell map (for the write-path-contract audit)

Per `AGENTS.md` § Write-Path Contract, the matrix needs an explicit producer per column. Pre-emptive map:

| Column | Producer | Update path |
|---|---|---|
| Agent ID, model ID | `templates/agents/<id>.json` (hand-edited) | install-agent / manual edit |
| Public API $ in/out | `templates/agents/<id>.json` `cli.modelOptions[].pricing` | Phase C feedback → manual apply |
| Derived $/op | `lib/stats-aggregate.js` perTriplet rollup ÷ sessions | Automatic on every feature-close |
| Qualitative strength/weakness | `templates/agents/<id>.json` `cli.modelOptions[].notes.<operation>` (new field) | Phase C feedback → manual apply |
| Capability score 1–5 per op | `templates/agents/<id>.json` `cli.modelOptions[].score.<operation>` (new field) | Hand-curated initially; Phase C proposes diffs |
| Latency, token usage | `lib/stats-aggregate.js` perTriplet | Automatic on every feature-close |
| Last benchmark date | `lib/stats-aggregate.js` perTriplet `lastRunAt` | Automatic |
| Last refresh date | `templates/agents/<id>.json` `cli.modelOptions[].lastRefreshAt` | Phase C apply step |
| Sample size | `lib/stats-aggregate.js` perTriplet `sessions` | Automatic |
| Confidence | Derived: `sessions >= 3 && lastRunAt < 60d ? 'hi' : 'lo'` | Automatic |
| Quarantine status | Existing `cli.modelOptions[].quarantined` schema | Manual or Phase C feedback |

Every column has a single producer; reads in `lib/agent-matrix.js` join them. **No silent fallbacks** — missing pricing returns `null` (Settings view shows "—"), not the sonnet default that `telemetry.js` currently uses (which itself should be fixed in this work — see §2).

## Sources

- `templates/agents/{cc,gg,cx,cu}.json` — `cli.modelOptions[]`, `complexityDefaults`, existing `quarantined` schema
- `lib/spec-recommendation.js` — current complexity-only recommender; the place Phase B extends
- `lib/telemetry.js:22-69` — existing per-model PRICING table and family-fallback `getModelPricing()`
- `lib/stats-aggregate.js` — existing per-triplet rollup at `.aigon/cache/stats-aggregate.json`
- `lib/recurring.js` + `docs/specs/recurring/weekly-dep-sweep.md` — exact pattern for Phase A2 benchmark and Phase C refresh
- `lib/budget-poller.js` — precedent for cached external polling (`.aigon/budget-cache.json`); Phase C output should mirror its cache shape
- `.aigon/workflows/features/322/stats.json` — example of the rich `cost.costByAgent` / `cost.costByActivity` data already produced on every feature-close
- `lib/agent-registry.js` — central agent lookup; `getModelOptions()` already filters quarantined; matrix collector lives next to this
- `docs/specs/features/06-paused/feature-agent-cost-awareness.md` — adjacent (paused) feature; Phase A is independent, Phase B v2 depends on it
- Memory: `feedback_quarantine_bad_models.md` — quarantine schema and `supersededBy` pattern; matrix must surface, not hide
- `AGENTS.md` § "Write-Path Contract" — every column must name its producer (see §10)
- `AGENTS.md` § "Dashboard read-only rule" — Phase C cannot mutate registry directly; output is a feedback item

## Recommendation

**Three-phase, six-feature decomposition. Ship A1 first; A2 and B are concurrent; C is last.**

The right framing is: **the matrix is already 70% data we already collect; the new work is the join + view + a thin scoring layer + a refresh recurring template.** Avoid the temptation to invent a new "matrix benchmark runner" — `lib/recurring.js` is already that runner. Avoid the temptation to invent a new "matrix store" — three existing data sources cover it.

**Sequencing rationale:**
- A1 (data model + join + view) blocks every other piece. Ship first.
- A2 (Brewboard benchmark via recurring) is independent of B once A1 lands — concurrent.
- B (recommender) consumes A1's read API; can ship as soon as A1 is in.
- B's per-surface integrations (start modal already wired via `/api/recommendation`; CLI surfaces need light additions) are a separate small feature so the core recommender ships clean.
- C (refresh) ships last because it produces feedback items the user must triage — needs A1's view in place to make the diff comprehensible. Pricing-refresh and qualitative-refresh split into two recurring templates with different cadences.

**Critical write-path-contract callouts (must be in the implementing feature specs):**
1. Move the pricing table out of `lib/telemetry.js` into `cli.modelOptions[].pricing` in the same commit as A1 — two consumers of one data, one source of truth.
2. Phase A1 must add the missing telemetry activity tags (`draft`, `spec_review`) or the benchmark column will be empty for two of four operations.
3. Phase C produces a *feedback item plus a `.aigon/matrix-refresh/<date>/proposed.json` artefact*; an `aigon matrix-apply <feedback-id>` command (small, separate) does the actual write. Never auto-mutates the registry.
4. Sparse cells: `confidence: 'low'` + honest "no benchmark data" message — **never invent numbers** to fill empty cells.
5. Quarantined models: render greyed/strikethrough with hover-reason, never silently hidden.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| agent-matrix-data-model-and-view | Phase A1: add `pricing`, `notes.<op>`, `score.<op>`, `lastRefreshAt` fields to `cli.modelOptions[]`; move PRICING from `telemetry.js` to registry; build `lib/agent-matrix.js` join collector over registry + `stats-aggregate` + telemetry; add Settings-tab read-only table view; add new telemetry activity tags `draft` and `spec_review` | high | none |
| agent-matrix-brewboard-benchmark | Phase A2: add `docs/benchmarks/{implement,spec-review,code-review,draft}.md` fixtures to Brewboard seed; new recurring template `weekly-agent-matrix-benchmark.md` that runs the implement fixture per stale (agent × model) cell against a fresh seed-reset; relies on existing `feature-close` to write `stats.json` (matrix collector picks it up automatically) | high | agent-matrix-data-model-and-view |
| agent-matrix-recommender-core | Phase B core: extend `lib/spec-recommendation.js` with `rankAgentsForOperation(op, complexity, opts)` returning ranked `{ agentId, model, effort, score, rationale, confidence }[]`; sparse-cell handling with honest `confidence: 'low'`; quarantine + (later) over-budget filters | high | agent-matrix-data-model-and-view |
| agent-matrix-recommender-surfaces | Phase B integrations: extend `/api/recommendation/:type/:id` to return ranked list with `✨ best value` / `⚡ fastest` / `🎯 highest quality` badges; render badges in start modal; CLI prompt addition in `lib/agent-prompt-resolver.js` for review-spec/review-implementation surfaces | medium | agent-matrix-recommender-core |
| agent-matrix-pricing-refresh | Phase C (weekly): recurring template `weekly-agent-matrix-pricing-refresh.md` that runs cc-opus, fetches vendor pricing pages + release notes, emits structured patch to `.aigon/matrix-refresh/<date>/proposed.json` plus one `feedback-create` per change-kind (pricing-update, new-model, deprecation, quarantine-candidate); plus `aigon matrix-apply <feedback-id>` command for the manual write step | medium | agent-matrix-data-model-and-view |
| agent-matrix-qualitative-refresh | Phase C (quarterly): separate recurring template scanning SWE-bench / Aider / LMArena and community sentiment, proposing updates to `notes.<op>` and `score.<op>` via the same feedback-item flow; lower cadence because qualitative scores shouldn't churn weekly | low | agent-matrix-pricing-refresh |
