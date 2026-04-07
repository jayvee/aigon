# Feature: Token Usage Time Series by Activity, Agent & Model

## Summary
Extend the analytics data pipeline to expose a `tokensByActivityTimeSeries` series — cumulative token usage over time, broken down by activity (implement/eval/review/research) and agent (cc/gg/cx). The data structure is consumable by any downstream dashboard that wants to render a stacked area chart with one band per `agent:activity` combination. This feature ships the OSS data side only; rendering happens elsewhere.

## User Stories
- [ ] As a developer, I want token usage data broken down by activity over time so I can understand whether eval or implementation is driving my costs
- [ ] As a developer, I want each agent's data accessible per activity so I can compare cc vs gg token spend
- [ ] As a developer, I want both daily and weekly bucket data so the consuming dashboard can offer a toggle

## Acceptance Criteria
- [ ] `collectAnalyticsData()` returns a new `tokensByActivityTimeSeries` array (see Data structure below)
- [ ] Each entry has a `date` and one numeric field per `agent:activity` seriesKey (e.g. `cc:implement`, `gg:implement`, `cc:eval`, `cc:review`)
- [ ] The series is empty when fewer than 2 features have telemetry with `activity` populated
- [ ] Most-common model per series is included in series metadata (so a downstream tooltip can show e.g. "cc:implement — claude-opus-4-6")
- [ ] Existing `tokensByAgentTimeSeries` is left untouched — this is purely additive

## Validation
```bash
node -c lib/utils.js
node -c lib/dashboard-server.js
```

## Technical Approach

### Data pipeline (`lib/utils.js`)
`readTelemetryRecords` currently drops the `activity` field from each record. Add it:
```js
activity: parsed.activity || null,
```

In `collectAnalyticsData`, add a new series builder alongside the existing `tokensByAgentTimeSeries`:

## Data structure

```
tokensByActivityTimeSeries: [
  { date: '2026-03-24', 'cc:implement': 21400, 'gg:implement': 18200, 'cc:eval': 3100 },
  ...
]
```

Builder logic:
1. For each telemetry record, derive `seriesKey = record.activity ? \`${record.agent}:${record.activity}\` : record.agent`
2. Bucket by day/week, sum billableTokens per seriesKey
3. Collect all unique seriesKeys seen; return sorted series array

The existing `aggregateTelemetryByAgent` can stay untouched — the new series is additive.

### Series metadata
Each dataset pulls model from the most common model seen for that `agent:activity` combination across all records (stored in the series metadata so consumers can render per-series labels).

## Dependencies
- Feature 208 (telemetry activity breakdown) — `activity` field must be present in telemetry records. ✅ Already shipped.

## Out of Scope
- Chart rendering (this feature ships data only; downstream dashboards consume it)
- Per-feature drill-down
- Research entity telemetry (research sessions don't have activity breakdown yet)
- Cost time series variant (separate feature)

## Open Questions
- (None — scope is data-pipeline-only)

## Related
- Feature 208: telemetry activity breakdown (shipped — adds `activity` field to records)
- Existing series: `tokensByAgentTimeSeries` — this is the activity-aware extension
