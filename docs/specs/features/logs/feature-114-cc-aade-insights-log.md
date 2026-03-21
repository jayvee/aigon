# Implementation Log: Feature 114 - aade-insights
Agent: cc

## Plan

Three-phase insights engine: Phase 1 (rule-based CLI), Phase 2 (LLM coaching), Phase 3 (dashboard tab). Found that Phases 1-3 were already substantially implemented. The missing piece was wiring AADE telemetry fields through the analytics pipeline so the dashboard could render them.

## Progress

- Explored codebase: `lib/insights.js` (5 rule checks, coaching, caching), `lib/commands/misc.js` (CLI handler), `templates/dashboard/js/logs.js` (Amplification section with Insights subsection), `lib/dashboard-server.js` (API endpoints)
- Identified gap: `collectAnalyticsData()` in `lib/utils.js` was not parsing AADE fields from log frontmatter, so the dashboard Amplification section had no data to render
- Fixed `lib/utils.js`:
  1. Parse AADE fields (cost_usd, tokens_per_line_changed, autonomy_label, rework flags) from log frontmatter in `collectAnalyticsData`
  2. Include AADE fields in feature objects returned to the dashboard
  3. Added `amplification` aggregate section with trends to the return value
- All previously-failing `collectAnalyticsData` tests now pass (2 fixed, 7 remaining are pre-existing)

## Decisions

- Extended the existing `parseLogFrontmatterFull` read block (where `cycleTimeExclude` was already parsed) to also capture AADE fields, avoiding a second file read
- Computed `hasAadeData`, `hasReworkFlags`, and `firstPassNoRework` derived fields server-side so the dashboard can filter and display without client-side logic
- Added `amplification.trends` with 7d/30d sparkline data for cost and tokens_per_line_changed, matching the pattern the dashboard's `buildDailyMetricTrend` expects
