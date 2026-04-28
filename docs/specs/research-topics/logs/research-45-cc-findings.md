# Research Findings: per repo learned recommender from transcripts

**Agent:** Claude (cc)
**Research ID:** 45
**Date:** 2026-04-28

---

## Key Findings

### What already exists (don't rebuild)

- `lib/spec-recommendation.js:rankAgentsForOperation(op, complexity)` already produces a per-agent ranking that blends `cli.modelOptions[].score[op]` (1–5 qualitative, hand-coded) with a normalised cost penalty drawn from `.aigon/cache/stats-aggregate.json` `perTriplet[agent|model|effort]`. Confidence is `low` when the bucket has zero benchmark sessions, `medium`/`high` when there is data. The learned recommender does **not** need a parallel ranking pipeline — it needs to fill the `perTriplet` rollup with real signal and add similarity-aware buckets.
- `lib/transcript-read.js:collectTranscriptRecords` already returns telemetry per record: `{ model, turnCount, toolCalls, tokenUsage, costUsd, startAt, endAt }`. That is enough for cost-prediction without re-parsing transcripts.
- `lib/stats-aggregate.js` is a lazy, idempotent rebuild — the natural place to compute `perBucket[agent|model|effort|spec-shape]` once a similarity heuristic exists.
- `lib/dashboard-routes/recommendations.js` already serves `/api/recommendation/:type/:id`. Extend that route, do not add a new endpoint.

### Corpus reality (what we actually have on 2026-04-28)

```
~/.aigon/transcripts/aigon/feature/{422,423,430,433,434,436,437,438}/
                      → 7 features captured by cc, 2 by cx
                      → 0 by gg/cu/op/km (transcript program only just shipped)
docs/specs/features/05-done/  → 382 specs (most pre-date transcript capture)
```

This is the central tension of the research: there are **two corpora**, not one.

1. **Transcript corpus (~9 features so far)** — high-fidelity per-turn data, but dwarfed by the historical baseline. Will grow ~1–2 features/day at current pace.
2. **Log + telemetry corpus (~130 features in `stats-aggregate`, 382 spec files)** — aggregate cost/turns/duration only, no per-turn fidelity, but already covers months of work.

A learned recommender that waits for the transcript corpus to mature is useless for ~6 months. A learned recommender that ignores the transcript corpus is only marginally better than the static one. The right shape is **two-tier**: aggregate-now, transcript-when-ready, with the same external API.

### Q1 — Minimum viable corpus size

Per (agent, model, complexity) bucket. With 4 complexity levels × 6 agents × ~3 models per agent ≈ 72 buckets. At ≥3 samples for "medium" confidence and ≥10 for "high" (matching the existing convention in `rankAgentsForOperation`), full coverage needs roughly 200–700 closed features. Today's 130 covers maybe 5–10% of buckets.

**Implication:** do not gate the recommender on full coverage. Recommend the rule:

- `n=0` → static qual score only, label `confidence: low (no data)`
- `n=1–2` → static + soft-pull toward observed mean, label `confidence: low (n=1)` or `low (n=2)`
- `n=3–9` → Bayesian shrinkage: `score = (n·observed + k·static) / (n + k)` with `k ≈ 5`. Label `medium`
- `n≥10` → observed dominates, label `high`

This is what F398 already implies but never formalised. Same numbers should work for both spec-shape buckets and complexity-bucket-only fallback.

### Q2 — Spec-shape similarity heuristic

Three candidate signals, ranked by cost/value:

| Heuristic | Cost | Value | Notes |
|-----------|------|-------|-------|
| Complexity bucket only | trivial | low | Already implemented; floor |
| File-overlap (modules touched) | cheap | high | `git log --name-only` on the closed feature's commits → set of `lib/*` files; Jaccard against a candidate spec's "expected scope files" (already estimated by `parseLogFrontmatterForBackfill` in `lib/feature-command-helpers.js`) |
| Keyword cosine (spec body) | medium | medium | Small TF-IDF on titles + headings; needs a stopword list and stemming |
| Hybrid (file-overlap + complexity bucket, with keyword as tiebreaker) | medium | highest | Recommended |

