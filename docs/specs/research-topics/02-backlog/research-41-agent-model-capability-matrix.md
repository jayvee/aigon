---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T12:02:56.539Z", actor: "cli/research-prioritise" }
---

# Research: agent-model-capability-matrix

## Context

Aigon now supports a growing roster of agents and models (cc/Claude Code, gg/Gemini, cx/Codex, cu/Cursor, plus per-agent `modelOptions`). Users pick an agent/model whenever they create a spec, review a spec, implement a feature, or review an implementation — but they have no in-product reference for **what each model is good at, what it costs, or how it has performed on prior Aigon work**. They rely on memory, hearsay, or trial-and-error.

The existing `feature-agent-cost-awareness` spec tackles the *budget* dimension (cycle limits, warnings, opt-in tracking) but stops short of an opinionated **capability** view. There is no single artefact that says, e.g., "for a *review-feature-implementation* on a medium-complexity change, gg-2.5-pro is ~30% cheaper than cc-opus-4.7 and historically catches 80% of the issues."

The user wants a **reference matrix** — initially a read-only table under the dashboard Settings tab — that surfaces, for every installed agent/model:

1. **Strengths / weaknesses per operation** across the four core operations: *create-spec*, *review-spec*, *implement-feature*, *review-feature-implementation*.
2. **Cost as a value-for-money signal** — see "Cost proxy" below.
3. **Internal benchmark performance** — speed and token usage measured on a canonical Aigon benchmark repo (Brewboard is the proposed candidate).

### Cost proxy: public API pricing

Real cost is opaque for subscription plans (Cursor Pro+, ChatGPT Plus, Claude Max, Gemini Advanced) — credits, throttles, and "fair use" obscure the per-operation $. The matrix sidesteps this by **always showing the public API pricing for the underlying model** ($/M input tokens, $/M output tokens, plus a derived $/operation estimate from benchmark token counts). This gives a clean, comparable **value-for-money** signal across agents regardless of how the user actually pays. The agent-cost-awareness billing config remains the source of truth for *quota/budget* state; the matrix's cost column is independent of it.

### Phases (all in scope for this research)

- **Phase A — Show the matrix.** Read-only Settings-tab view; data model for per-agent, per-model, per-operation cells.
- **Phase B — Drive selection from the matrix.** Recommender at the point of agent selection (start modal, review prompts, etc.) that combines operation type, feature complexity, matrix capability scores, and remaining quota.
- **Phase C — Recurring refresh.** Scheduled deep-web-research job that updates public pricing, new model releases, industry consensus on strengths/weaknesses, deprecations, and `quarantined` candidates. Almost certainly delivered via Aigon's standard recurring-features capability (`schedule` skill / cron) — confirm during research.

All three phases are in scope **for the research**, because the data model and read API design are constrained by what Phases B and C need to consume and produce. The research will likely spin out **separate features per phase** (and possibly multiple features within a phase) — that decomposition is one of the deliverables.

## Questions to Answer

