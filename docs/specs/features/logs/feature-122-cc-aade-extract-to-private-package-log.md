---
commit_count: 0
lines_added: 0
lines_removed: 0
lines_changed: 0
files_touched: 0
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---

# Implementation Log: Feature 122 - aade-extract-to-private-package
Agent: cc

## Plan

Extract all AADE (Amplification) code from the aigon repo into a separate private package (`@aigon/pro`) so that AADE source code never appears in public git history.

## Progress

- Explored codebase to map all AADE code and integration points
- Created `~/src/aigon-pro/` private package with:
  - `lib/insights.js` — full insights engine (491 lines, moved from `lib/insights.js`)
  - `dashboard/amplification.js` — dashboard view (384 lines, moved from `templates/dashboard/js/amplification.js`)
  - `commands/insights.md` — slash command template (moved from `templates/generic/commands/insights.md`)
  - `tests/insights.test.js` — 11 tests, all passing
  - `index.js` — entry point exporting `insights`, `dashboardDir`, `commandsDir`
  - `package.json` — `@aigon/pro` with private: true
- Created `lib/pro.js` — single integration point with `isProAvailable()` / `getPro()`
- Updated `lib/commands/misc.js` — `insights` command shows upgrade message when pro not installed
- Updated `lib/dashboard-server.js`:
  - `/api/insights` and `/api/insights/refresh` endpoints gate on pro availability
  - `/js/amplification.js` served from pro package when available, stub with upgrade message when not
  - Added `loadProjectConfig` to config imports for passing to pro
- Updated `aigon-cli.test.js` — insights tests run conditionally based on pro availability
- Removed from aigon: `lib/insights.js`, `lib/insights.test.js`, `templates/dashboard/js/amplification.js`, `templates/generic/commands/insights.md`

## Decisions

- **`generateAndCacheInsights` takes `loadProjectConfig` as a parameter** rather than importing `./config` directly. This avoids the pro package depending on aigon internals — the host passes config loading in.
- **Dashboard amplification tab stays in HTML** — the tab button remains visible regardless of pro status. When pro is not installed, the JS served is a stub that renders an upgrade message. This is simpler than conditionally hiding the tab.
- **`getFeatureGitSignals()` stays in free tier** (in `lib/git.js`) — data collection is free, only analysis/insights is pro. This matches the spec recommendation.
- **`collectAnalyticsData()` stays in free tier** (in `lib/utils.js`) — it aggregates data that the dashboard statistics view also uses. The AADE fields it collects are still populated from log frontmatter; they just don't get analyzed without pro.
- **logs.js amplification section stays** — it renders inline AADE metrics from the analytics API endpoint, which serves data from `collectAnalyticsData()`. This is basic metric display, not the insights engine.
- **No `templates/dashboard/js/insights.js` existed** — the spec assumed this file existed but it didn't. All insights rendering was inside `amplification.js`.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-22

### Findings
- `templates/dashboard/js/logs.js` still shipped the AADE amplification/insights section inside the public dashboard statistics page, which left AADE-specific UI and analysis logic in this repo after the extraction.

### Fixes Applied
- `a2ef5a3` — `fix(review): remove leftover AADE dashboard analytics from stats view`

### Notes
- Validated the review fix by parsing `templates/dashboard/js/logs.js` with Node after removing the leftover amplification section.
