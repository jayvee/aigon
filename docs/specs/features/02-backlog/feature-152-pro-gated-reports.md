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
- [ ] Pro chart/metric rendering code lives exclusively in `@aigon/pro`, NOT in the public aigon repo
- [ ] `/api/analytics` strips Pro-only data fields when Pro is unavailable (defence in depth)
- [ ] Blurred placeholders use CSS filter blur on static SVG chart shapes (not real data, not empty boxes)
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

### Code Protection Strategy
Pro chart/metric rendering code must NOT be in the public aigon repo. Follow the same pattern as `amplification.js`:
- **Extract** all Pro rendering code (charts, rework ratio, CPF, first-pass rate, eval wins) from `logs.js` into a new module in `@aigon/pro` (e.g. `pro-reports.js`)
- **Serve** via the existing `/js/*.js` static handler in dashboard-server.js (same as `amplification.js` — checks `isProAvailable()`, reads from `getPro().dashboardDir`)
- **Public `logs.js`** only contains: free metric rendering + blur placeholder + dynamic `<script>` loader for `pro-reports.js`
- **`/api/analytics`** gates Pro data at the API level: when `!isProAvailable()`, strip chart series, rework, CPF, eval wins from the response. Belt-and-suspenders — even if someone loads the JS, the data isn't there.
- After this feature ships, audit git history for any Pro rendering logic that was previously in `logs.js` and ensure it's removed from the public repo (force-push if needed, or verify it was never committed with Pro logic)

### Backend
- Add `proAvailable: isProAvailable()` to the `/api/status` response payload in `collectDashboardStatusData()` (dashboard-server.js)
- Add `forcePro` config key to `lib/config.js` (project-level `.aigon/config.json`), checked by `isProAvailable()` override in `lib/pro.js`
- `/api/analytics` returns **reduced data** when Pro unavailable: strip `amplification`, chart `series` arrays, `evalWins`, `autonomy.firstPassSuccessRate`, `quality.reworkRatio`, `quality.commitsPerFeature`
- Add `/js/pro-reports.js` static route (same pattern as `/js/amplification.js`)

### Frontend
- In `logs.js` `renderStatistics()`, check `state.data.proAvailable` before rendering:
  - **Free metrics** (always rendered): completed counts, trend %, cycle time stats, agent leaderboard
  - **Pro metrics** (gated): show blur placeholders, dynamically load `pro-reports.js` from `@aigon/pro` which renders the actual charts/metrics into the placeholder containers
- New CSS class `.pro-gated` wrapping a blurred placeholder + absolute-positioned overlay with Pro badge and CTA text
- Blur placeholders: static SVG chart shapes (not actual data) with `filter: blur(6px)` and `pointer-events: none`, overlaid with Pro badge
- `?forcePro=0` URL param: parsed in `init.js`, overrides `state.data.proAvailable` in the Alpine store

### Visual Design
- Blur overlay: `filter: blur(6px)` on static SVG placeholder shapes, with a centered overlay card
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
- `templates/dashboard/js/logs.js` — Reports tab rendering (renderStatistics) — Pro code to be extracted
- `templates/dashboard/js/init.js` — Insights tab rendering (already Pro-gated)
- `templates/dashboard/index.html` — Tab layout with existing PRO badge on Insights
- `lib/dashboard-server.js:3128` — existing `/js/amplification.js` Pro static file pattern to follow
- `~/src/aigon-pro` — private repo where Pro rendering code lives
