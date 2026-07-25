---
aigon_id: F713
complexity: medium
research: 44
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T04:57:04.376Z", actor: "cli/feature-prioritise" }
---

> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.


# Feature: settings-pro-perf-benchmark-dashboard

## Summary

Add a **Pro-gated** section under **Settings** that surfaces **agent performance benchmark results** produced by `aigon perf-bench` (F360). Today runs write JSON under `.aigon/benchmarks/` but there is no dashboard visibility. This feature delivers a **read-only** starting point: a **responsive** matrix/table showing, for each **(agent, model)** row, the **latest** benchmark outcome for **two benchmark kinds**: **feature implementation** (implement/do) and **review implementation** (code-review-style bench). Historic runs and richer charts are explicitly deferred to follow-ups; v1 focuses on **raw structured data** in a single comparable view so operators can scan the matrix on desktop or phone.

Ship **public documentation** alongside the product: **Aigon Pro landing page** (`aigon.build/pro`) and the **detailed docs site** must describe this Pro capability, how it relates to `aigon perf-bench`, and where benchmark artefacts live — so evaluators and subscribers discover the feature without reading the spec.

**Execution context:** Work is executed from this repo (`@aigon/pro`) with integration points in OSS **aigon** (dashboard server, routes, optional thin stubs). Any commit in **aigon** that lands UI/API for this feature should carry `Cross-repo: aigon-pro feature <id>` in the footer once the feature is numbered.

## Background: where benchmark data lives

| Location | Purpose |
|----------|---------|
| `{repo}/.aigon/benchmarks/` | Directory created by `lib/perf-bench.js` (`getBenchmarksDir`). Not gitignored by default — local/CI artefacts; optional future `.gitignore` policy is out of scope unless product asks to commit summaries. |
| `{seed}-{featureId}-{ISO-timestamp}.json` | Per-run result from `writeResult()` — e.g. `brewboard-07-2026-04-28T04-27-15-618Z.json`. Contains `seed`, `featureId`, `agent`, `model`, `effort`, `totalMs`, `baselineMs`, `overheadMs`, `phases[]`, `ok`, `aigonVersion`, `timestamp`, `taskType` (see current writer). |
| `baseline.json` | Optional single baseline for `--check` regression compares — **not** the primary source for the matrix UI. |
| `all-{seed}-{timestamp}.json` | Summary emitted by `runAllBenchmarks` matrix sweeps — pairs list; useful for auditing a sweep; v1 may ignore if per-file latest-per-cell is sufficient. |

**Benchmark kinds (product mapping)**

1. **Feature implementation** — seed `brewboard`, feature `07` (`DEFAULT_SEEDS.brewboard` in `lib/perf-bench.js`): end-to-end “do” / implementation-complete timing.
2. **Review implementation** — seed `brewboard-review`, feature `08`: review-focused fixture documented in `docs/seeds.md` and `DEFAULT_SEEDS['brewboard-review']`.

**Implementation note:** Confirm at build time that `perf-bench` persists **distinct, comparable JSON** for both seeds (including correct `taskType` / phases for review vs implement). If the review seed path is not yet fully exercised by `runBenchmark`, finish or align the harness **before** or **as part of** this feature so the dashboard has two populations to aggregate — do not invent synthetic rows.

## User Stories

- [ ] As an operator with Pro installed, I open **Settings → Performance benchmarks (Pro)** and see a **table** of all relevant **(agent, model)** pairs with **two metric columns** (implementation / review) populated from the **latest successful run per cell** (or latest run with clear error/dash for failures).
- [ ] As someone comparing agents, I can read **raw numbers** in v1: at minimum **total duration** (`totalMs`), and **key phase breakdown** if space allows (e.g. expand row or tooltip) — no charting requirement in v1.
- [ ] As a mobile user, the same page **does not break layout**: wide tables **scroll horizontally** inside a contained region or reflow to **stacked cards** per agent–model, with readable typography and touch-friendly spacing.
- [ ] As a user **without** Pro, I see the same **placeholder pattern** as other Pro settings sections (short explanation + install `@aigon/pro`), not an error.
- [ ] As a **visitor to the Aigon Pro landing page**, I can read a concise description of the **Settings performance-benchmarks** view and why it matters (compare agent/model latest run times for implement vs review benches) with a link into the detailed docs for setup.
- [ ] As a **reader of the detailed docs site**, I find a **dedicated subsection** (or guide) that explains: what the dashboard shows, that data comes from local `.aigon/benchmarks/` JSON produced by `aigon perf-bench`, the two benchmark kinds (implementation vs review seeds), and that the UI is read-only (runs are still via CLI).

