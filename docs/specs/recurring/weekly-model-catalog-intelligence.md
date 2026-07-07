---
schedule: weekly
name_pattern: model-catalog-intelligence-{{YYYY-WW}}
recurring_slug: weekly-model-catalog-intelligence
complexity: high
agent: cc
---

# model-catalog-intelligence-{{YYYY-WW}}

## Summary

Keep Aigon's curated agent model registry (`templates/agents/*.json`) honest against live provider catalogs. Each week, diff OpenRouter (for `op`) and Gemini (for `gg`) against what Aigon ships, refresh pricing and availability signals, probe new candidates, benchmark stale or newly discovered pairs, rank models per role (implement / review / spec / research), and **archive or quarantine** models that are gone, broken, or superseded.

This is the operational layer the project is missing today. F503 (`bench-refresh`) and F537 (maintainer tooling moved to Pro) cover **monthly benchmark sweeps** and **discovery append-only** — but not weekly catalog hygiene, retirement, role-specific ranking, or a single report an operator can triage. This recurring task closes that gap until a dedicated Pro command (`model-catalog-refresh` or similar) exists.

**This is a triage + maintainer-publish task, not an auto-merge task.** The agent produces a report and a small set of curated JSON diffs; a human reviews before anything ships to `main`.

## User Stories

- As the maintainer, I want a weekly report listing **new models on OpenRouter/Gemini that Aigon does not list**, with pricing and a suggested role, so I never discover a Qwen3.6 or Qwen3.7 release weeks late via a user question.
- As the maintainer, I want models that **no longer exist or no longer support tools** on OpenRouter to be flagged for `archived` or `quarantined`, not left as green picker options.
- As the maintainer, I want **pricing refreshed** on active models so cost/value recommendations in chat and the matrix are not stale.
- As the maintainer, I want **role-ranked recommendations** (best value implement, best value review, best quality review, etc.) grounded in probe + bench + published benchmarks — not vibes.
- As an operator picking a review model, I want the dashboard/matrix to surface **yellow/red** when a model passes probe but fails bench (F456 intent), so "available" ≠ "recommended".
- As an operator, I want a **visible one-line model summary** ("great for code review, weak on deep planning") on the Agent Matrix and in model pickers — maintained weekly from web research + Aigon bench data, not hand-written once and forgotten.

## Model summary contract (registry + UI)

Each `cli.modelOptions[]` entry gains a **`summary`** object — the operator-facing qualitative view. Per-role `notes` / `score` stay the drill-down; `summary` is the entry point.

```json
"summary": {
  "headline": "Best-value OpenRouter reviewer; skip for deep spec or research work.",
  "body": "Strong on routine agentic code review and cheap implementation loops. Published SWE-bench is high but Aigon bench shows timeouts on flash-tier variants. Community reports instruction drift in 400K+ contexts.",
  "bestFor": ["code review", "implement"],
  "avoidFor": ["spec drafting", "research synthesis"],
  "confidence": "high",
  "researchedAt": "2026-07-07T12:00:00.000Z",
  "sources": [
    { "kind": "aigon-bench", "ref": "all-brewboard-2026-04-29T11-59-07-090Z.json" },
    { "kind": "benchmark", "title": "SWE-bench Verified 79%", "url": "https://evals.report/models/deepseek-v4-flash" },
    { "kind": "community", "title": "HN thread on V4 Flash agentic use", "url": "https://news.ycombinator.com/item?id=48440992" }
  ]
}
```

**Field rules**

| Field | Required | Visible in UI | Max |
|-------|----------|---------------|-----|
| `headline` | yes (active models) | always | ~120 chars |
| `body` | yes when `confidence` ≥ medium | expand / hover | ~500 chars |
| `bestFor` / `avoidFor` | yes | chips or tooltip | use Aigon role vocabulary: `implement`, `review`, `spec`, `spec_review`, `research` |
| `confidence` | yes | badge | `high` \| `medium` \| `low` |
| `researchedAt` | yes | "Researched \<date\>" footnote | ISO |
| `sources` | ≥2 when confidence is high | "Sources" link list | no URLs in `headline`/`body` without also being in `sources` |

**Confidence ladder**

- **high** — Aigon probe (+ bench when agentic) **and** ≥2 independent external sources agree
- **medium** — strong external benchmarks/community **or** Aigon bench only
- **low** — provider marketing / single source / probe-only; headline must say "unverified" or "probe-only"

**Precedence when sources conflict:** Aigon bench result > maintainer probe > practitioner community > provider blog.

