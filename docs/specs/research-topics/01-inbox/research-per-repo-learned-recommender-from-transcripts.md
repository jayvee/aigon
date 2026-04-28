---
complexity: high
---

# Research: per-repo-learned-recommender-from-transcripts

## ⚠️ Gating Note — Revise Before Starting

**Do not start this research until the `transcript-program` set is fully done.**

Members of `transcript-program` (must all be in `05-done` first):
- `transcript-read-model-and-cli` — programmatic discovery of transcript paths
- `transcript-durable-hot-tier` — persistence past worktree deletion
- `transcript-tmux-pipe-pane-optin` — coverage for cu / op / km

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
<!-- Filled in during research execution after transcript-program ships. -->

## Recommendation
<!-- Filled in during research-eval. Expected output: 3–6 features in a "learned-recommender" set, ordered roots → leaves. -->

## Output
- [ ] Feature: <!-- e.g. learned-recommender-corpus-index -->
- [ ] Feature: <!-- e.g. learned-recommender-similarity-heuristic -->
- [ ] Feature: <!-- e.g. learned-recommender-api-and-dashboard -->
- [ ] Feature: <!-- e.g. learned-recommender-reviewer-pairing -->
- [ ] Feature: <!-- e.g. learned-recommender-cost-prediction -->
- [ ] Feature: <!-- e.g. learned-recommender-explain-ux -->

## Related

- Builds on: F370-378 (agent-matrix static recommender), F313 (recommended-model-on-create), F398 (model capability scores), F291 (dashboard agent-model picker), F332 (implementation log format)
- Depends on: `transcript-program` set (transcript-read-model-and-cli, transcript-durable-hot-tier, transcript-tmux-pipe-pane-optin)
- Predecessor research: `research-43` (the transcript program itself)
- Commercial framing: candidate for AADE / Amplification Pro tier per project memory
- Originating conversation: 2026-04-28 design session that produced the `aigon-install-contract` feature set; manual aggregate-metric recommendation for F381-415 demonstrated the floor of what's possible without transcripts
