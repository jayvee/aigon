---
complexity: high
transitions:
  - { from: "in-evaluation", to: "done", at: "2026-04-29T11:00:59.304Z", actor: "cli/research-close" }
  - { from: "inbox", to: "backlog", at: "2026-04-28T13:34:32.803Z", actor: "cli/research-prioritise" }
---

# Research: per-repo-learned-recommender-from-transcripts

## ⚠️ Gating Note — Revise Before Starting

**Do not start this research until the `transcript-program` set is fully done.**

Members of `transcript-program` (must all be in `05-done` first):
- `transcript-read-model-and-cli` — programmatic discovery of transcript paths (API + CLI; dashboard UI in F431)
- `transcript-durable-hot-tier` — persistence past worktree deletion
- `transcript-tmux-pipe-pane-optin` — coverage for cu / op / km
- `transcript-dashboard-surface` — dashboard Open transcript (+ optional preview); depends on the full read-model including tmux/durable paths

This research depends on a real transcript corpus existing in `~/.aigon/transcripts/<repo>/...`. Without the program shipped, the research would spend most of its scope debating "where do transcripts come from," which `research-43` already answered. The transcript program is its own work, scoped separately.

**On unpause:** revise this topic with whatever was actually built (paths, schema, coverage), then prioritise.

## Context

Aigon already has a static model recommender (F370-378 agent-matrix, F313 recommended-model-on-create, F398 model capability scores) driven by hand-coded scores in `templates/agents/<id>.json` `cli.modelOptions[].score.{spec_review, implement, review, spec, research}`. Those scores answer "Which model is theoretically good at this complexity?"

This research scopes the next step: a **per-repo learned recommender** that answers "Which agent+model has actually worked well in *this* repo on features of *this* shape over the last N days?" — using both the existing feature log metrics (F332) and the transcript corpus (transcript-program).

The existing data already supports an aggregate-only version (demonstrated manually for F381-415 in the design conversation that produced this topic — see commit history around 2026-04-28). The transcript-aware version is materially more capable (per-turn fidelity, failure-mode classification, intent-vs-diff analysis, stumble pattern detection).

## Questions to Answer

- [ ] What's the minimum viable corpus size for confident recommendations? (e.g. ≥N features per agent+model+complexity bucket — what's N?)
- [ ] What spec-shape similarity heuristic produces the best matches? Options: file overlap (which `lib/*` modules touched), keyword overlap (spec body), complexity bucket only, or a combination.
- [ ] What failure-mode taxonomy emerges from reading actual transcripts in the corpus? Build the taxonomy by sampling, not pre-deciding. Suggested seeds: scope-creep moment, orientation thrashing (re-read same file 3+ times), abandoned approach mid-implementation, ignored failing test, asked clarifying question vs guessed, judgment-loop debate before code.
- [ ] How should the cold-start problem be handled? Current proposal: blend static scores from `templates/agents/*.json` with learned scores; learned scores take over once a bucket has ≥N samples. Validate or refine.
- [ ] What does the recommendation surface look like? At spec-create time? At spec-start? In the dashboard? All three? Match the existing F291/F313 surfaces.
- [ ] How is reviewer pairing learned separately from implementer choice? Reviewer effectiveness signal: does the review pass produce real fixes (commits with `fix(review)` and meaningful diff) or cosmetic changes? Examine reviewer transcripts and resulting fix commits.
- [ ] What's the cost-prediction model? Per-turn token + cost data is available in transcripts. Map spec shape → expected turns → expected cost. Confidence interval, not point estimate.
- [ ] Privacy/portability: should learned scores be (a) per-repo only, (b) opt-in cross-repo aggregation for AADE/Pro tier users, (c) anonymised contribution to a shared score baseline? Trade-off between user value and data sensitivity.
- [ ] How should outlier features be flagged? "Warning: this spec resembles F415, which had cascade + scope_creep with opus." UI shape, threshold tuning.
- [ ] What's the "explain my recommendation" UX? Memory shows the user values reasoning, not just answers. The recommendation should include: matched-similar-features, sample size, confidence band, stumble patterns observed for the rejected alternatives.

## Scope

### In Scope

- Survey of available signals: feature log metrics (F332), transcript bodies (transcript-program), session sidecars (F357), telemetry (`lib/telemetry.js`), commit metadata.
- Failure-mode taxonomy derivation from real transcripts in this repo (the aigon-the-repo corpus is the seed dataset).
- Spec-similarity heuristic candidates: file-overlap, keyword, complexity bucket, hybrid.
- Recommender architecture: storage (where do learned scores live? `.aigon/recommender/index.json`?), refresh trigger (after each `feature-close`?), query API (extend the existing `/api/recommendation/:type/:id` from F313).
- Cold-start blend with static scores.
- Reviewer-pairing learning as a separate signal from implementer choice.
- Cost-prediction model.
- UX surfaces (start-modal, dashboard panel, CLI flag for `feature-start --explain`).
- Commercial framing: which capabilities ship in OSS vs AADE/Pro tier (memory: "AADE as commercial product" — learned recommender is a strong Pro candidate).

