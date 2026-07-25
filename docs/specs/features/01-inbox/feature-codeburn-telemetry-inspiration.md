---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: codeburn-telemetry-inspiration

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Study the open-source [Codeburn](https://github.com/getagentseal/codeburn) project’s approach to reading agent CLI telemetry from disk (multi-provider adapters, SQLite vs JSONL vs JSON sessions, pricing via [LiteLLM](https://github.com/BerriAI/litellm), caching, and normalization). Use that review to improve Aigon’s telemetry pipeline: clearer adapter boundaries, faster or more accurate extraction where Codeburn does better, and a repeatable pattern for adding future CLI providers—without copying proprietary Codeburn code verbatim (MIT-licensed upstream is fine to learn from; respect licenses and cite inspiration in implementation notes).

**Pricing alignment:** Aigon already derives USD estimates from `templates/agents/<id>.json` `cli.modelOptions[].pricing` plus legacy fallbacks in `lib/telemetry.js` (`getModelPricing`). Extend this so **LiteLLM’s published model-price data is the definitive upstream** for token rates (same philosophical choice as Codeburn), **cached inside Aigon** (duration/TTL and offline fallback behaviour decided at implementation—mirror Codeburn’s local cache pattern). **One canonical pricing resolver** must feed telemetry capture, **agent matrix**, and **agent benchmarks** so displayed `$` / token-derived columns stay consistent everywhere (avoid drift between dashboard matrix UI and benchmark artifact summaries).

## User Stories

- [ ] As an Aigon maintainer, I want a concise internal summary of how Codeburn discovers paths, parses each provider, and prices tokens so we can cherry-pick proven patterns.
- [ ] As an Aigon user, I want telemetry capture for supported agents to stay accurate as CLIs evolve, including new tools we adopt later.
- [ ] As an operator running Fleet/benchmarks, I want capture hooks and parsers to avoid redundant full-disk scans and unnecessary subprocess churn where Codeburn shows a cheaper approach.
- [ ] As someone reading **agent matrix** or **benchmark** results, I want cost figures to come from the **same pricing rules** as session telemetry—not hand-maintained duplicates that drift when vendors change rates.

## Acceptance Criteria

- [ ] **Codeburn survey (artifact)**: Short design note (implementation log entry, `docs/` addendum agreed at implementation time, or spec-linked markdown in the feature worktree) listing: provider list overlap with Aigon agents, on-disk layouts Codeburn uses, and 3–5 concrete takeaways mapped to Aigon modules (e.g. `lib/telemetry.js`, `lib/commands/misc.js` capture commands, agent template hooks).
- [ ] **Gap analysis**: Table or bullet list of Aigon agents / CLIs vs Codeburn providers—what Aigon already covers, what Codeburn covers that Aigon does not, and what is intentionally out of scope.
- [ ] **Adapter pattern**: Either document an explicit “provider adapter” interface (inputs: repo path, agent id, optional session hints; output: normalized fields compatible with existing `.aigon/telemetry/` JSON schema) or refactor toward one—without breaking existing `capture-session-telemetry` / `capture-gemini-telemetry` / `captureAgentTelemetry` consumers.
- [ ] **At least one measurable improvement** shipped from the survey, e.g.: reduced duplicate reads, clearer dispatch by agent/strategy, improved model-ID normalization for pricing parity, SQLite read path reused where Codeburn-style querying beats full transcript walks, or a **new** adapter stub + wiring checklist for one additional CLI aligned with Codeburn’s provider model (scoped during implementation).
- [ ] **Tests**: New or extended unit/integration coverage for touched parsers or dispatch paths (`lib/telemetry.test.js` or adjacent tests in OSS repo).
- [ ] **No regression**: Existing telemetry flows for cc / cx / gg / op (and any other agents already capturing) continue to produce valid normalized records and dashboard-visible aggregates where applicable.
- [ ] **LiteLLM-backed pricing + cache**: Implement (or extend) a pricing pipeline where LiteLLM model price tables are the **authoritative source**, fetched periodically and **stored locally** under Aigon control (path + TTL documented; stale-cache behaviour defined for offline/air-gapped use). Map LiteLLM model IDs to Aigon/registry IDs via alias/overrides where needed—reuse lessons from Codeburn’s model-alias UX where applicable.
- [ ] **Single resolver**: Telemetry (`costUsd` / `tokenUsage`), **agent matrix** (`dashboard/benchmark-matrix.js` and related collectors), and **benchmark artifacts** (`lib/benchmark-artifacts.js` and matrix inputs) must all resolve per-model rates through this shared module—no parallel hard-coded rate tables unless documented as intentional fallback tiers (legacy → registry → LiteLLM cache).
- [ ] **Benchmark/matrix sanity**: Add or extend tests proving that identical token usage + model ID yields identical computed cost in telemetry normalization and in benchmark/matrix aggregation paths (fixture-driven OK).

## Validation

```bash
cd ~/src/aigon && npm test
cd ~/src/aigon-pro && npm test
```

(Adjust paths if worktrees differ; run the suite for every repo touched.)

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

1. **Clone / read Codeburn** (vendored fork or upstream `main`): focus on `src/providers/*.ts` (README: “Adding a new provider is a single file”), discovery layer, SQLite usage (Cursor, OpenCode), JSONL/Gemini/Claude patterns, and LiteLLM pricing cache behaviour—not the Codeburn TUI itself.
2. **Map to Aigon**: Today’s pipeline centres on OSS `~/src/aigon/lib/telemetry.js` (parsers, `writeNormalizedTelemetryRecord`, pricing helpers, aggregation) and `lib/commands/misc.js` (`capture-session-telemetry`, `capture-gemini-telemetry`, stdin JSON envelope). Hooks live in `templates/agents/*.json` (e.g. cc `SessionEnd`, gg `AfterAgent`). Pro repo consumes `.aigon/telemetry/` for backup/retention (`lib/backup.js`, sync)—avoid breaking filenames/schemaVersion unless explicitly versioned.
3. **Improvements (pick concrete items in implementation)**:
   - Consolidate per-provider parsing behind a small registry keyed by agent/strategy (mirrors Codeburn’s one-file-per-provider clarity).
   - Adopt caching or incremental reads only where correctness is preserved (telemetry files can be append-only).
   - Align ambiguous pricing/model-alias behaviour with lessons from Codeburn + LiteLLM (without duplicating Codeburn’s entire pricing stack unless justified).
4. **Pricing (LiteLLM + Aigon cache)** — inspired by Codeburn’s LiteLLM integration:
   - Add a small **`lib/` module** (exact name at implementation time) responsible for: downloading/updating LiteLLM price JSON (or vendoring a pinned snapshot + upgrade command), merging **operator overrides** (equivalent to today’s `modelOptions.pricing` for models LiteLLM does not list), and exposing **`getModelPricing(modelId)`** (or equivalent) for all callers.
   - **`lib/telemetry.js`** should delegate rate lookup to that module instead of owning the full pricing table alone; keep backward-compatible behaviour for existing bench/feature sessions.
   - **Pro dashboard**: ensure **`dashboard/benchmark-matrix.js`** cost displays and **`lib/benchmark-artifacts.js`** rollups use the same resolver (either by importing shared OSS logic via aigon CLI boundary, duplicating **cache file location** contract in docs, or extracting a tiny shared package—pick the smallest change that guarantees one source of truth).
   - Document **refresh**: CLI subcommand or `aigon …` hook (optional) to refresh cache; default TTL aligned with Codeburn-style practicality (e.g. 24h) unless product asks otherwise.
5. **Cross-repo**: Telemetry parsers + pricing module live in **OSS aigon**; **aigon-pro** updates matrix/artifacts/dashboard glue so benchmarks and matrix never compute `$` independently—document paths in `## Cross-repo touch`.

## Cross-repo touch

- **aigon (OSS)** — primary: `lib/telemetry.js`, new LiteLLM pricing/cache module, `lib/commands/misc.js`, `templates/agents/*.json`, tests under `tests/`.
- **aigon-pro** — **`dashboard/benchmark-matrix.js`**, **`lib/benchmark-artifacts.js`**, and any dashboard collectors that derive **cost from tokens × rates** must call into or mirror the canonical resolver contract; also `lib/backup.js` / `lib/sync-merge.js` if telemetry file shape changes.

## Dependencies

- Existing telemetry foundation: feature 123 (aade-telemetry), later parity work (e.g. feature 453 agent telemetry token capture parity)—treat current behaviour as baseline.
- Optional mental overlap: research topic `research-integrate-with-llm-observability-tools` (external observability SaaS—not required for this feature).

## Out of Scope

- Owning LiteLLM releases or vendoring their entire codebase—only consume **published price data** (or their documented JSON artifact) under their license terms.
- Reimplementing Codeburn’s full product (TUI, optimize/yield/compare commands, menu bar).
- Replacing Aigon’s storage model with Codeburn’s (Aigon keeps normalized JSON under `.aigon/telemetry/` unless a separate spec changes that).
- Network-based telemetry proxies or third-party observability backends (HoneyHive, Langfuse, etc.)—see research topic above.

## Open Questions

- Which **one** additional CLI provider (if any) is highest priority after the survey—Kimi, OpenClaw, Pi, or another already in Codeburn’s table?
- **Precedence when sources disagree**: LiteLLM vs operator override in `modelOptions.pricing` vs legacy fallback—define explicit precedence (suggestion: operator override wins for listed IDs, LiteLLM fills gaps).
- Where should the cache file live (`~/.cache/aigon/`, `.aigon/cache/`, or project-local) for predictable behaviour across dashboard vs CLI?
- Does dashboard or Insights need new dimensions (e.g. Codeburn-style activity categories), or stay token/cost-first?

## Related

- External: [Codeburn — getagentseal/codeburn](https://github.com/getagentseal/codeburn), [LiteLLM — BerriAI/litellm](https://github.com/BerriAI/litellm) (pricing model list / JSON consumed by Codeburn-style tooling)
- Research: `docs/specs/research-topics/01-inbox/research-integrate-with-llm-observability-tools.md` (related landscape; optional cross-link)
- Prior features: #123 aade-telemetry, #453 agent telemetry token capture parity (cc/gg/op patterns), #208 telemetry activity breakdown
- Aigon telemetry implementation: **`~/src/aigon/lib/telemetry.js`** (OSS—not in this repo)
