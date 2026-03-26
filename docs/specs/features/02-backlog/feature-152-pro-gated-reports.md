# Feature: pro-gated-reports

## Summary

Move advanced reporting metrics (charts, rework ratio, commits-per-feature, first-pass rate, eval win rates) behind the Pro tier in the dashboard. Free tier shows volume, cycle time, and agent leaderboard. Pro-gated sections display blurred/greyed-out placeholder charts with a clear "Upgrade to Pro" call-to-action, so free users see what they're missing. A dev toggle lets the maintainer simulate free vs Pro for testing/demos.

## User Stories
- [ ] As a free-tier user, I see basic reporting (volume counts, cycle time, agent leaderboard) so I get value immediately
- [ ] As a free-tier user, I see blurred/obscured chart placeholders with a Pro badge and upgrade CTA, so I know what advanced analytics look like
- [ ] As a Pro user, all charts and advanced metrics render normally with no visual gating
- [ ] As the maintainer, I can toggle Pro on/off (e.g. via config or URL param) to demo both tiers without unlinking @aigon/pro

## Acceptance Criteria
- [ ] Reports > Summary tab: volume (completed today/7d/30d/90d, trend), cycle time (avg/median/max), and agent leaderboard remain free
- [ ] Reports > Summary tab: first-pass rate, commits-per-feature, rework ratio, and eval win rates show blurred placeholders with Pro badge when Pro is unavailable
- [ ] Reports > Charts tab: all 5 time-series charts show blurred placeholders with a Pro upgrade CTA overlay when Pro is unavailable
- [ ] Reports > Details tab: commit log filtering by agent/type and granularity controls (daily/weekly/monthly) are Pro-gated
- [ ] Blurred placeholders use CSS filter blur on realistic-looking dummy/static chart images or SVG shapes (not empty boxes)
- [ ] Pro badge + CTA overlay is visually consistent with the existing Insights PRO badge style
- [ ] `/api/status` response includes a `proAvailable` boolean so the frontend can gate without extra requests
- [ ] A `?forcePro=0` URL param (or `aigon config set forcePro false`) overrides the Pro check for demo/testing, even when @aigon/pro is installed
- [ ] Dashboard visual regression: Playwright screenshot test for both Pro and non-Pro states
- [ ] No changes to the Insights tab (already Pro-gated)

## Validation
```bash
node --check lib/dashboard-server.js
node --check lib/config.js
node aigon-cli.test.js
```

## Technical Approach

### Backend
- Add `proAvailable: isProAvailable()` to the `/api/status` response payload in `collectDashboardStatusData()` (dashboard-server.js)
- Add `forcePro` config key to `lib/config.js` (project-level `.aigon/config.json`), checked by `isProAvailable()` override in `lib/pro.js`
- `/api/analytics` continues returning all data regardless — gating is purely frontend

### Frontend
- In `logs.js` `renderStatistics()`, check `state.data.proAvailable` before rendering:
  - **Free metrics** (always rendered): completed counts, trend %, cycle time stats, agent leaderboard
  - **Pro metrics** (gated): first-pass rate card, CPF card, rework ratio card, eval win rates, all 5 charts, granularity controls, advanced detail filters
- New CSS class `.pro-gated` wrapping a blurred container + absolute-positioned overlay with Pro badge and CTA text
- Blurred content: render the actual chart/metric HTML but wrap in a `filter: blur(6px)` container with `pointer-events: none`, overlaid with a semi-transparent card containing the Pro badge and "Available with Aigon Pro" text
- `?forcePro=0` URL param: parsed in `init.js`, overrides `state.data.proAvailable` in the Alpine store

### Visual Design
- Blur overlay: `backdrop-filter: blur(6px)` or `filter: blur(6px)` on the content, with a centered overlay card
- Pro badge: reuse existing `<sup>PRO</sup>` styling from the Insights tab
- CTA: simple text "Available with Aigon Pro" with a subtle border, no external links (Pro is installed via npm)

## Dependencies
- None (builds on existing Reports tab and `lib/pro.js`)

## Out of Scope
- Pricing page or external upgrade flow
- Changes to the Insights tab (already Pro-gated)
- Changes to CLI `aigon metrics` output
- Actual Pro feature development (this is purely the gating UX)

## Open Questions
- Should the Details tab feature list remain fully free, or gate the commit-level analytics within it?

## Related
- `lib/pro.js` — Pro availability check
- `templates/dashboard/js/logs.js` — Reports tab rendering (renderStatistics)
- `templates/dashboard/js/init.js` — Insights tab rendering (already Pro-gated)
- `templates/dashboard/index.html` — Tab layout with existing PRO badge on Insights