## Acceptance Criteria

- [ ] **Settings section** exists with **Pro** badge and title along the lines of “Performance benchmarks” or “Perf bench results”, consistent with existing Pro sections (`templates/dashboard/js/settings.js` section shell + `proBadge: true`).
- [ ] **Data source** is the on-disk benchmark JSON under `.aigon/benchmarks/` for the **current dashboard repo path** — aggregation logic lives in **lib** (new small module or extension of an existing collector), **not** ad hoc parsing in static dashboard scripts. Follow the dashboard read-model discipline: filesystem ownership in one module; HTTP handler returns JSON for the UI.
- [ ] **Latest run per cell**: For each benchmark kind (discriminated by **seed + featureId** pair, or explicit `taskType` once the writer is consistent), for each **(agent, model)** present in JSON files, pick the **most recent** `timestamp` (or file mtime if timestamps missing). Render **totalMs** (formatted human-readable + optional raw ms in tooltip/detail).
- [ ] **Two columns** for the two benchmarks (implementation vs review), **rows** enumerating agents × models from **union** of: registry model options (`collectAllPairs` / agent-registry) **and** any pair that appears in stored JSON (so ad-hoc runs still show up).
- [ ] **Responsive behaviour**: At narrow widths, the table **remains usable** — documented approach in Technical Approach (horizontal scroll **or** card layout); no clipped text without scroll; verify with viewport breakpoint checks (Playwright or manual checklist in PR).
- [ ] **Empty states**: No files → friendly copy (“Run `aigon perf-bench …`”). Partial data → show em dash or “—” for missing cells; failed runs (`ok: false` if present) → show failure indicator per product convention.
- [ ] **Tests**: Unit or integration test for the aggregation helper — **REGRESSION:** latest-per-(seedKind, agent, model) selection and stable sort order.
- [ ] **Pro gate**: Route or payload requires Pro OR UI section is Pro-only — match the pattern used for Insights / Backup & Sync (coordinate with `@aigon/pro` if registration must live in the bridge).
- [ ] **Aigon Pro landing page** (`aigon.build/pro` — e.g. `site/content/pro.mdx` or the current equivalent in the repo that builds the public site) includes this feature: a **short section or bullet** with value prop (compare latest per agent/model for implement + review benches), Pro-only callout, and a **link to the detailed docs** anchor for benchmark settings.
- [ ] **Detailed docs site** (same public site’s guides/docs tree, e.g. `site/content/guides/…` or `docs/…` per current structure) adds or extends a page so operators have **step-oriented coverage**: prerequisites (`@aigon/pro`, benchmark JSON present), how runs are produced (`aigon perf-bench …`), interpreting the table (columns, empty cells, failures), and pointers to OSS **`docs/seeds.md`** / **`perf-bench`** for fixture semantics. Cross-link from the landing page section.

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- When this feature **does** touch dashboard files, run Playwright screenshot per `templates/dashboard/index.html` edits (per OSS aigon agent rules).

## Technical Approach

### Backend

1. **Read module** (e.g. `lib/benchmark-artifacts.js` or name TBD): `listBenchmarkFiles(repoPath)`, `parseFiles`, `buildLatestMatrix(repoPath)` returning a serialisable structure:
   - `kinds`: `[{ id: 'implement', seed: 'brewboard', featureId: '07', label: '…' }, { id: 'review', seed: 'brewboard-review', featureId: '08', label: '…' }]`
   - `rows`: `[{ agentId, modelValue, modelLabel, cells: { implement: {...}, review: {...} } }]`
   - Each cell: `{ timestamp, totalMs, phases?, ok, sourceFileRelative, aigonVersion }` or `null`.

