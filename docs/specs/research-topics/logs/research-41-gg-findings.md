# Research Findings: agent model capability matrix

**Agent:** Gemini (gg)
**Research ID:** 41
**Date:** 2026-04-25

---

## Key Findings

- **Existing Recommender**: `lib/spec-recommendation.js` uses a simple mapping from `complexity` to `complexityDefaults` in agent JSON files. This should be the target for the Phase B intelligent recommender.
- **Metric Availability**: Telemetry already tracks `input_tokens`, `output_tokens`, `thinking_tokens`, `cost_usd`, and session duration. These provide a robust baseline for value-for-money metrics without new instrumentation.
- **Benchmarking Target**: The `brewboard` seed repo is perfectly suited for internal benchmarks due to its small scope and existing support for `seed-reset`.
- **Cost Proxy Strategy**: Public API pricing ($/1M tokens) is a better cross-provider signal than user-specific subscription quotas, as it normalizes value across subscription and PAYG models.

## Sources

- `lib/spec-recommendation.js`: Current model/effort resolution logic.
- `lib/telemetry.js` & `lib/analytics.js`: Telemetry and cost tracking implementation.
- `templates/agents/*.json`: Agent-specific `modelOptions` and `complexityDefaults`.
- `docs/specs/features/01-inbox/feature-agent-cost-awareness.md`: Related billing research.

## Recommendation

- **Data Model**: Split the matrix into two parts: a static template (`templates/agent-matrix.json`) for capabilities and public pricing, and a dynamic state file (`.aigon/state/agent-matrix.json`) for benchmarked performance.
- **Benchmarking**: Implement an `aigon benchmark` command that performs `seed-reset` on brewboard, runs 1-2 canonical features (e.g., #01-dark-mode), and records the telemetry results into the dynamic state file.
- **Integration**: The dashboard Settings tab should render a row-per-model/column-per-operation matrix. The recommender should prioritize "High Confidence" cells (those with recent benchmark data).

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| matrix-data-model | Define JSON schema and split storage for static/dynamic matrix data | high | none |
| matrix-settings-view | Implement the read-only matrix table in the dashboard Settings tab | high | matrix-data-model |
| benchmark-runner-core | Command to run canonical features on brewboard and update performance stats | medium | matrix-data-model |
| matrix-recommender-integration | Update spec-recommendation.js to rank models using matrix scores and cost | medium | matrix-data-model |
| matrix-autonomous-refresh | Scheduled research job to update pricing and model strengths via web search | low | matrix-data-model |
