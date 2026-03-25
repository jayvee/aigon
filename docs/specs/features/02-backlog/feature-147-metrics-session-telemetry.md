# Feature: metrics-session-telemetry

## Summary

Normalize per-session telemetry across all agent types (Claude Code, Gemini, Codex, Cursor) into a common schema. Currently telemetry exists for Claude transcripts (`lib/telemetry.js`) but is not normalized across agents. This feature creates a unified record per agent run enabling cross-agent comparison, accurate cost-per-feature, and prompt efficiency metrics.

## User Stories
- [ ] As a developer, I want to compare token usage and cost across different agents for the same type of task
- [ ] As a developer, I want to see how many iterations/turns each agent needed to complete a feature

## Acceptance Criteria
- [ ] Common telemetry schema: `agent`, `model`, `startAt`, `endAt`, `turnCount`, `toolCalls`, `tokenUsage` (input/output separately), `costUsd`, `featureId`, `repoPath`
- [ ] Telemetry records written to `.aigon/telemetry/` per session in the normalized format
- [ ] Existing Claude transcript telemetry migrated to the common schema
- [ ] At least one additional agent (GG or CX) emitting normalized telemetry
- [ ] `collectAnalyticsData()` updated to consume normalized telemetry for cross-agent cost reporting

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

Extend `lib/telemetry.js` with a common record format. Each agent's session-end hook writes a normalized JSON record. For agents where Aigon doesn't control the session (Cursor), parse available data from logs/transcripts post-hoc.

## Dependencies
- None (independent, but enriches metrics-insights-scorecard)

## Out of Scope
- Real-time streaming telemetry
- IDE-level instrumentation (keystroke tracking)
- Token-level cost optimization recommendations

## Open Questions
- Can we reliably extract turn count and token usage from Gemini and Codex sessions?
- Should telemetry records be per-session or per-feature (aggregated)?

## Related
- Research: research-19-ai-native-workflow-metrics
- Depends-on: none
- Enriches: metrics-insights-scorecard (cross-agent cost data)