**Recommendation:** ship the hybrid. The "expected scope files" infrastructure already exists from F332. Spec specs (heh) without a scope hint fall back to complexity bucket. Keyword cosine should be deferred to a separate feature — it adds an offline-index dependency for marginal gain over file-overlap on this codebase.

### Q3 — Failure-mode taxonomy (sampled, not pre-decided)

Before sampling I would have guessed the categories the question lists. After grepping a handful of recent transcripts for telltale tool-call patterns, the taxonomy that actually shows up most often in **this** corpus is:

1. **Orientation thrashing** — same `Read` of the same file 3+ times within a 20-turn window without an intervening `Edit`. Easy to detect mechanically (turn-by-turn tool log).
2. **Spec drift** — `Edit` lands on a file whose path is not in the spec's expected-scope list, and the diff > 50 lines. Detectable from log frontmatter + commit diff.
3. **Stalled review loop** — alternating `Bash:npm test` and `Edit` on the same file for >5 cycles with no commit. Signals fix-by-poking. Detectable from tool-call timestamps.
4. **Abandoned approach** — file created in turn N, then deleted/reverted by turn N+M before close. Detectable from `git log --diff-filter=D` against the worktree.
5. **Cold-start over-reading** — first 30 turns are >80% `Read`/`Glob`/`Grep`, no `Edit`. Real per the recent cc transcripts I sampled.
6. **Premature close attempt** — `feature-close` tool-call attempt followed by error followed by 5+ more turns of work. Detectable from session-end events.

**Notably absent so far** (small sample): "ignored failing test" and "judgment-loop debate before code" — the corpus right now is too small to claim them as patterns. They may exist; the research caveats this as "rebuild taxonomy at n≥30 features".

**Implementation path:** rules first (deterministic regex/state-machine over the JSONL turn stream), LLM-based pattern discovery deferred to a separate feature once the rule-based classifier has produced a year of labels worth comparing against.

### Q4 — Cold-start blending

Already addressed in Q1 (Bayesian shrinkage). The static `cli.modelOptions[].score[op]` becomes the prior `k=5` mean. This avoids the failure mode where a single bad run permanently buries a strong agent in a small repo.

A subtle point: the cold-start blend should be **per-bucket**, not global. An agent might have plenty of samples for `complexity:medium` but none for `complexity:very-high`. Each bucket starts cold independently.

### Q5 — Recommendation surface

- **Spec-create time:** keep the existing F313 behaviour — only complexity is asked for, recommendation pre-fills agent dropdown defaults. Do not surface ranked alternatives here; they distract from the spec-writing task.
- **Spec-start time (start modal):** primary surface. Show top 3 ranked agent+model combinations with confidence bands and one-line rationale. This matches the F291 dashboard agent-model picker shape.
- **Dashboard "explain" panel:** secondary surface. Per-feature, click-to-expand: matched-similar-features list, stumble patterns observed for the rejected alternatives, sample size, confidence band. Lives in the side panel.
- **CLI:** `aigon feature-start <ID> --explain` prints the same payload to stdout — needed for non-dashboard users and for autonomous mode where the picker doesn't render.

Three surfaces. Single API endpoint (`/api/recommendation/:type/:id?include=ranked,similar,stumbles`).

### Q6 — Reviewer pairing

This is genuinely a separate signal. A "good" implementer is one whose code lands; a "good" reviewer is one whose review **changes the code in a way that survives**. The metric:

- For each closed feature where review happened: count commits authored *after* the review session whose diff intersects files the review flagged. Filter for diffs > 5 lines (excludes whitespace/comment-only). That is the "real-fix" count.
- Reviewer score = `real-fixes / total-reviews` for that (reviewer-agent, implementer-agent) pair.

The signal must be pair-conditional — `(cc-implementer, gg-reviewer)` is a different cell from `(cx-implementer, gg-reviewer)`. With 6 agents that is 30 ordered pairs; far sparser than implementer-only data. Cold-start matters even more here, so the same Bayesian shrinkage pattern applies, with the prior being "all-pairs average".

### Q7 — Cost prediction

Per-turn data is in telemetry. The model is straightforward:

- For each (agent, model, similarity-bucket): collect `turnCount` and `costUsd` distribution
- Predict expected cost as `median(costUsd)` with 25th/75th as the band
- Predict expected turns as `median(turnCount)` for "is this going to take an hour or a day?"

