# Feature: Token Usage Chart by Activity, Agent & Model

## Summary
Add a stacked area chart to the Amplification dashboard showing cumulative token usage over time, broken down by activity (implement/eval/review/research) and agent (cc/gg/cx). Each band in the chart is a different colour — e.g. cc-implement (blue), gg-implement (teal), cc-eval (yellow), cc-review (red) — giving a clear visual picture of where tokens are being spent and how the mix shifts over time.

## User Stories
- [ ] As a developer, I want to see token usage over time broken down by activity so I can understand whether eval or implementation is driving my costs
- [ ] As a developer, I want each agent shown in a distinct colour so I can compare cc vs gg token spend at a glance
- [ ] As a developer, I want to toggle between daily/weekly buckets to zoom in or out

## Acceptance Criteria
- [ ] A stacked area chart appears in the Amplification tab titled "Token Usage by Activity & Agent"
- [ ] Each series is a unique `agent:activity` combination (e.g. `cc:implement`, `gg:implement`, `cc:eval`, `cc:review`)
- [ ] Series are coloured by agent family (cc = blue family, gg = teal/green, cx = orange), with lighter shades for non-implement activities
- [ ] X-axis is time (daily or weekly bucket, toggleable), Y-axis is billable tokens
- [ ] Chart only renders when ≥2 features have telemetry with activity data
- [ ] Model name is shown in the tooltip per series (e.g. "cc:implement — claude-opus-4-6")
- [ ] Chart updates when Amplification data is refreshed

## Validation
```bash
node -c lib/utils.js
node -c lib/dashboard-server.js
```

## Technical Approach

### Data pipeline (aigon — `lib/utils.js`)
`readTelemetryRecords` currently drops the `activity` field from each record. Add it:
```js
activity: parsed.activity || null,
```

In `collectAnalyticsData`, add a new series builder alongside the existing `tokensByAgentTimeSeries`:

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

### Chart (aigon-pro — `dashboard/amplification.js`)
- Add a new `<canvas id="amp-activity-stacked-area">` block in the Amplification HTML section
- Use Chart.js `type: 'line'` with `fill: true`, `tension: 0.3`, `stacked: true` axes
- One dataset per seriesKey from `tokensByActivityTimeSeries`
- Color mapping: base agent color (from `AGENT_COLORS`) lightened by activity — implement = full, eval = 60% opacity, review = 40%, research = 50%
- Tooltip shows `agent:activity — model — N tokens`
- Bucket toggle (daily/weekly) re-buckets client-side, same pattern as existing `amp-agent-stacked-bar`

### Model label
Each dataset pulls model from the most common model seen for that `agent:activity` combination across all records (stored in the series metadata).

## Dependencies
- Feature 208 (telemetry activity breakdown) — `activity` field must be present in telemetry records. ✅ Already shipped.

## Out of Scope
- Per-feature drill-down from chart click
- Research entity telemetry (research sessions don't have activity breakdown yet)
- Cost chart variant (separate feature)

## Open Questions
- Should the chart be in aigon core (free) or aigon-pro only? Suggest PRO since it's in the Amplification tab.

## Related
- Feature 208: telemetry activity breakdown (shipped — adds `activity` field to records)
- Existing chart: "Token Usage by Agent Over Time" (stacked bar) in amplification.js — this replaces/augments it with area + activity breakdown
