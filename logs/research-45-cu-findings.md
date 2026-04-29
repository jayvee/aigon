# Research 45 — Cursor (cu) findings

**Agent:** cu (Cursor)  
**Topic:** per-repo learned recommender from transcripts  
**Date:** 2026-04-28

## Gating status

The topic explicitly says **do not start until the `transcript-program` set is fully done** (read-model, durable hot tier, pipe-pane opt-in for cu/op/km, dashboard surface). This session ran `research-do 45` anyway; these findings treat **architecture and interfaces** as in scope and **corpus-derived taxonomy / N thresholds** as **pending empirical work** once `~/.aigon/transcripts/<repo>/...` is populated as described in the spec.

## Signals inventory (codebase-aligned)

| Signal | Role for learned recommender | Notes |
|--------|------------------------------|--------|
| Feature log + F332 frontmatter | Primary outcome labels (duration, scope, agent/model) | Already aggregate-friendly; spec cites manual demo for F381–415 |
| `lib/telemetry.js` | Token/cost per session, transcript-backed paths for cc/gg/cx (+ strategies) | `captureAgentTelemetry` already branches transcript strategies; good hook for cost model |
| Session sidecars F357 | Deterministic reattach + `agentSessionPath` | Links feature ↔ transcript file without rescans |
| Git / commit metadata | Reviewer effectiveness (`fix(review)`-style heuristics) | Spec’s proposal is sound; needs convention grep + noise filter |
| Transcript bodies (post program) | Failure modes, stumble patterns, turn-level cost | Not yet the single canonical tree the spec assumes at research time |

## Question-by-question (proposed answers / hypotheses)

### 1. Minimum viable corpus size (N)

**Hypothesis:** Start with **N ≥ 5–8 completed features** per bucket `(agent, model_effort_bucket, complexity)` before showing learned dominance; **N < 3** → show static-only with “insufficient data” badge.  
**Refinement needed:** A/B once buckets are defined (Fleet vs solo changes variance). Use **Wilson-score lower bound** or simple min-N gate for UI copy, not raw averages.

### 2. Spec-shape similarity

**Recommendation:** **Tiered hybrid** — (1) **complexity** always as coarse prior; (2) **`depends_on` / set membership** if present; (3) **keyword TF-IDF or cheap embedding** on spec title + acceptance criteria; (4) **file-overlap** from implementation log touched paths once F332 lists them.  
**Rationale:** File overlap is high signal for *this* codebase (module ownership) but sparse early; keywords rescue cold intra-module cases.

### 3. Failure-mode taxonomy

**Cannot complete from sampling until gated corpus exists.** **Seed labels** (from spec) are the right starting set: scope-creep, orientation thrashing, abandoned approach, ignored failing test, clarify vs guess, judgment-loop.  
**Process:** 20–30 random stratiﬁed pulls from closed features + transcripts → dual-code → merge categories → attach **regex/tooling hints** only where stable (e.g. repeated file open counts from telemetry sidecars if exposed).

### 4. Cold-start blend

**Validate the stated approach:** `score = λ(static) + (1-λ)*learned` with λ → 0 as `min(N, bucket_weight)` crosses threshold; cap learned influence if variance is high.  
**Addition:** expose λ and N in “explain” payload for trust.

### 5. Recommendation surfaces

**Align with F313/F291:** extend existing **`/api/recommendation/:type/:id`** and dashboard pre-select; add **optional `feature-start --explain`** (or env) for CLI parity. **Spec-create** is weaker signal (no shape yet) — use **static + org defaults** there; shift learned weight to **spec-start** and **dashboard** when spec + deps exist.

### 6. Reviewer pairing vs implementer

**Separate models:** implementer outcome = merge quality + iterate count + log metrics; reviewer outcome = delta after review (fix commits, test recovery), optionally **reviewer transcript length / loop** as negative signal. **Do not** collapse into one embedding.

### 7. Cost prediction

**Use transcript token series** (already normalized in telemetry paths) to fit **turns ~ f(complexity, file_touch_count)** and **cost ~ turns × marginal rate** from rolling telemetry. Ship **interval** as percentile bootstrap on same-bucket historicals, not a single point.

### 8. Privacy / portability

**Default (a) per-repo only** in OSS; **(b) opt-in cross-repo** as Pro/AADE with explicit manifest; **(c) anonymised global baseline** only as deferred product research (out of scope per topic). Matches spec’s commercial split.

### 9. Outlier / “resembles F415” warnings

**Threshold:** top-k similar specs by hybrid score where **any** had high-severity taxonomy tag → show amber banner with **feature id + tag + sample size**, not blocking. Tune false-positive rate on seed repo first.

### 10. Explain UX

**Structured object:** `{ matchedFeatures[], bucketN, confidenceInterval, staticFallbackUsed, rejected[]: [{ agentModel, reason, stumbleTags[] }] }`. Matches “reasoning not just answers” without dumping raw transcript.

## Storage / refresh / API (architecture)

- **Storage:** `.aigon/recommender/index.json` (or versioned dir) written **idempotently** after `feature-close` success path + optional nightly recompute — same write-path discipline as AGENTS.md (engine owns lifecycle; recommender is derived cache).
- **Query:** extend **`lib/spec-recommendation.js`** + **`/api/recommendation`** response shape with optional `learned` block when present; never break existing F313 clients (additive JSON).
- **Invalidation:** on transcript-program migrations, bump schema version in index and force recompute flag.

## Risks

- **Gating:** building similarity on transcripts before durable paths exist will churn paths — spec is correct to block.
- **Fleet:** winner/loser attribution must be explicit in events or learned scores will leak credit.
- **PII:** transcripts may contain secrets — recommender index should store **hashes/ids + aggregates**, not raw excerpts, unless user opts into explain snippets from local-only store.

## Summary for research-eval

Ship order suggestion: (1) corpus index + bucket stats from logs + telemetry only; (2) hybrid similarity + API extension; (3) cold-start blend in start modal; (4) reviewer split signal; (5) cost interval; (6) explain payload + outlier banner. Transcript taxonomy work runs parallel once program is done.