2. **HTTP**: Register `GET /api/benchmarks/latest` (exact path negotiable) in `lib/dashboard-routes/` (or Pro `registerRoute` if gating mandates it). No mutation; read-only.

3. **Perf-bench alignment**: If stored JSON always has `taskType: 'do'`, discriminate runs by **`seed` + `featureId`** until the writer tags `taskType`/`benchmarkKind` explicitly — document the rule in the read module.

### Frontend

1. **Settings**: Add section via the same **addSection** + optional **detached view id** pattern used for Insights / Aigon Sync. If Pro injects markup, mirror `backup-sync-view` / `insights-view` attachment in `init.js` / Pro init.

2. **Table UX (v1)**: Minimal **matrix**: left column **Agent + Model** (stacked or sub-line for model); two data columns **Implementation** and **Review**. Optional third column for **effort** if only single effort is stored; otherwise omit or show in detail.

3. **Responsive**: Prefer a **wrapper** with `overflow-x: auto` and **min-width** on the table for narrow viewports; **or** duplicate **card** layout under a CSS breakpoint using the same data object. Reuse dashboard design tokens (`templates/dashboard/styles.css`). Follow `Skill(frontend-design)` for any new visual work.

4. **No client-side invention of actions** — display only; benchmark **execution** stays CLI.

### Cross-repo / Pro

- If the route must be Pro-only, implement the **thin OSS stub** pattern from `lib/pro.js` / `lib/pro-bridge.js` — only the bridge registers the full handler.
- Primary Pro UI bundle for this section may live in **this package** (`@aigon/pro`) with OSS aigon consuming registered routes/views.

### Documentation (landing + detailed docs)

- **Repos:** Public marketing/docs source typically lives under OSS **aigon** (`site/` — see prior features **F153**, **F211**). Implement docs edits **there** in the same release train as the dashboard feature unless the repo layout has moved — grep `site/content/pro` and follow existing Pro-page patterns (screenshot optional for v1; reuse dashboard screenshot conventions from sibling sections).
- **Landing (`aigon.build/pro`):** Add a subsection or bullet block listing **Performance benchmarks** alongside other Pro bullets; keep tone factual (latest-run matrix, implement vs review columns); link to docs anchor.
- **Detailed docs:** Prefer **`site/content/guides/dashboard.mdx`** “Pro features” / Settings area **or** a short **`site/content/guides/pro-benchmarks.mdx`** (exact path follows IA maintainer choice) with headings: Overview, Generating data (`perf-bench`), Reading the table, Troubleshooting (no files / stale runs).

## Dependencies

- depends_on: none (soft dependency: F360 perf-bench **complete for both seeds** — verify before ship)

## Out of Scope (v1)

- Charts, sparklines, or regression % vs `baseline.json`.
- Editing baselines or triggering `perf-bench` from the UI.
- Cross-repo aggregation (single connected repo only).
- Storing benchmarks in telemetry DB or cloud sync.
- Leaderboard ranking / sorting beyond default (agent registry order + model list order).

## Open Questions

- Should benchmark JSON under `.aigon/benchmarks/` be **gitignored** by default to avoid accidental large commits? (Product/legal — defer unless CI requires otherwise.)
- Exact **Pro** packaging: single route in OSS with Pro check vs full view in `@aigon/pro` — resolve during implementation based on existing Insights pattern.

## Related

- Research: R44 — competitive positioning (benchmark visibility supports positioning narrative).
- Prior features: **F360** — `lib/perf-bench.js`, `aigon perf-bench`; **F371** — brewboard benchmark linkage to agent matrix narrative (`settings.js` mentions benchmarks populating scores).
- Prior docs patterns (OSS aigon site): **F153** — Pro landing page (`site/content/pro.mdx`); **F211** — docs site audit/gaps — reuse structure for new Pro surfaces.
- Docs (OSS aigon): `docs/seeds.md` — brewboard vs brewboard-review fixtures.
