# Feature: per-agent-cost-breakdown-in-stats

## Summary
The Stats tab currently shows a single aggregated cost/token count across all agents. This is misleading in fleet mode because: (1) tokens from different providers (Claude, Gemini, Cursor) are priced differently and should not be summed into one number, (2) each model within a provider has different pricing (Sonnet vs Opus vs Haiku), and (3) non-CC agents show 0 tokens today, hiding which agents did meaningful work. Replace the single cost block with a per-agent breakdown table.

## Acceptance Criteria
- [ ] Stats tab shows a cost table with one row per agent that participated in the feature
- [ ] Each row shows: Agent, Model, Input Tokens, Output Tokens, Estimated Cost (USD)
- [ ] Rows with no token data (Cursor, Gemini until they have telemetry) show "n/a" for tokens/cost — not 0
- [ ] A "Total" summary row sums only agents that have real cost data
- [ ] Data sourced from `.aigon/telemetry/feature-{id}-{agent}-*.json` records (aggregated per agent)
- [ ] Solo (Drive) mode shows a single row for the primary agent
- [ ] Model-specific pricing is applied correctly per record (using costUsd already computed at write time)

## Technical Approach
- `collectCostFeatureStatus` in `feature-status.js`: instead of returning a single aggregated block, return `costByAgent: { cc: { inputTokens, outputTokens, costUsd, model, sessions }, gg: {...} }`
- `detail-tabs.js`: render a table from `costByAgent` instead of individual scalar fields
- Pricing: telemetry records already include `costUsd` computed at write time — no need to re-compute
- For agents with no real telemetry: distinguish "no telemetry" (n/a) vs real 0 by checking `source === 'feature-close-fallback'`

## Dependencies
- depends_on: telemetry-reads-stophook-records-not-transcripts

## Out of Scope
- Adding token telemetry to Cursor or Gemini (separate concern)
- Historical backfill for features already closed before this feature ships

## Related
-
