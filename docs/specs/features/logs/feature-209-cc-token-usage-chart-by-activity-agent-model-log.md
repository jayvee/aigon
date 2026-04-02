# Implementation Log: Feature 209 - token-usage-chart-by-activity-agent-model

## Plan
- Align the implementation back to feature 209's actual scope: Amplification token usage by `agent:activity`, not a new Statistics chart.
- Extend the analytics payload in `collectAnalyticsData()` so the Pro Amplification renderer can chart activity-aware token usage with model labels.
- Remove unrelated changes that were mixed into this feature.

## Progress
- Added `activity` to normalized telemetry records read by `collectAnalyticsData()` so downstream analytics can distinguish implement/evaluate/review/research sessions.
- Added `amplification.tokensByActivityTimeSeries` to the analytics payload in `lib/utils.js`:
  - daily points keyed by `agent:activity`
  - most-common model per series for tooltip display
  - `featuresWithActivity` count so the Pro chart can enforce the "only show with >=2 features" rule
- Removed the unrelated seed-reset/bootstrap `npm install --prefer-offline` change from `lib/commands/setup.js`.
- Removed the unrelated "Tokens Used" Statistics dashboard chart work from `templates/dashboard/js/logs.js` and `templates/dashboard/js/statistics.js`.
- Restarted the AIGON server after the `lib/utils.js` change so the updated analytics payload is served.

## Decisions
- Kept the feature implementation in the public repo focused on the analytics/data contract. The actual Amplification chart renderer already exists in the local `aigon-pro` repo and consumes `amplification.tokensByActivityTimeSeries`.
- Counted distinct `repoPath:featureId` combinations with non-null `activity` to drive the feature gate for rendering.
- Used the most frequently observed model per `agent:activity` series as the tooltip label source, matching the feature spec.

## Validation
- `node -c lib/utils.js`
- `node -c lib/commands/setup.js`
- `node -c templates/dashboard/js/logs.js`
- `node -c templates/dashboard/js/statistics.js`
- Manual analytics payload sanity check via `collectAnalyticsData()`
- `aigon server restart`
