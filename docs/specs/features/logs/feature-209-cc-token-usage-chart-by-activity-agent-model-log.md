# Implementation Log: Feature 209 - token-usage-chart-by-activity-agent-model
Agent: cc

## Progress

- Added `activity` field to `readTelemetryRecords` in `lib/utils.js` (was previously dropped)
- Built `tokensByActivityTimeSeries` data pipeline alongside existing `tokensByAgentTimeSeries`
  - Buckets by day, keyed by `agent:activity` (e.g. `cc:implement`, `gg:implement`, `cc:evaluate`)
  - Tracks dominant model per series key for tooltip display
  - Includes `featuresWithActivity` count for the >=2 features guard
- Added stacked area chart to `amplification.js` (aigon-pro) with:
  - Chart.js `type: 'line'` with `fill: true`, `stacked: true` axes
  - Color scheme: base agent color with opacity varying by activity type
  - Daily/weekly bucket toggle (same pattern as existing stacked bar)
  - Tooltip shows `agent:activity — model — N tokens` with total footer
- All syntax checks pass (`node -c` on utils.js, dashboard-server.js, amplification.js)

## Decisions

- Chart is in aigon-pro (Amplification tab) per spec's suggestion — not in free tier
- Activity opacity mapping: implement=100%, research=50%, evaluate=60%, review=40% — gives visual hierarchy where implementation is most prominent
- Used `featuresWithActivity` count from backend rather than client-side counting for the >=2 features guard
- Cross-repo: data pipeline in aigon `lib/utils.js`, chart rendering in aigon-pro `dashboard/amplification.js`