**UI surfacing** (requires a small OSS dashboard feature — not this recurring task's code scope):

- **Settings → Agent Matrix:** `headline` as subtitle under model label; full `body` + chips on row expand
- **Matrix peek + model pickers:** `headline` always; contextual hint when action is review → emphasize `avoidFor` if it contains `review`
- Per-role hover notes unchanged

Track UI work as follow-up inbox feature `model-summary-dashboard-surface` if not already shipped.

## Acceptance Criteria

### 1. Catalog diff (discovery)

- [ ] Fetch live catalogs:
  - OpenRouter: `GET https://openrouter.ai/api/v1/models` (no auth)
  - Gemini: `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY` (skip section with clear note if key missing)
- [ ] For each agent with an enumerable provider (`op`, `gg`), build `{value, label, pricing, supported_parameters}` candidates filtered per `docs/model-inclusion-policy.md` §1–§3 (modality exclusions, `:free` tier rejection, tools required for `op`).
- [ ] Compare against `templates/agents/<id>.json` `cli.modelOptions` by `value` (and known alias pairs documented in notes, e.g. `qwen3-235b-a22b-07-25` ↔ `qwen3-235b-a22b-2507`).
- [ ] Emit three buckets in the report: **NEW** (on provider, not in Aigon), **STALE-ID** (in Aigon, not on provider), **ALIAS-ONLY** (same model, different slug).

### 2. Availability & retirement signals

- [ ] For every **active** (non-quarantined, non-archived) `modelOptions` entry on `op` and `gg`, run `aigon agent-probe <agent> --model <value>` (or Pro equivalent if OSS stubs).
- [ ] Mark probe failures as **RETIRE-CANDIDATE** with evidence; do not delete entries — follow `docs/model-inclusion-policy.md` §7 (`quarantined` or `archived` block).
- [ ] For STALE-ID entries (provider 404 / model removed), prepare an `archived` block with `since`, `reason`, `evidence`, `supersededBy` (if known).
- [ ] Never silently delete `modelOptions` rows; git history + quarantine/archive blocks are the audit trail.

### 3. Pricing refresh

- [ ] For models still on the provider catalog, update `pricing: { input, output }` in USD/MTok from the provider response (OpenRouter `pricing.prompt/completion`; Gemini pricing table or documented rates).
- [ ] Flag models whose output price crossed policy thresholds (§2: > $5/MTok) for human review before promotion.

### 4. Deep web research → `summary` population

For each model in scope this week, run a structured research pass and **draft or refresh** the `summary` object.

**In scope**

| Bucket | Research depth |
|--------|----------------|
| NEW (provider, not in Aigon) | Full pass — required before add to registry patch |
| Active, `summary` missing or `researchedAt` > 21 days | Full pass |
| Active, bench/probe verdict changed since `researchedAt` | Full pass |
| Quarantined / archived | Short pass — headline = why to avoid; skip community trawl |
| Unchanged + fresh summary | Skip (cite "summary still fresh" in report) |

**Research steps (per model)**

1. **Provider primary** — OpenRouter model page / Gemini model card: pricing, context, tool support, release date.
2. **Benchmarks** — evals.report, Hugging Face model card tables, provider blog; capture SWE-bench / LiveCodeBench / Terminal-Bench if published.
3. **Practitioner signal (deep web)** — web search + HN/Reddit/developer blogs from the **last 30 days** for `"<model name>" coding agent OR code review OR SWE-bench`; note consensus and disagreements.
4. **Aigon ground truth** — this week's probe/bench/quarantine rows for that `value`; **must** appear in `sources` when present.
5. **Synthesize** — write `headline` (opinionated, role-aware), `body` (evidence), map strengths/weaknesses to `bestFor` / `avoidFor` using Aigon role names.
6. **Reconcile** — update matching `notes.<role>` and `score.<role>` when research contradicts stale values; cite week in commit message.

**Research output in weekly report** — per model subsection:

```markdown
### <agent>/<model label>
- Headline (proposed): …
- Confidence: high|medium|low
- Sources consulted: N (list)
- Conflicts: <none | describe>
- Registry action: add | refresh summary | quarantine | skip
```

**Quality bar for headlines** — must answer: *What is this model for in Aigon? What should I not use it for?*

Good: `Best-value OpenRouter reviewer; weak on deep spec and long research loops.`  
Bad: `Powerful next-gen model with great capabilities.` (marketing, no role guidance)

### 5. Qualification & role ranking

- [ ] **Probe** all NEW models and any active model whose `lastRefreshAt` is older than 14 days.
- [ ] **Bench** (brewboard or equivalent) NEW models and probe-ok models with `benchVerdict: unknown` or last bench > 30 days (`op`/`gg`) / 60 days (`cc`/`cx`) — use Pro maintainer tooling; if unavailable, document manual bench commands in the report.
- [ ] Produce a **role ranking table** per agent with columns: model label, value, $/MTok in/out, probe, bench, suggested roles, confidence:
  - **Confidence HIGH** — probe ok + bench passed on Aigon harness
  - **Confidence MED** — probe ok + strong published benchmark (SWE-bench, etc.) but no Aigon bench yet
  - **Confidence LOW** — probe only or published bench only
- [ ] Explicitly rank at least:
  - best **value** implement (`op`)
  - best **value** code review (`op`) — multi-turn agentic, not single-pass diff
  - best **quality** code review (note if not OpenRouter)
- [ ] Apply `docs/model-inclusion-policy.md` §4: thinking variants get warnings; do not promote into `complexityDefaults` without scores + notes.

### 6. Curated registry updates (human-gated)

- [ ] Prepare JSON patches for `templates/agents/op.json` and/or `gg.json`:
  - append NEW models (minimal shape: `value`, `label`, `pricing`, `lastRefreshAt`, `summary`, `score: { implement: null, review: null, ... }`)
  - refresh pricing on existing models
  - add or refresh `summary` per §4 for all in-scope models
  - add `quarantined` / `archived` blocks per policy
  - add `notes.<role>` for any model promoted or demoted in the ranking table (must not contradict `summary.headline`)
- [ ] Run `npm test` (or `node -e "require('./lib/agent-registry').validateModelOptions(...)"` per agent) — contract test must pass before proposing commit.
- [ ] **Do not commit registry changes on `main` without explicit maintainer approval** in the report's "Recommended commits" section. This recurring task may commit the **report only**.

### 7. Report & follow-ups

- [ ] Write `.aigon/reports/model-catalog-intelligence-{{YYYY-WW}}.md` using the template below.
- [ ] If the scan finds a **systemic gap** (missing automation, broken Pro command, policy hole), file one inbox feature via `aigon feature-create` and link it in the report. Examples: "bench-monitor still inbox", "no alias resolver in discovery", "Qwen3.7 not in provider prefix filter".
- [ ] Close this recurring feature with `aigon feature-close <ID>` after the report (and optional inbox feature) — no eval step.

## Report template

Write to `.aigon/reports/model-catalog-intelligence-{{YYYY-WW}}.md`:

```markdown
# Model catalog intelligence — {{YYYY-WW}}

Generated by recurring task `weekly-model-catalog-intelligence`.

## Executive summary

- New models found: N
- Retire/quarantine candidates: N
- Pricing updates: N
- Top value implement (op): <model>
- Top value review (op): <model>
- Biggest gap this week: <one sentence>

## Catalog diff

### NEW on provider, not in Aigon

| Provider | Model ID | Aigon label (proposed) | $/MTok in/out | Tools | Suggested roles |
|----------|----------|------------------------|---------------|-------|-----------------|

### STALE in Aigon, missing on provider

| Agent | value | Current label | Action |
|-------|-------|---------------|--------|

### Alias notes

| Aigon value | Provider canonical ID | Notes |

## Probe & bench matrix

| Agent | Model | Probe | Bench | Bench age | Verdict |
|-------|-------|-------|-------|-----------|---------|

## Model summaries (research pass)

| Agent | Model | Headline (proposed) | Confidence | Researched | Action |
|-------|-------|---------------------|------------|------------|--------|

### Detail

(per-model subsections from §4)

## Role rankings (OpenRouter / op)

### Best value implement
1. ...

### Best value code review (agentic)
1. ...

### Best quality code review (any agent)
1. ...

## Recommended registry patches

> Maintainer: review before applying. Run `npm test` after edits.

### Add
- ...

### Quarantine / archive
- ...

### Pricing refresh
- ...

### Summary add/refresh
- ...

## Recommended commits

- [ ] `chore(models): refresh op catalog {{YYYY-WW}}` — only if patches approved
- [ ] Report is gitignored; do not commit `.aigon/reports/`

## Follow-up features filed

- feature-NNN: <title> — <why>

## Raw commands log

<commands run, timestamps, exit codes>
```

## Technical Approach

1. **Inventory** — load `templates/agents/{op,gg,cc,cx,ag}.json`; extract active `modelOptions`.
2. **Fetch** — provider catalogs; normalize IDs to Aigon `value` form (`openrouter/<id>` for op).
3. **Diff** — set algebra on values; apply known alias map (maintain in report until codified in Pro).
4. **Probe** — `aigon agent-probe op --model <value>` for each candidate; record latency and verdict.
5. **Bench** — Pro: `bench-refresh --dry-run` then stale pairs; OSS-only: document gap and run manual `perf-bench` in Pro checkout if available.
6. **Research** — per §4, draft `summary` (+ reconcile `notes`/`score`) for in-scope models.
7. **Rank** — sort by (bench passed ? 0 : 1), role score if present, else implement score, then output $/MTok.
8. **Patch** — edit agent JSONs; validate; leave uncommitted unless maintainer pre-authorised this run.
9. **File follow-up** — if recurring work exposed a missing command or UI surface, create inbox feature.

### Relationship to existing features

| Feature | What it does | What this recurring adds |
|---------|--------------|---------------------------|
| F503 bench-refresh (Pro) | Monthly discovery append + stale bench | Weekly cadence, retirement, role ranks, report |
| F537 OSS/Pro split | Bench commands in Pro only | Documents Pro commands this task invokes |
| F456 bench health signal | yellow/green in picker | Feeds ranking; verify dashboard shows benchVerdict |
| F444 quota probe | API reachable | Complements bench; probe ≠ agentic fit |
| bench-monitor (inbox) | auto-quarantine, kill zombies | Run unattended weekly only after shipped |
| model-inclusion-policy | contract for entries | Enforcement via `validateModelOptions` |

### Cadence rationale

- **Weekly** — model releases (especially OpenRouter) outpace monthly sweeps; pricing shifts weekly.
- **Not daily** — benches cost money and time; probe-only daily could be a later Pro poller, not this task.

## Actionable Findings Policy

File a follow-up inbox feature when:

- A provider prefix filter caused a false negative (e.g. new `qwen/qwen3.7-*` family not discovered)
- >3 STALE-ID active models in one week (discovery/retirement automation is broken)
- bench-monitor still not shipped and an unattended bench is required
- Role ranking cannot be automated because bench artifacts are missing from Pro

Do **not** file features for routine "add this one model" work — that belongs in the weekly report's Recommended patches.

## Constraints

- Follow `docs/model-inclusion-policy.md` — no hand-waving models into `complexityDefaults` without scores.
- Never add literal API keys to the repo.
- OSS users must not depend on this task running — curated JSON on `main` is the product; this task is maintainer hygiene.
- Templates under `templates/agents/*.json` are the write target; never edit installed copies.
- Run args verbatim; do not spawn production feature worktrees for bench unless using seed repos.

## Pre-authorised

- Skip eval step — reporting and maintainer-registry hygiene.
- Read public OpenRouter models API and Gemini models API (with env key).
- Run `aigon agent-probe` for all active op/gg models (budget: stop after 3 consecutive provider errors and escalate in report).
- **Deep web research** for in-scope models: provider pages, benchmark aggregators, and practitioner sources (HN/Reddit/blogs) from the last 30 days; no paywalled source scraping.
- Write `.aigon/reports/model-catalog-intelligence-{{YYYY-WW}}.md`.
- Run `aigon feature-create` at most once per weekly run for systemic gaps.
- Prepare but not commit `templates/agents/*.json` changes unless this run is explicitly tagged `publish-ok` in the kickoff message.
- Skip full `npm run test:browser` — no dashboard edits expected.

## Out of Scope (for this recurring task)

- End-user CLI for model discovery (Pro/internal only per F537).
- Automatic merge of registry changes without human review.
- Discovering `cc` / `cx` models (no public enumerate API — manual curator lane in report).
- Replacing frontier reviewers (Claude/GPT) with OpenRouter — report may recommend, not enforce.

## Open Questions

- Should Pro expose a single `aigon model-catalog-refresh --report` that implements sections 1–5, with this recurring task reduced to "run command + triage"? **Recommended yes** — track as follow-up feature.
- Weekly vs biweekly once catalog drift stabilises?
- **`summary` contract in `model-inclusion-policy.md` §5** — update policy + `validateModelOptions` in the same PR as first summary rollout (follow-up OSS feature).

## Related

- `docs/model-inclusion-policy.md`
- `docs/specs/features/05-done/feature-503-monthly-benchmark-refresh-with-model-discovery.md`
- `docs/specs/features/05-done/feature-537-split-maintainer-benchmarking-tooling-from-oss-user-surface.md`
- `docs/specs/features/01-inbox/feature-bench-monitor.md`
- `docs/specs/features/05-done/feature-456-agent-bench-health-signal.md`
- `site/content/guides/recurring-features.mdx` (Pro engine)
