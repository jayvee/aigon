# Implementation Log: Feature 378 - agent-matrix-qualitative-refresh-2026-q2
Agent: cc

## Status

Complete. Patch file written to `.aigon/matrix-refresh/2026-04-26/proposed.json`. Three feedback items created (6, 7, 8) covering benchmark-update, score-update, and notes-update change-kinds.

## New API Surface

None.

## Key Decisions

- Aider polyglot chosen as primary implement benchmark proxy where SWE-bench data was absent; percentile mapping: top 10% (≥78%) → 4.5–5.0, top 25% (≥65%) → 4.0–4.5, median (~45%) → 3.0, bottom 10% (≤12%) → 1.0–2.0.
- Arena.ai ELO used as proxy for draft/spec_review/review ops (no direct benchmarks exist).
- GPT-5.5 left at null implement score — no benchmark data found; avoids fabricating a score.
- Codestral 25.01 notes updated: Aider polyglot 11.1% (bottom 10%) contradicts "competitive implementation quality" claim in prior notes.

## Gotchas / Known Issues

- gemini-3-flash-preview is in the matrix but not on Aider leaderboard; Arena ELO used as the only signal.
- gpt-5.5 has no public benchmark results yet; score left null.

## Explicitly Deferred

- Applying changes via `aigon matrix-apply` — operator decision.
- GLM-5.1 scores left null — no benchmark data found.

## For the Next Feature in This Set

Run `aigon matrix-apply 6`, `aigon matrix-apply 7`, `aigon matrix-apply 8` once feedback items are reviewed and approved.

## Test Coverage

Data-collection task; no code changes requiring tests.