### Schema & data model
- [ ] What dimensions belong in the matrix row schema? (agent id, model id, operation, $/M input tokens, $/M output tokens, derived $/operation estimate, latency, token usage, qualitative strength, qualitative weakness, last-benchmark date, last-refresh date, sample size, confidence)
- [ ] Where should the matrix live on disk? (extend `templates/agents/<id>.json`, new `templates/agent-matrix.json`, generated from benchmark runs into `.aigon/`, or split: static spec in templates + dynamic measurements in `.aigon/`?)
- [ ] How do we represent **strengths/weaknesses per operation** in a way that is honest about uncertainty? (free-form notes vs. structured tags vs. 1–5 scores per operation, plus a confidence/source field per cell)
- [ ] How do we keep the matrix in sync as new agents / models are added or `quarantined`? What is the producer of each cell — hand-curated, derived from `modelOptions`, measured by Phase A benchmarks, or refreshed by Phase C?
- [ ] What read API does the matrix expose, and is it the same surface Phase B will consume? (sketch the function signatures Phase B's recommender needs — e.g. `rankModelsForOperation(op, complexity, excludeOverBudget=true)`)

### Benchmarking
- [ ] What is the minimum viable Aigon benchmark? (e.g. one fixed feature spec per operation, run against Brewboard seed-reset state)
- [ ] What metrics can we capture *today* without new instrumentation? (wall time from session start→close, token usage from existing stats logs, success/failure of validation step)
- [ ] What is the workflow to run / re-run the benchmark? (manual `aigon benchmark` command? scheduled? CI?) — design intent only, not implementation.
- [ ] How do we store benchmark history so the matrix can show *current* vs. *trend*? (single latest value, or rolling N runs)
- [ ] Brewboard is one candidate; are there other seed repos better suited to specific operations (e.g. trailhead for review-spec)?

### UI surface
- [ ] What should the Settings-tab table look like at a glance? (rows = model, columns = operation; or rows = operation, columns = model?)
- [ ] How does the user drill into a single cell? (modal with notes, benchmark history, last-run timestamp)
- [ ] Should the matrix be filterable by *installed* vs. *all supported* agents?
- [ ] How is the public-API-pricing cost column displayed when the user pays via subscription? (label clearly as "API-equivalent value-for-money", not "what you'll be charged"; relationship to `agent-cost-awareness` quota state if billing is enabled)

### Phase B — selection driven by the matrix
- [ ] At which selection points does the recommender intervene? (start modal, review-spec, review-feature, autopilot agent picker, others?)
- [ ] What inputs feed a recommendation? (operation type, feature complexity from frontmatter, matrix capability score, public-API $/operation, remaining quota from `agent-cost-awareness`, user preferences/excludes)
- [ ] What does the recommender output? (single suggested agent + rationale, ranked list, badges on existing dropdowns?)
- [ ] How is the recommendation surfaced without being annoying? (passive badge vs. active prompt vs. modal — the dashboard is read-only, so this lives in CLI/start-modal flows)
- [ ] What happens when the matrix is sparse for a given (operation × model) cell? (fallback heuristics, "insufficient data" surfacing)
- [ ] Define the boundary between Phase A (data + view) and Phase B (consumption) so they can ship independently — what minimum matrix shape unblocks Phase B?

### Phase C — recurring web-research refresh
**Working assumption:** the refresh runs as a standard Aigon recurring feature via the existing `schedule` skill / cron infrastructure — it shouldn't need a bespoke runner. The research should validate this fits and only deviate if there's a concrete reason.

- [ ] Confirm the refresh fits Aigon's standard recurring-features capability (`schedule` skill / cron). If it doesn't, what's the gap?
- [ ] What is the right cadence — weekly, monthly, or event-driven (e.g. on new agent install)? What are the trade-offs (signal-to-noise vs. drift)?
- [ ] What does the refresh job actually *do* on each run? Decompose into discrete activities (fetch provider pricing pages, scan release notes, scan reputable benchmark/leaderboard sources, summarise community sentiment, diff against current matrix, propose a patch).
- [ ] What sources are authoritative for each column? (vendor pricing pages for public API $; vendor model cards + release notes for capabilities; LMArena / SWE-bench / Aider leaderboards for benchmarks; HN / lobste.rs / r/LocalLLaMA for community sentiment — which are noise, which are signal?)
- [ ] What is the prompt structure for the deep-research agent? Sketch the actual prompt — inputs (current matrix row, agent id, model id, last-refresh date), tools (WebSearch, WebFetch), expected output (structured patch, citation list, confidence score per cell).
- [ ] How is the refresh delivered to the user? Auto-merge the diff? Open it as a feedback item / feature for review? Post to the Settings tab with a "Review changes" CTA? (The dashboard is read-only per `feedback_dashboard_read_only.md` — refresh must produce reviewable artefacts, not silently mutate state.)
- [ ] How do we handle additions (a brand new model) vs. updates (price change) vs. removals (deprecated model) differently?
- [ ] What is the failure mode? (no internet, source 404, conflicting data across sources) — where does the diff go, and how does the user know it failed?
- [ ] Which agent/model should *run* the refresh? (likely cc-opus or gg-2.5-pro for reasoning; should be configurable per the standard agent-selection pattern)

### Integration & sequencing
- [ ] Does this depend on `feature-agent-cost-awareness` shipping first? Phase A's cost column uses **public API pricing only** so it's independent of billing config — confirm. Phase B's quota-awareness *does* depend on it; sketch the sequencing.
- [ ] What is the recommended order of features across all three phases, and what are the inter-phase dependencies?
- [ ] What concrete follow-on features fall out of this research? Likely split (research will refine):
  - Phase A: matrix data model + Settings table view, internal benchmark runner
  - Phase B: selection recommender (core), per-surface integration (start modal, review prompts, autopilot)
  - Phase C: scheduled deep-web-research refresh job

## Scope

### In Scope
- Designing the data model for the capability matrix (per-agent, per-model, per-operation cells)
- **Cost column = public API pricing only.** Document this proxy and its rationale; the matrix is a value-for-money signal, not a billing reflection
- Choosing an internal benchmarking approach and the metrics captured per run
- Designing the Settings-tab read-only view (information architecture, not visual polish — that comes in implementation)
- **Designing the Phase B selection recommender** — selection points, inputs/outputs, sparseness handling, surfacing strategy. Decomposing into shippable features
- **Designing the Phase C recurring web-research refresh** — cadence, prompts, sources, output format, diff-review flow, failure handling. Confirm fit with Aigon's standard recurring-features capability
- Defining the read API the matrix exposes to Phase B and the write API Phase C uses to propose updates
- Recommending the full feature decomposition across all three phases, with inter-phase dependencies and suggested order

### Out of Scope
- Implementing any of the recommended features (this is research only)
- Real-time provider dashboard integration (already out of scope on `feature-agent-cost-awareness`)
- Token-counting at request time (the Phase C job is *scheduled*, not real-time)
- Visual design of the Settings tab — frontend-design skill will own that during implementation
- Reverse-engineering subscription cost mechanics (Cursor credits, Claude Max throttles, etc.) — public API pricing is the deliberate proxy

## Inspiration / Starting Points
- `docs/specs/features/01-inbox/feature-agent-cost-awareness.md` — billing schema, cost tiers, opt-in pattern (related but distinct: this matrix uses *public API pricing*, that feature tracks *user quota*)
- `templates/agents/*.json` — current agent config shape, `modelOptions`, `cli.complexityDefaults`
- `lib/spec-recommendation.js` — existing model/effort resolution at start time (Phase B will likely extend this)
- Brewboard seed repo — proposed benchmark target (`seed-reset` makes runs reproducible)
- `schedule` skill / cron infrastructure — Phase C should fit this pattern
- Memory: `feedback_quarantine_bad_models.md` — the matrix should make `quarantined` state visible, not hide it

## Findings
<!-- to be filled by research agent -->

## Recommendation
<!-- to be filled by research agent -->

## Output

The research will recommend the final feature decomposition. Likely shape (to be confirmed):

- [ ] Feature: (Phase A — matrix data model + Settings table view, with public-API-pricing cost column)
- [ ] Feature: (Phase A — internal benchmark runner / capture on Brewboard)
- [ ] Feature: (Phase B — selection recommender: ranks agent/model for a given operation + complexity, optionally quota-aware)
- [ ] Feature: (Phase B — recommender integration at selection points: start modal, review prompts, autopilot)
- [ ] Feature: (Phase C — scheduled deep-web-research refresh as a standard Aigon recurring feature)
