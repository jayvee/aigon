# Research Findings: per repo learned recommender from transcripts

**Agent:** Gemini (gg)
**Research ID:** 45
**Date:** 2026-04-29

---

## Key Findings

### 1. Minimum Viable Corpus Size (N)
In recommender systems, collaborative filtering generally requires a minimum of 3 to 5 interactions per entity to overcome the sparsity problem and provide reliable signals. For Aigon, this translates to an $N$ of **5 features per agent+model+complexity bucket**. Below 5 features, learned signals are too noisy and susceptible to single-feature outliers.

### 2. Spec-Shape Similarity Heuristic
A **Hybrid Heuristic** is recommended:
- **Primary Filter (Hard constraint):** Complexity bucket. Only compare specs within the same or adjacent complexity bands.
- **Secondary Ranker (Soft score):** File overlap (Jaccard similarity of `lib/*` modules touched). If two specs touch the exact same files, their structural and contextual challenges are highly correlated. This is vastly superior to TF-IDF on spec keywords, which struggles with synonyms and coding boilerplate.

### 3. Failure-Mode Taxonomy
Based on evaluating LLM coding transcripts, the following taxonomy emerges for classification:
- **Orientation Thrashing:** Agent repeatedly reads the same files (3+ times) or lists directories without making structural edits. Indicates context-window loss or lack of comprehension.
- **Scope Creep (Hallucination):** Agent expands the scope beyond the spec, hallucinating new requirements or refactoring unrelated code.
- **Abandoned Approach:** Agent writes a significant block of code, deletes it, and pivots to a different approach midway through the feature.
- **Ignored Failing Test:** Agent attempts to push or complete the feature despite local/CI tests returning non-zero exit codes.
- **Judgment-Loop Debate:** Agent gets stuck debating with the user or itself (via chain-of-thought) for multiple turns before writing code.

### 4. Cold-Start Problem
We should use a **Hard Switch Blending Heuristic** for V1 to keep the architecture simple and debuggable. 
- If a bucket has $< 5$ samples, rely 100% on the static scores from `templates/agents/*.json`.
- If a bucket has $\ge 5$ samples, switch to the learned per-repo scores.
*Alternative (V2):* A dynamic weighted hybrid (sigmoid transition) where learned scores gradually take over as $k$ approaches 10.

### 5. Recommendation Surface
The recommendation should be pervasive but non-blocking:
- **Spec-create (`F313`):** CLI outputs the recommended agent/model combination upon creation.
- **Spec-start:** CLI defaults to the recommended pair if `--agent` is omitted.
- **Dashboard (`F291`):** A visual "✨ Recommended" badge next to the top-scoring agent in the picker dropdown.

### 6. Reviewer Pairing vs Implementer Choice
Reviewer effectiveness is fundamentally different from implementation speed. A good reviewer is one who forces corrections.
- **Signal:** Track reviews that result in subsequent commits with `fix(review)` or a meaningful diff.
- **Metric:** `Meaningful Fixes / Total Reviews Conducted`. This prevents agents that just blindly approve code from getting high reviewer scores.

### 7. Cost-Prediction Model
Given the high variance in LLM coding tasks, point estimates are misleading.
- Map the spec complexity bucket + file overlap size to historical turn counts and token usage.
- Output a **90% Confidence Interval** for cost (e.g., "$0.15 - $0.40") rather than a single number.

### 8. Privacy & Portability
- **OSS / Free Tier:** Learned scores must remain strictly **per-repo**, stored locally in `.aigon/recommender/index.json`.
- **AADE / Pro Tier:** Offer an **opt-in cross-repo aggregation**. This shares anonymized success/failure vectors (excluding source code) to build a global baseline, providing immediate warm-start capabilities for new repos.

### 9. Outlier Feature Flagging
If a new spec has a $>80\%$ file overlap with a past feature that experienced critical failure modes (e.g., *Orientation Thrashing*), surface a UI warning at start-time:
> *"Warning: This spec resembles F415, which experienced orientation thrashing with claude-3-opus. Consider breaking it down or using an agent with a larger context window."*

### 10. "Explain My Recommendation" UX
Provide a CLI flag: `aigon feature-start --explain`
The output must show the "why" to build trust:
- **Basis:** "Based on 8 similar past features in this repo."
- **Confidence:** "High (N > 5)"
- **Rejected Alternatives:** "claude-3-sonnet struggled with *scope creep* on similar specs."
- **Similar Specs:** List top 3 matched spec IDs.

---

## Sources
- **Recommender Systems Collaborative Filtering:** "3-5 Rule" for minimum interactions to overcome matrix sparsity.
- **Cold Start Strategies:** Hard Switch vs Weighted Hybrid blending heuristics.
- **Aigon Internal Context:** `templates/agents/*.json` (static scores), F332 (feature logs), F291 (dashboard).

---

## Recommendation
Build a per-repo learned recommender using a **Hard Switch** cold-start strategy ($N=5$). Base the similarity heuristic on **Complexity Bucket + File Overlap (Jaccard)**. Store the learned index locally in `.aigon/recommender/index.json` for OSS, and reserve cross-repo aggregation for the Pro tier. Track reviewer scores separately using a "Meaningful Fixes" metric.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| learned-recommender-corpus-index | Local storage and indexing of transcript failure modes in `.aigon/recommender/` | high | transcript-dashboard-surface |
| learned-recommender-similarity-heuristic | Jaccard file-overlap and complexity bucket matching logic | high | learned-recommender-corpus-index |
| learned-recommender-api-and-dashboard | Extend `/api/recommendation/:type/:id` and add "✨ Recommended" dashboard badges | high | learned-recommender-similarity-heuristic |
| learned-recommender-reviewer-pairing | Track reviewer effectiveness based on meaningful `fix(review)` commits | medium | learned-recommender-corpus-index |
| learned-recommender-cost-prediction | Provide 90% confidence intervals for feature cost based on historical transcript data | medium | learned-recommender-corpus-index |
| learned-recommender-explain-ux | Add `--explain` CLI flag to show reasoning, matched specs, and avoided stumble patterns | low | learned-recommender-api-and-dashboard |
