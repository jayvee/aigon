# Implementation Log: Feature 118 - aade-amplification-dashboard

## Plan
- Extend analytics payload in `collectAnalyticsData()` to parse AADE frontmatter fields and expose amplification aggregates.
- Add a new collapsible Amplification section in the Statistics dashboard view.
- Render cost cards, autonomy labels, rework badges, and 7d/30d sparklines for cost and tokens-per-line trends.
- Add graceful missing-data fallbacks and keep existing statistics filters (repo + period) working.
- Update analytics tests for new AADE payload fields.

## Progress
- Extended `lib/utils.js` analytics pipeline:
  - Parses `cost_usd`, `tokens_per_line_changed`, `autonomy_label`, and `rework_*` fields from selected feature logs.
  - Adds per-feature AADE fields to `/api/analytics` payload (`costUsd`, `tokensPerLineChanged`, `autonomyLabel`, rework flags, `firstPassNoRework`, `hasAadeData`).
  - Adds top-level `amplification` aggregate with:
    - first-pass/no-rework rate
    - average cost and average tokens-per-line (30d)
    - 7d/30d daily trend series for cost and token efficiency
    - autonomy-label distribution
    - recent cost cards
- Updated `templates/dashboard/js/logs.js` (Statistics renderer) with a new collapsible **Amplification** section:
  - Summary cards for first-pass/no-rework, average cost, and average tokens-per-line.
  - Rolling 7d/30d sparklines for cost-per-feature and tokens-per-line-changed.
  - Recent feature cards with:
    - cost display
    - autonomy label pill (Full Autonomy / Light Touch / Guided / Collaborative / Thrashing when present)
    - rework indicators (thrashing, fix cascade, scope creep)
  - Missing data fallback (`—`/`No data`) when AADE fields are absent.
- Added supporting styles in `templates/dashboard/styles.css` for amplification cards, pills, badges, and responsive layout.
- Updated `aigon-cli.test.js` analytics tests to validate AADE parsing and amplification payload presence.
- Validation run:
  - `node --check lib/utils.js` ✅
  - `node --check templates/dashboard/js/logs.js` ✅
  - `node --check aigon-cli.test.js` ✅
  - `npm test` → 175/180 passing, 5 pre-existing failures in unrelated tests.
- Restarted dashboard backend after `lib/*.js` edits:
  - `node aigon-cli.js dashboard`
  - Confirmed startup message and local URL output.

## Decisions
- Kept Amplification inside the existing **Statistics** tab so repo/period filters automatically apply to AADE metrics.
- Used inline SVG sparklines (existing helper) to avoid adding chart dependencies.
- Treated missing AADE telemetry as first-class: UI shows placeholders instead of inferring synthetic values.
- Calculated first-pass rate for amplification from **absence of rework flags** (as specified), separate from existing wait-event first-pass metric.