### Out of Scope

- Cross-repo aggregation infrastructure (separate research if pursued — privacy + plumbing concerns are their own scope).
- Replacing the static scores in `templates/agents/*.json` (they remain the cold-start baseline).
- Recommending agents that aren't installed in the consumer repo (the recommender works within the user's installed agent set).
- Live transcript streaming / real-time mid-feature recommendation changes.
- Model-side fine-tuning or any kind of model training (this is an empirical recommender, not an ML pipeline).

## Findings

Two of three agents produced findings: cc and gg. cu's findings file is the unedited template (no research conducted) — discount.

### Consensus (cc + gg)

- **Storage**: per-repo `.aigon/recommender/index.json` for OSS; cross-repo aggregation reserved for Pro.
- **Similarity heuristic**: hybrid — Jaccard file-overlap on `lib/*` modules + complexity bucket. TF-IDF / keyword cosine deferred (low marginal value on this codebase).
- **Surfaces**: spec-create, spec-start (recommended default + "✨ Recommended" badge), dashboard explain panel, `feature-start --explain` CLI flag.
- **Reviewer pairing**: separate signal scored on meaningful `fix(review)` commits — implementer effectiveness ≠ reviewer effectiveness.
- **Cost prediction**: confidence band / percentile range, never a point estimate.
- **Explain UX**: structured payload with similar specs + sample size + confidence + stumbles for rejected alternatives.
- **Stumble taxonomy seeds** (sampled from real transcripts): orientation-thrashing, scope/spec-drift, abandoned-approach. cc adds stalled-review-loop, cold-start over-reading, premature-close. gg adds ignored-failing-test, judgment-loop-debate.
- **Outlier flag**: warn when candidate spec resembles a high-stumble historical feature; do not auto-disable the option.

### Divergent Views

| Topic | cc | gg |
|---|---|---|
| Min corpus N | n=3 medium / n=10 high with Bayesian shrinkage `k=5` | Hard switch at N=5 |
| Cold-start blend | Bayesian shrinkage (continuous prior pull) | Hard switch V1, sigmoid V2 |
| Similarity weighting | File-overlap primary, complexity as tiebreaker | Complexity as hard filter, file-overlap as soft ranker |
| Stumble classifier | Rule-based first, LLM discovery deferred until n≥30 | Doesn't specify implementation path |
| Outlier threshold | Jaccard ≥ 0.5 + ≥2 stumbles | >80% file overlap + critical stumble |
| Two-tier corpus | Explicit: aggregate-now (130 features) + transcript-when-ready | Treats transcript corpus as the only corpus |
| Calibration window | Land corpus + API silently first, ship UX after ~50 closed features | Ship UX immediately |
| API shape | Single endpoint w/ `?include=ranked,similar,stumbles,cost` | Less specific; "extend the endpoint + dashboard badges" |

cc's framing is materially deeper on architecture (two-tier corpus, Bayesian shrinkage, calibration window). gg's is sharper on the user-facing rule (hard N=5, "✨ Recommended" badge). The load-bearing call where they conflict is the **two-tier corpus**: waiting for the transcript corpus alone leaves the recommender useless for ~6 months given current capture pace (~1–2 features/day).

## Recommendation

Ship a per-repo learned recommender as a **thin extension** of the existing static recommender (`lib/spec-recommendation.js:rankAgentsForOperation`), not a parallel pipeline.

