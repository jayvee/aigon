---
commit_count: 3
lines_added: 216
lines_removed: 0
lines_changed: 216
files_touched: 3
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 113
output_tokens: 45014
cache_creation_input_tokens: 133221
cache_read_input_tokens: 4205869
thinking_tokens: 0
total_tokens: 4384217
billable_tokens: 45127
cost_usd: 2.4369
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 372 - agent-matrix-3-recommender-core
Agent: cc

## Status
Submitted. All tests pass (0 failures). Test budget 56% (well under ceiling).

## New API Surface
- `lib/spec-recommendation.js` exports `rankAgentsForOperation(op, complexity, opts)`
  - Returns `{ agentId, model, effort, score, rationale, confidence }[]` sorted by score descending
  - `opts.excludeQuarantined` (default `true`) filters quarantined modelOptions
  - `opts.excludeOverBudget` (default `false`) is a documented no-op placeholder
  - `opts.repoPath` allows callers to override the stats root (defaults to cwd)

## Key Decisions
1. **One entry per agent** (the model/effort from `complexityDefaults[complexity]`): callers ask "which agent should I use for this complexity?" — not "rank all 26 (agent×model) matrix cells." This keeps the result actionable.
2. **Penalty scale bounded to [0, 1]**: the normalised cost penalty deducts at most 1 point from the 1–5 qualitative scale, so qualitative judgment still dominates when benchmark data is thin.
3. **Sparse cells are honest, never invented**: when `sessions == 0`, `score` passes through the raw qualitative value (currently all `null`), `confidence: 'low'`, and the canonical rationale. No fabricated numbers.
4. **Quarantine check uses the registry helper** `isModelOptionQuarantined(opt)` rather than direct field access — consistent with how pickers filter quarantined entries.

## Gotchas / Known Issues
- All qualitative scores are currently `null` (agents ship with `score.<op>: null`). The function returns correct null scores and ranks by cost order once benchmark data arrives via F374's `aigon matrix-apply`.
- The `op` agent lacks `complexityDefaults`, so it never appears in complexity-filtered results regardless of the quarantine flag.

## Explicitly Deferred
- `excludeOverBudget` filter — no-op until `feature-agent-cost-awareness` ships
- Dashboard surface for recommendations (may be a future feature)
- Research operation type in scoring (currently only draft/spec_review/implement/review)

## For the Next Feature in This Set
- F374 (`aigon matrix-apply`): writes benchmark `score.<op>` into agent JSON; once applied, `rankAgentsForOperation` will return non-null scores and use the full qual − cost formula
- The function is ready to consume real scores immediately — no API changes needed

## Test Coverage
- `tests/integration/rank-agents-for-operation.test.js` — shape contract, sparse-cell rationale, all 16 op×complexity combos, sort order, quarantine flag, excludeOverBudget no-op, export
- All 105+ unit tests pass, budget at 56%
