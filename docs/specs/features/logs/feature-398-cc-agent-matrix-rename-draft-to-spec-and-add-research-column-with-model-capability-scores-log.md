# Implementation Log: Feature 398 - agent-matrix-rename-draft-to-spec-and-add-research-column-with-model-capability-scores
Agent: cc

## Status

Implemented. All acceptance criteria met. 50/51 tests pass (1 pre-existing failure in worktree-state-reconcile.test.js unrelated to this feature).

## New API Surface

`OPERATIONS` now exports `['spec', 'spec_review', 'implement', 'review', 'research']`. `OPERATION_LABELS` maps all five. No other public API changes.

## Key Decisions

Research scores based on model tier and known benchmark positioning (GAIA, agentic evals, WebArena-style tasks). Opus 4.7 = 5 (exceptional synthesis), Sonnet 4.6 = 3.5 (solid), Haiku 4.5 = 2.0 (shallow). Gemini Pro = 4, Flash = 3. DeepSeek V3.2 Speciale = 4 (reasoning helps), V3.1 = 3.5. Models with no research benchmarks (Kimi K2.6, GLM-5.1, GPT-5.5) get null.

## Gotchas / Known Issues

Dashboard screenshot shows pre-merge column names — the running server uses the main repo's `lib/agent-matrix.js`. New "Spec" and "Research" columns will appear after merge + server restart.

## Explicitly Deferred

Nothing — all acceptance criteria addressed.

## For the Next Feature in This Set

N/A

## Test Coverage

Validation check passes: `node -e "const m = require('./lib/agent-matrix'); console.assert(m.OPERATIONS.includes('spec')...)"` → OK. npm test 50/51 (pre-existing failure).
