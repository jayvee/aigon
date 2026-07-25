---
complexity: medium
research: 26
set: reduce-tokens
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-08T02:26:25.215Z", actor: "cli/feature-prioritise" }
---

# Feature: reduce-tokens-1-cost-dashboard

## Summary

Aigon already captures full per-turn token breakdowns (input, output, cache-read, cache-write, billable) via the `aigon capture-session-telemetry` SessionEnd hook — 27+ telemetry JSON files (152KB) sit on disk in `.aigon/telemetry/` describing recent feature/research runs. None of this is surfaced in the dashboard, `aigon stats`, or any user-facing summary. This feature parses that existing data and renders per-session, per-feature, and per-agent token cost in the Pro dashboard, plus outlier detection (high-context sessions, noisy commands, weak cache reuse, Fleet multipliers). Foundational for everything else in the `reduce-tokens` set: you can't optimise what you can't measure.

## User Stories
- [ ] As a maintainer, I can open the dashboard and see total tokens, cost, and cache-hit ratio for the last N sessions, broken down by agent, feature, and workflow phase.
- [ ] As a maintainer, I can identify outlier sessions (e.g. >2× median context-load, low cache reuse) so I know where to target trims.
- [ ] As a maintainer, when I ship a change to instructions or templates, I can A/B compare token cost before vs after to detect regressions.

## Acceptance Criteria
- [ ] Dashboard shows a Token Cost panel populated from `.aigon/telemetry/*.json`, with per-session rows including: agent id, feature/research id, input tokens, output tokens, cache-read, cache-write, total, billable, $ cost.
- [ ] Aggregations exist for per-agent and per-feature roll-ups (median, p90, total).
- [ ] Outlier detection flags sessions whose `total` or `contextLoadTokens` exceed the rolling p90, with a hint linking to the noisy command if attributable.
- [ ] Cache-hit ratio (`cacheReadInput / (input + cacheReadInput + cacheCreationInput)`) is rendered per session and per agent.
- [ ] Implementation does not change the telemetry write path — read-only consumer of the existing format.

## Technical Approach

Read-only parser over `.aigon/telemetry/*.json`. Add a dashboard route + card stack rendering aggregations on the client. Pricing for $ cost can be a static lookup table keyed by model id (Opus / Sonnet / Haiku per the public Anthropic price list); store it in a config file so price updates don't require code changes. Reuse existing dashboard data-fetch patterns — do not introduce a new persistence layer.

Outlier detection runs on aggregate (no streaming required); a rolling window over the last 50 sessions per agent is sufficient. Surface the cache-hit metric prominently — it's the primary signal that subsequent features (slim-instructions, lazy-workflow) are succeeding or regressing.

## Dependencies
-

## Out of Scope
- Live/streaming telemetry. Batch read at dashboard load is sufficient.
- Modifying the telemetry write format or adding new event types.
- Cost forecasting / budget alerts. Visibility first; alerting is a follow-up.

## Open Questions
- Should pricing config live in `.aigon/config.json` (per-project override) or be bundled with Aigon? Recommend bundled with override.

## Related
- Research: #26 reduce-token-usage
- Set: reduce-tokens