This is a confidence interval, not a point estimate, per the question. Caveat: telemetry's `costUsd` is sometimes null for cu/op/km (transcript capture limited), so the cost band is currently agent-conditional, not universal.

### Q8 — Privacy / portability

Three options from the spec:
- (a) Per-repo only — start here. No new privacy surface, no new infrastructure.
- (b) Opt-in cross-repo aggregation for AADE/Pro — natural commercial ladder. Per project memory ("AADE as commercial product"), the learned recommender is a strong Pro candidate.
- (c) Anonymised shared baseline — explicitly out of scope per spec. Defer to a separate research topic.

**Recommendation:** OSS ships (a). Pro adds the cross-repo aggregation sync. Anonymised contribution is a separate decision — spec body content leaks information that file-paths-only summaries do not, so the privacy review is non-trivial.

### Q9 — Outlier flagging

Mechanically: when a candidate spec's similarity to a *high-stumble* historical feature exceeds threshold T, flag. Threshold tuning needs a small labelled set, but a sensible default is "Jaccard ≥ 0.5 AND historical feature had ≥2 stumble events from the taxonomy in Q3".

UI shape: a single "⚠ similar to F415 (cascade + spec_drift with opus)" line in the start-modal explain panel. Click expands the historical feature link. **Do not** auto-disable the flagged option — the user gets to decide.

### Q10 — "Explain my recommendation" UX

Per project memory ("user values reasoning, not just answers"), the explain payload must include:

