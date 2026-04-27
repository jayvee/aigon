---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T01:27:19.173Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-cost-dashboard

## Summary
Surface per-agent and per-feature cost data prominently in the dashboard. The telemetry pipeline (`lib/telemetry.js`, `lib/analytics.js`) already collects token counts and USD cost per agent session — this feature exposes that data where it matters: a cost summary in the main Statistics view and per-agent cost inline on the feature Stats tab. Closes the Roo Code gap identified in research-24 and reaffirmed in research-44: Roo Code surfaces per-request cost inline and provides a spend analytics panel; Aigon currently buries cost in per-feature Stats tabs only, with no at-a-glance aggregate view.

## User Stories
- [ ] As a solo developer running Fleet mode, I open the Statistics view and immediately see my total spend for the last 7 and 30 days, broken down by agent — without clicking into individual features.
- [ ] As a cost-conscious user, I glance at the board and see which active features are already expensive and which are still cheap, so I know where to intervene.
- [ ] As a maintainer reviewing a closed feature, the Stats tab shows each agent's token breakdown (input / cache-read / output / thinking) and USD cost so I can assess whether the model selection was appropriate.

## Acceptance Criteria
- [ ] The Statistics view (main board Logs tab, free tier — not Pro-gated) includes a **Cost** section with: total spend for the last 7d and 30d; per-agent breakdown table (agent, sessions, tokens, USD); and a sparkline trend (reuse the `buildSparklineSvg` helper already in `logs.js`).
- [ ] The per-feature Stats tab in the drawer already shows "Cost by Agent" — ensure all four token columns are present: input, cache-read, output, thinking (currently only input/output/cost are shown; add cache-read and thinking if data exists).
- [ ] Costs that cannot be computed (agent doesn't expose JSONL, or no sessions closed yet) render as "n/a" — never as 0 or blank, so the user can distinguish "free" from "unknown."
- [ ] No new routes needed — consume existing `/api/analytics` and `/api/detail/feature/:id` payloads; extend them in-place if any field is missing.
- [ ] A regression test in `test/` (or `test/ui/`) pins that `costByAgent` is present in the analytics payload when at least one closed feature with telemetry exists.

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
- `lib/analytics.js` already builds `costTrend7d`, `costTrend30d`, `telemetryAgent30d` — verify these fields are present in the `/api/analytics` response and add any missing ones.
- `templates/dashboard/js/logs.js` already imports `buildDailyMetricTrend` and computes cost sparklines (lines 612–617) — these are currently rendered only in the Amplification (Pro) section. Move or duplicate the cost section to the free-tier statistics view so it renders for all users.
- `lib/dashboard-routes.js` already serves `costByAgent` in the detail payload (lines 252–300). Check if `cacheReadTokens` and `thinkingTokens` fields are present per agent; if not, add them from `lib/telemetry.js parseTelemetryFromJsonl` which already tracks them.
- Keep the existing Amplification section cost sparklines untouched — the free-tier cost section is additive, not a replacement.

## Dependencies
- depends_on: none

## Out of Scope
- Real-time cost update as a feature runs (streaming cost ticker) — post-close telemetry only.
- Budget alerts or spending caps.
- Cost forecasting or projections.
- Surfacing cost on the kanban board card itself (too noisy for the board view).
- Multi-repo cost aggregation across repos (per-repo only, matching current analytics scope).

## Related
- Research: R44 — competitive positioning and landscape
- Research: R24 — Roo Code comparison (origin of the gap)
- Set: competitive-positioning
- Prior features in set: F399 (competitive-positioning-foundation)
