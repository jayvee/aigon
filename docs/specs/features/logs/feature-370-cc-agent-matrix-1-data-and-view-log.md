---
commit_count: 3
lines_added: 724
lines_removed: 39
lines_changed: 763
files_touched: 13
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 19003
output_tokens: 102685
cache_creation_input_tokens: 351129
cache_read_input_tokens: 24043918
thinking_tokens: 0
total_tokens: 24516735
billable_tokens: 121688
cost_usd: 10.1272
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 370 - agent-matrix-1-data-and-view
Agent: cc

## Status
Submitted. All unit tests pass (0 failures). Playwright e2e has a pre-existing pro-bridge crash when AIGON_FORCE_PRO=true with a clean HOME in worktree mode — not caused by this feature.

## New API Surface
- `GET /api/agent-matrix?repoPath=<path>` → `{ rows: MatrixRow[], operations: string[], operationLabels: Record<string, string> }`
- `lib/agent-matrix.js` exports `buildMatrix(repoPath)`, `buildMatrixByAgent(repoPath)`, `OPERATIONS`, `OPERATION_LABELS`
- `lib/telemetry.js` PRICING is now built dynamically from registry (agent JSONs are source of truth)
- Activity tag `spec_review` set when worktree taskType is `spec-review`/`spec-check`
- Activity tag `draft` set when `feature-draft` spawns an agent (AIGON_ACTIVITY=draft)

## Key Decisions
1. **Registry as PRICING source of truth**: `_buildPricingFromRegistry()` scans all agents' `modelOptions[].pricing` at module load, falling back to `_PRICING_LEGACY_FALLBACK` for pre-registry models. `[1m]`-suffix entries also index their bare model ID.
2. **Strip matrix fields from getDashboardAgents()**: notes/score/pricing/lastRefreshAt are large and belong in `/api/agent-matrix`, not the bootstrap payload. This also fixed a test regression (regex `.+?;` broke on semicolons in notes).
3. **Scores are all null initially**: research says "never invent numbers." Benchmark data populates in F371.
4. **Notes are initial handcrafted seeds**: brief, factual, based on public knowledge. F375 refreshes these from web research.

## Gotchas / Known Issues
- Playwright e2e suite fails with `TypeError: Cannot read properties of null (reading 'register')` at `pro-bridge.js:70` when run from worktree with a clean HOME. Pre-existing before this feature's commits.
- The `claude-sonnet-4-6[1m]` and `claude-opus-4-7[1m]` model IDs strip `[1m]` to bare model IDs when building the PRICING map, so cost accounting works for both ID variants.

## Explicitly Deferred
- Benchmark scores (F371 — Brewboard benchmark runner)
- Per-operation activity stats from telemetry rollup (F371 adds the pipeline)
- The "research" activity tag for research sessions (separate from draft/spec_review/implement/review)

## For the Next Feature in This Set
- F371 (brewboard-benchmark): consume `lib/agent-matrix.js`; write benchmark results as `score.<op>` into agent JSON via `aigon matrix-apply`
- F372 (recommender-core): extend `lib/spec-recommendation.js` with `rankAgentsForOperation()` using the matrix rows
- Both can start immediately — F370 is done.

## Test Coverage
- All 105 unit tests pass (0 failures)
- Route dispatch verified directly via `dispatcher.dispatchOssRoute()`
- Matrix builder verified: 26 rows, correct pricing, quarantined row present
- PRICING table: registry entries override legacy fallback; fallback still covers legacy model IDs
- Settings tab matrix UI verified via Playwright screenshot: groups, pricing, "—" scores, refreshed date