- **Matched similar features** (ID + title + agent that won + outcome): up to 5
- **Sample size and confidence band**: text label + visual indicator (e.g. low/medium/high pill matching `rankAgentsForOperation`'s existing `confidence` field)
- **Stumble patterns observed for rejected alternatives**: "GG was rejected because in 2/3 similar features it hit orientation-thrashing"
- **Cost band**: "expected $0.40–$1.20 (n=12 similar features)"
- **What a different choice would change**: "If you pick GG instead, expected outcome based on 3 similar features: …"

Shape: Markdown rendered server-side from a structured payload. Frontend renders only — no per-field branching.

### Architectural shape (synthesis)

```
.aigon/recommender/
  index.json              # corpus index: per closed feature → {agent, model, complexity, scope-files, telemetry, stumbles[]}
  buckets.json            # rolled-up per-bucket aggregates (sampled mean, variance, n)
  rebuild.lock            # exclusive write lock during rebuild

Rebuild trigger: feature-close (incremental append to index.json + bucket recompute)
Full rebuild:    aigon doctor --recompute-recommender (idempotent)
Read API:        /api/recommendation/:type/:id?include=ranked,similar,stumbles,cost
                 → { ranked: [...], similar: [...], stumbles: [...], cost: {...}, generatedAt, corpusSize }
Write API:       (none — read-only)
```

This stays inside the existing patterns: lazy idempotent cache (like `stats-aggregate`), exclusive locking (like workflow-core), single API endpoint extension (like F313).

## Sources

- `lib/spec-recommendation.js:103` — `rankAgentsForOperation` — existing static + cost recommender
- `lib/stats-aggregate.js` — `.aigon/cache/stats-aggregate.json` — already-cached per-agent/triplet rollup
- `lib/transcript-read.js:75` — `collectTranscriptRecords` — telemetry shape per session
- `lib/transcript-store.js` — durable hot-tier transcript paths (transcript-program output)
- `lib/feature-command-helpers.js:parseLogFrontmatterForBackfill` — F332 log frontmatter (cost, turns, files, model)
- `~/.aigon/transcripts/aigon/feature/{422,423,430,433,434,436,437,438}/` — current corpus
- `.aigon/cache/stats-aggregate.json` — 130 features rolled up; `perTriplet` currently empty (see top of file: "version 2", `perTriplet: {}`)
- F313 (recommended-model-on-create), F370–378 (agent-matrix), F398 (model capability scores), F291 (dashboard picker), F332 (log format) — prior-art chain referenced in spec
- AGENTS.md `## Hot rules` — F313 frontmatter resolver location
- Project memory: "AADE as commercial product", "user values reasoning"

## Recommendation

Ship a **per-repo learned recommender** built as a thin extension of the existing static recommender, not a parallel pipeline.

1. Two-tier corpus from day one. Aggregate (telemetry + log frontmatter, broad but shallow) for all 130+ closed features now. Transcript-derived (per-turn fidelity, narrow but deep) layered in as transcript coverage grows. Same external API; both feed the same `rankAgentsForOperation` interface.
2. Bayesian shrinkage cold-start with `k=5` against the existing static `cli.modelOptions[].score[op]` priors. Confidence bands match the existing `low/medium/high` convention.
3. Hybrid spec-shape similarity = file-overlap (Jaccard on `lib/*` modules) + complexity bucket, with keyword cosine deferred.
4. Rule-based stumble classifier first (six initial categories from real transcripts), LLM-based discovery deferred until n≥30 transcripts/category.
5. Reviewer pairing learned as a separate (reviewer, implementer)-pair signal scored on real-fix commits (>5 line diffs in flagged files).
6. Cost prediction surfaces as a 25th/75th-percentile band, not a point estimate.
7. Storage in `.aigon/recommender/` (per-repo, gitignored). Per-repo only in OSS; cross-repo aggregation as a Pro feature; anonymised contribution explicitly deferred.
8. Single API endpoint extension (`/api/recommendation/:type/:id?include=...`); three surfaces (start modal, dashboard explain panel, `feature-start --explain` CLI flag).
9. Explain UX returns a structured payload with similar features, sample size, confidence, stumbles for rejected alternatives, cost band — never a bare score.

Critical risk to flag: shipping the explain panel before the corpus is large enough makes the recommender feel unreliable. Land the corpus index + API silently first; turn on the user-visible UX after a calibration window of ~50 closed features (~3 weeks at current rate).

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| learned-recommender-corpus-index | Index closed features into `.aigon/recommender/index.json` (telemetry + log frontmatter + scope-files); incremental rebuild on `feature-close`, full rebuild via `aigon doctor`. | high | none |
| learned-recommender-bucket-aggregates | Roll the corpus index into per-bucket aggregates (`buckets.json`); compute Bayesian-shrunk score against static `cli.modelOptions[].score[op]` priors with `k=5`. | high | learned-recommender-corpus-index |
| learned-recommender-similarity-spec-shape | Implement hybrid file-overlap + complexity-bucket similarity heuristic; expose `findSimilar(spec)` returning ranked similar features with Jaccard scores. | high | learned-recommender-corpus-index |
| learned-recommender-stumble-classifier-rules | Rule-based detector for the six taxonomy categories (orientation-thrashing, spec-drift, stalled-review-loop, abandoned-approach, cold-start-over-reading, premature-close); writes labels into the corpus index. | medium | learned-recommender-corpus-index |
| learned-recommender-api-extension | Extend `/api/recommendation/:type/:id` with `?include=ranked,similar,stumbles,cost`; integrate ranked output into existing F313 frontmatter resolver path. | high | learned-recommender-bucket-aggregates, learned-recommender-similarity-spec-shape |
| learned-recommender-explain-ux | Dashboard explain panel + `feature-start --explain` CLI flag; renders ranked alternatives, matched similar features, confidence band, cost band, stumbles for rejected agents. | medium | learned-recommender-api-extension, learned-recommender-stumble-classifier-rules |
| learned-recommender-reviewer-pairing | Separate (reviewer-agent, implementer-agent)-pair score based on real-fix commits (>5 line diff intersecting flagged files); expose in API and start-modal review-agent slot. | medium | learned-recommender-bucket-aggregates |
| learned-recommender-cost-prediction | Per-bucket `costUsd` and `turnCount` percentile bands (25/50/75); surface as expected-cost range in explain UX. | low | learned-recommender-bucket-aggregates |
| learned-recommender-outlier-flag | Detect candidate-spec similarity to high-stumble historical features above threshold; surface single-line ⚠ in start modal. | low | learned-recommender-similarity-spec-shape, learned-recommender-stumble-classifier-rules |
| learned-recommender-pro-cross-repo | Pro-tier: opt-in cross-repo aggregation of bucket scores, syncing per-bucket aggregates (not raw transcripts) into a user-owned aigon-pro vault. | low | learned-recommender-bucket-aggregates |
