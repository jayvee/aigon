# Implementation Log: Feature 147 - metrics-session-telemetry
Agent: cx

## Plan
- Add a normalized per-session telemetry schema and file writer under `.aigon/telemetry/`.
- Keep existing log frontmatter telemetry behavior intact for backward compatibility.
- Emit normalized records from transcript capture and provide fallback emission for non-transcript agents.
- Update analytics ingestion to consume normalized telemetry for cost/tokens and cross-agent cost rollups.
- Add tests for normalized writer/parser and analytics fallback behavior.

## Progress
- Extended `lib/telemetry.js` with normalized telemetry helpers:
  - `resolveTelemetryDir()`
  - `writeNormalizedTelemetryRecord()`
  - `parseTranscriptSession()` (timestamps, turn count, tool calls, tokens, cost)
  - `writeAgentFallbackSession()`
- Kept `parseTranscriptFile()` compatible by delegating to `parseTranscriptSession()` and returning the original shape.
- Updated `captureSessionTelemetry()` to write normalized per-session records in addition to updating log frontmatter.
- Updated `feature-close` in `lib/commands/feature.js` to emit a normalized fallback session for non-CC agents when transcript telemetry is unavailable.
- Updated `collectAnalyticsData()` in `lib/utils.js` to:
  - read `.aigon/telemetry/*.json`,
  - fall back to normalized telemetry for `costUsd` and `billableTokens` when frontmatter is missing,
  - add `amplification.crossAgentCost30d` for cross-agent session cost reporting.
- Added tests:
  - `lib/telemetry.test.js`: normalized record writing, transcript session parsing, non-transcript fallback writer
  - `aigon-cli.test.js`: analytics fallback to normalized telemetry + cross-agent rollup assertion
- Validation:
  - `node -c aigon-cli.js`
  - `node -c lib/utils.js`
  - `node -c lib/telemetry.js`
  - `node -c lib/commands/feature.js`
  - `node lib/telemetry.test.js` (`20 passed, 0 failed`)
  - `node aigon-cli.test.js` has pre-existing unrelated failures in this branch; feature-specific telemetry behavior was additionally smoke-tested via direct `collectAnalyticsData()` invocation.

## Decisions
- Chose additive compatibility: normalized session telemetry is stored in `.aigon/telemetry` without removing legacy frontmatter fields, so existing dashboard paths continue to work.
- Added non-CC fallback emission at `feature-close` to satisfy multi-agent normalized telemetry coverage even where session transcript APIs are unavailable.
- Used normalized telemetry as a fallback data source in analytics to avoid retrofitting all existing logs immediately.
