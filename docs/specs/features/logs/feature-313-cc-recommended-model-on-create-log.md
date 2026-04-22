---
commit_count: 9
lines_added: 440
lines_removed: 8
lines_changed: 448
files_touched: 24
fix_commit_count: 2
fix_commit_ratio: 0.222
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 327
output_tokens: 140721
cache_creation_input_tokens: 1057367
cache_read_input_tokens: 41404720
thinking_tokens: 0
total_tokens: 42603135
billable_tokens: 141048
cost_usd: 92.4917
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 313 - recommended-model-on-create
Agent: cc

## Plan

## Progress
- Extended `parseFrontMatter` with inline `{}` map support rather than adding a YAML dependency; added `lib/spec-recommendation.js` as the single resolver feeding both dashboard API and the backlog badge collector.

## Decisions

## Code Review

**Reviewed by**: cursor-assistant
**Date**: 2026-04-23

### Fixes Applied
- `git rebase main` — the branch was forked before feature 311 landed on `main`; a straight merge of the old tip would have dropped session sidecar support and related tests. The rebased history stacks F313 on current `main` (publish with `git push --force-with-lease` on this worktree branch).
- `fix(review):` kanban / pipeline `feature-start` and `research-start` now call `fetchSpecRecommendation` like the card action path, so the recommendation banner and triplet pre-select apply when starting via drag-and-drop.

### Residual Issues
- `aigon feature-spec <id>` does not print complexity at the top (listed as an open question in the spec, not in acceptance criteria).
- Recommendation banner uses `innerHTML` with spec-derived strings; specs are normally trusted. Escaping is not implemented.

### Notes
- Core F313 work matches the spec: `lib/spec-recommendation.js`, `GET /api/recommendation/:type/:id`, dashboard banner + triplet pre-select, complexity on backlog row via status collector, agent JSON `cli.complexityDefaults`, templates, and `tests/integration/spec-recommendation.test.js`.
- `op` and other agents without `complexityDefaults` are covered by the test loop (only cc/cx/gg/cu are required to declare the map per spec).