1. **Two-tier corpus** from day one. Aggregate (telemetry + log frontmatter, broad but shallow, ~130 features today) for cold-start coverage now. Transcript-derived (per-turn fidelity, narrow but deep) layered in as transcript coverage grows. Same external API; both feed the same ranking interface.
2. **Bayesian shrinkage** cold-start with `k=5` against the existing static `cli.modelOptions[].score[op]` priors. Confidence bands match the existing `low/medium/high` convention. (gg's hard N=5 switch is a special case of this with `k=∞`.)
3. **Hybrid spec-shape similarity**: file-overlap (Jaccard on `lib/*` modules) + complexity bucket. Keyword cosine deferred.
4. **Rule-based stumble classifier** first (six initial categories from real transcripts), LLM-based discovery deferred until n≥30 transcripts/category.
5. **Reviewer pairing** learned as a separate (reviewer, implementer)-pair signal scored on real-fix commits (>5-line diffs in flagged files).
6. **Cost prediction** as a 25th/75th-percentile band (or 90% CI per gg), not a point estimate.
7. **Storage** in `.aigon/recommender/` (per-repo, gitignored). Per-repo only in OSS; cross-repo aggregation as a Pro feature; anonymised contribution explicitly deferred.
8. **Single API endpoint extension** (`/api/recommendation/:type/:id?include=...`); three surfaces (start modal, dashboard explain panel, `feature-start --explain` CLI flag).
9. **Explain UX** returns a structured payload with similar features, sample size, confidence, stumbles for rejected alternatives, cost band — never a bare score.

Critical risk to flag: shipping the explain panel before the corpus is large enough makes the recommender feel unreliable. Land the corpus index + API silently first; turn on the user-visible UX after a calibration window of ~50 closed features (~3 weeks at current rate).

## Output

### Set Decision

- Proposed Set Slug: `learned-recommender`
- Chosen Set Slug: **deferred** — user is preserving the evaluation but not creating features yet; will reassess in a few weeks.

### Consolidated Features (deferred — not created)

| # | Feature Name | Description | Priority | Agents | Status |
|---|---|---|---|---|---|
| 1 | learned-recommender-corpus-index | Index closed features into `.aigon/recommender/index.json` (telemetry + log frontmatter + scope-files); incremental rebuild on `feature-close`, full rebuild via `aigon doctor`. Two-tier: aggregate now, transcript-derived layered in as coverage grows. | high | cc, gg | Consensus |
| 2 | learned-recommender-bucket-aggregates | Roll the corpus index into per-bucket aggregates (`buckets.json`); compute Bayesian-shrunk score against static `cli.modelOptions[].score[op]` priors with `k=5`. | high | cc | Unique to cc |
| 3 | learned-recommender-similarity-spec-shape | Hybrid file-overlap (Jaccard on `lib/*` modules) + complexity bucket; expose `findSimilar(spec)` returning ranked similar features with Jaccard scores. | high | cc, gg | Consensus |
| 4 | learned-recommender-stumble-classifier-rules | Rule-based detector for the taxonomy categories (orientation-thrashing, spec-drift, stalled-review-loop, abandoned-approach, cold-start over-reading, premature-close, ignored-failing-test, judgment-loop-debate); writes labels into the corpus index. LLM-based discovery deferred. | medium | cc | Unique to cc |
| 5 | learned-recommender-api-extension | Extend `/api/recommendation/:type/:id` with `?include=ranked,similar,stumbles,cost`; integrate ranked output into existing F313 frontmatter resolver path; add "✨ Recommended" badge in dashboard agent picker. | high | cc, gg | Merged |
| 6 | learned-recommender-explain-ux | Dashboard explain panel + `feature-start --explain` CLI flag; renders ranked alternatives, matched similar features, confidence band, cost band, stumbles for rejected agents. Gate behind ~50-feature calibration window. | medium | cc, gg | Consensus |
| 7 | learned-recommender-reviewer-pairing | Separate (reviewer-agent, implementer-agent)-pair score based on meaningful `fix(review)` commits (>5-line diff intersecting flagged files); expose in API and start-modal review-agent slot. | medium | cc, gg | Consensus |
| 8 | learned-recommender-cost-prediction | Per-bucket `costUsd` and `turnCount` percentile bands (25/50/75 — or 90% CI per gg); surface as expected-cost range in explain UX. | medium | cc, gg | Consensus |
| 9 | learned-recommender-outlier-flag | Detect candidate-spec similarity to high-stumble historical features above threshold; surface single-line ⚠ in start modal (do not auto-disable the option). | low | cc, gg | Consensus |
| 10 | learned-recommender-pro-cross-repo | Pro-tier: opt-in cross-repo aggregation of bucket scores, syncing per-bucket aggregates (not raw transcripts) into a user-owned aigon-pro vault. | low | cc, gg | Consensus |

### Feature Dependencies (for future prioritisation)

- `learned-recommender-corpus-index` — root, no deps
- `learned-recommender-bucket-aggregates` → corpus-index
- `learned-recommender-similarity-spec-shape` → corpus-index
- `learned-recommender-stumble-classifier-rules` → corpus-index
- `learned-recommender-api-extension` → bucket-aggregates, similarity-spec-shape
- `learned-recommender-reviewer-pairing` → bucket-aggregates
- `learned-recommender-cost-prediction` → bucket-aggregates
- `learned-recommender-outlier-flag` → similarity-spec-shape, stumble-classifier-rules
- `learned-recommender-explain-ux` → api-extension, stumble-classifier-rules
- `learned-recommender-pro-cross-repo` → bucket-aggregates

### Reassessment notes (for future-you)

- Re-check transcript corpus size when revisiting — recommendation depth scales with it.
- The two-tier vs transcript-only architectural call is load-bearing; reaffirm or revise based on corpus growth.
- gg's hard-N=5 switch is simpler and may be the right V1 if Bayesian shrinkage feels overengineered when you come back.
- cc's calibration-window risk (don't ship explain UX until ~50 closed features) only matters if explain panel is in V1.

## Related

- Builds on: F370-378 (agent-matrix static recommender), F313 (recommended-model-on-create), F398 (model capability scores), F291 (dashboard agent-model picker), F332 (implementation log format)
- Depends on: `transcript-program` set (transcript-read-model-and-cli, transcript-durable-hot-tier, transcript-tmux-pipe-pane-optin, transcript-dashboard-surface)
- Predecessor research: `research-43` (the transcript program itself)
- Commercial framing: candidate for AADE / Insights (Pro) tier per project memory
- Originating conversation: 2026-04-28 design session that produced the `aigon-install-contract` feature set; manual aggregate-metric recommendation for F381-415 demonstrated the floor of what's possible without transcripts
