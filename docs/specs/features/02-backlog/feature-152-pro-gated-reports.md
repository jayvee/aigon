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
- [ ] Pro metrics appear inline in their natural position alongside free metrics (not in a separate section)
- [ ] Blurred placeholders use CSS filter blur on static SVG chart shapes (not real data, not empty boxes)
- [ ] Zero layout shift when toggling Pro on/off — charts unlock in place
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
- **Public `logs.js`** only contains: free metric rendering + inline blur placeholders + dynamic `<script>` loader for `pro-reports.js`
- **No API data stripping** — `/api/analytics` returns all data regardless of Pro status. The data (commit counts, ratios) is derivable from git history and isn't the value prop. The value is the rendering, analysis, and presentation. Stripping data would also create re-fetch complexity when toggling Pro on/off for demos.
- After this feature ships, audit git history for any Pro rendering logic that was previously in `logs.js` and ensure it's removed from the public repo (force-push if needed, or verify it was never committed with Pro logic)

### Layout: Inline Gating (not separate sections)
Pro metrics appear **inline alongside free metrics** in their natural position — not in a separate section or tab. This preserves the analytical narrative: seeing volume next to rework next to CPF tells a coherent story. When Pro activates, charts "unlock" in place with zero layout shift.

- **Summary tab**: free stat cards (volume, cycle time, leaderboard) render normally. Pro stat cards (first-pass rate, CPF, rework ratio, eval wins) render as blurred placeholders **in the same card grid**, in their natural position
- **Charts tab**: all 5 chart slots render in order. Free: none currently (all charts are Pro). Each chart slot shows a blurred SVG placeholder with a small Pro badge overlay
- **Details tab**: feature list stays free. Commit-level agent/type filters and granularity controls are Pro-gated inline

This means the user always sees the full dashboard shape — they just can't read the Pro metrics until they upgrade. The blur + badge makes it obvious what's locked without disrupting the layout.

### Backend
- Add `proAvailable: isProAvailable()` to the `/api/status` response payload in `collectDashboardStatusData()` (dashboard-server.js)
- Add `forcePro` config key to `lib/config.js` (project-level `.aigon/config.json`), checked by `isProAvailable()` override in `lib/pro.js`
- `/api/analytics` returns all data unconditionally (no stripping)
- Add `/js/pro-reports.js` static route (same pattern as `/js/amplification.js`)

### Frontend
- In `logs.js` `renderStatistics()`, check `state.data.proAvailable`:
  - **Free metrics** (always rendered): completed counts, trend %, cycle time stats, agent leaderboard
  - **Pro metrics** (inline blurred): each Pro metric's slot renders a blur placeholder with Pro badge. When `pro-reports.js` loads, it replaces these placeholders with the real charts/metrics
- `pro-reports.js` (in `@aigon/pro`): exports a `renderProReports(container, analyticsData)` function that finds placeholder elements by `data-pro-slot` attributes and replaces them with rendered content
- New CSS class `.pro-gated` wrapping a blurred placeholder + absolute-positioned overlay
- `?forcePro=0` URL param: parsed in `init.js`, overrides `state.data.proAvailable` in the Alpine store

### Visual Design
- Blur placeholders: static SVG chart shapes with `filter: blur(6px)` and `pointer-events: none`
- Small Pro badge overlay (top-right of each gated card/chart): reuse existing `<sup>PRO</sup>` styling
- No full-page CTA wall — each gated element has its own subtle badge. One small "Unlock with Aigon Pro" note appears below the first blurred card in each section

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
