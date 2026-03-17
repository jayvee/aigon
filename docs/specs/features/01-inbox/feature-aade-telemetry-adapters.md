# Feature: AADE Telemetry Adapters

## Summary

Agent adapter model for telemetry capture. Each agent (cc, gg, cu, etc.) gets an adapter that extracts tokens, cost, turns, and autonomy labels into a common schema stored in feature log frontmatter. The Claude Code adapter parses transcript JSONL via a SessionEnd hook. Includes a pricing table for cost calculation, token normalisation (tokens-per-line-changed), and an adapter interface so future agents plug in cleanly.

## User Stories

- [ ] As a developer, I want token and cost data captured automatically when I close a feature so I can see how much AI compute each feature consumed
- [ ] As a developer, I want each agent's telemetry extracted through its own adapter so I don't lose data just because one agent exposes different metrics than another
- [ ] As a developer, I want tokens normalised per line changed so I can compare efficiency across features of different sizes

## Acceptance Criteria

- [ ] Claude Code adapter exists that parses transcript JSONL from SessionEnd hook and extracts: input tokens, output tokens, thinking tokens, total tokens, model used, session count
- [ ] Pricing table maps model IDs to $/1K-token rates; cost is computed from token counts
- [ ] Token normalisation: `tokens_per_line_changed` computed as total_tokens / lines_changed
- [ ] Adapter interface defined (function signature or module contract) so new agents can be added by implementing the interface
- [ ] All telemetry fields stored as flat scalar fields in feature log frontmatter via `parseLogFrontmatterFull()`
- [ ] `aigon feature-close` (or `feature-submit`) triggers telemetry capture for the active agent
- [ ] Adapter gracefully handles missing data (e.g. Cursor has no per-session tokens — adapter returns nulls for unavailable fields)

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

- Define adapter interface: `{ extractTelemetry(featureId, agentId) => TelemetryData }` where TelemetryData has fields: `input_tokens`, `output_tokens`, `thinking_tokens`, `total_tokens`, `model`, `sessions`, `cost_usd`, `tokens_per_line_changed`, `autonomy_label`
- Claude Code adapter: read `~/.claude/projects/*/SESSION_ID.jsonl` files, sum token fields from assistant message metadata
- Pricing table: JSON object in `aigon-cli.js` or a config file mapping model IDs (e.g. `claude-sonnet-4-20250514`) to per-token rates
- Autonomy labels derived from interaction pattern: Full Autonomy (0 user turns), Light Touch (1-2), Guided (3-5), Collaborative (6+), Thrashing (high turns + rework signals)
- Store ~15 new frontmatter fields per feature log (~200 bytes)
- Agent config (`templates/agents/<id>.json`) could reference which adapter module to use

## Dependencies

- Existing feature log frontmatter system (`parseLogFrontmatterFull()`)
- Claude Code SessionEnd hook capability (or post-session transcript access)
- Git metrics from aade-git-signals (for `tokens_per_line_changed` and autonomy label refinement)

## Out of Scope

- Per-turn granularity storage — only aggregated totals
- Cursor adapter implementation (interface only; Cursor lacks per-session token data)
- Real-time token streaming / live cost display
- Team-level aggregation

## Open Questions

- Where exactly does Claude Code store transcript JSONL per session? Confirm path pattern
- Does the SessionEnd hook fire reliably in all exit scenarios (normal, Ctrl+C, crash)?
- Should pricing table be hardcoded or fetched from a config file that users can update?
- How to handle multi-session features (multiple `feature-do` invocations before close)?

## Related

- Research: research-13-ai-development-effectiveness (Synthesis)
- Feature: aade-git-signals (provides lines_changed for normalisation)
- Feature: aade-amplification-dashboard (consumes telemetry data)
- Feature: aade-insights (analyses telemetry trends)
