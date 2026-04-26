---
commit_count: 5
lines_added: 111
lines_removed: 0
lines_changed: 111
files_touched: 4
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 99
output_tokens: 47596
cache_creation_input_tokens: 124873
cache_read_input_tokens: 3898423
thinking_tokens: 0
total_tokens: 4070991
billable_tokens: 47695
cost_usd: 2.352
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 371 - agent-matrix-2-brewboard-benchmark
Agent: cc

## Status
Submitted. All 105 unit tests pass.

## New API Surface
- `docs/specs/recurring/weekly-agent-matrix-benchmark.md` — weekly recurring template; `lib/recurring.js` parses it as `recurring_slug: weekly-agent-matrix-benchmark`
- `~/src/brewboard/docs/benchmarks/implement.md` — canonical implement fixture (style-filter bar; validated by `npx tsc --noEmit`)
- `~/src/brewboard/docs/benchmarks/spec-review.md` — canonical spec-review fixture (review a vague brewery-notes draft)
- `~/src/brewboard/docs/benchmarks/code-review.md` — canonical code-review fixture (review a `RatingInput` PR diff)
- `~/src/brewboard/docs/benchmarks/draft.md` — canonical draft fixture (turn a user request into a spec)

## Key Decisions
1. **Fixtures live in the Brewboard repo, not aigon**: The benchmark tasks are versioned alongside the code they target. Aigon holds the recurring template (the driver); Brewboard holds the work definition (the fixture).
2. **No new benchmark runner**: Each weekly run is a regular aigon feature. `feature-close` already writes `stats.json`; `lib/stats-aggregate.js` rolls up `perTriplet`; `lib/agent-matrix.js` reads it automatically. Zero new code paths.
3. **One (agent × model) cell per run**: The executing agent runs as itself. Fleet mode enables parallel multi-cell coverage. This keeps the template simple and the scope bounded.
4. **Implement fixture uses TypeScript validation**: `npx tsc --noEmit` is the validation gate — gives a deterministic pass/fail signal without requiring a test framework in a no-tests repo.

## Gotchas / Known Issues
- The brewboard fixtures were committed to `~/src/brewboard` (a separate git repo). A `seed-reset` will wipe them — they need to be pushed to the remote seed so they survive a reset. Flagged for operator action.

## Explicitly Deferred
- Scoring (`score.implement` in agent JSON) — F374's `aigon matrix-apply` command writes scores from benchmark artefacts
- spec-review / code-review / draft fixture runs — the weekly template currently uses only `implement`; extension is straightforward
- Fleet scheduling for all cells in one week — requires manual multi-agent start today; F376 may automate this

## For the Next Feature in This Set
- F372 (recommender-core): `lib/spec-recommendation.js` can start reading `score` and `stats` from `lib/agent-matrix.js` rows immediately — the data shape is stable from F370 onwards
- F374 (pricing-refresh): reuses the same `docs/specs/recurring/` pattern; the `weekly-agent-matrix-benchmark.md` template is a template for how those should be structured

## Test Coverage
All 105 unit tests pass. The new recurring template is verified by `lib/recurring.js`'s `scanTemplates()` (no new test needed — the parser already has coverage; integration confirmed by direct node invocation).

## Code Review

**Reviewed by**: cu  
**Date**: 2026-04-26

### Fixes Applied
- `74a3afe5` — `fix(review): apply week placeholder to recurring instance body` — `createAndPrioritiseFromTemplate` now runs `renderPattern` on the instance body so `{{YYYY-WW}}` in report paths and commit messages is replaced when a weekly template is instantiated. Without this, `weekly-agent-matrix-benchmark` would have produced specs with literal placeholders. Added `tests/integration/recurring-instance-body-week-placeholder.test.js`.

### Residual Issues
- Brewboard fixture files live in `~/src/brewboard`; they must be pushed on the seed remote or `seed-reset` drops them (called out in implementation log already).
- The checked-in feature spec `feature-371-agent-matrix-2-brewboard-benchmark.md` still has empty **User Stories** / **Acceptance Criteria** in the body; the shipped work is described in the recurring template and this log. Filling the spec for audit consistency is a small follow-up if desired.

### Notes
- Scope diff was docs-only for the feature branch until the review; the `lib/recurring.js` change is a targeted producer fix required for the new template to be viable when `recurring-run` instantiates it.
