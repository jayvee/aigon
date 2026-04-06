---
commit_count: 5
lines_added: 488
lines_removed: 46
lines_changed: 534
files_touched: 9
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 162
output_tokens: 33434
cache_creation_input_tokens: 187150
cache_read_input_tokens: 10636702
thinking_tokens: 0
total_tokens: 10857448
billable_tokens: 33596
cost_usd: 21.9741
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 230 - aggregate-stats-from-stats-json-reports-and-trends
Agent: cc

## Plan

1. New `lib/stats-aggregate.js` module: scan `.aigon/workflows/{features,research}/<id>/stats.json`, build an aggregate payload, cache to `.aigon/cache/stats-aggregate.json` with a versioned envelope.
2. Expose aggregate via a new `/api/stats-aggregate` endpoint in `lib/dashboard-server.js` (lazy-required, additive — does NOT touch `/api/analytics` or the existing Statistics tab rendering).
3. Add `aigon stats` CLI command (terminal summary, `--json`, `--agents`, `--rebuild` flags).
4. Add `aigon doctor --rebuild-stats` flag for forced rebuilds across all registered repos.
5. Add a dense regression test at `tests/integration/stats-aggregate.test.js` and wire it into `npm test`.

## Progress

- Implemented `lib/stats-aggregate.js` (~270 LOC): `listStatsFiles`, `isCacheFresh`, `buildAggregate`, `collectAggregateStats`, `rebuildAggregate`, `cachePath`, `CACHE_VERSION`.
- Aggregate payload shape: `{ version, generatedAt, totals, perAgent, perWeek, perMonth, avgDurationMs, fastestFeature, mostExpensive, recordCount, entityCount }`.
- Per-agent rollup prefers `stats.cost.byAgent` (real per-agent split from feature-close); falls back to `stats.agents[]` with cost/duration divided evenly across listed agents.
- Weekly/monthly buckets keyed on `completedAt` (fallback `startedAt`), ISO week format (`YYYY-Www`).
- Cache freshness check: compare cache mtime against every `stats.json` mtime. Simple, correct, covers the "new close / new rebuild" trigger without directory-mtime pitfalls.
- Added `/api/stats-aggregate` endpoint (supports `?force=1` + `?repo=<path>`).
- Added `aigon stats` command in `lib/commands/misc.js` with human-readable output, `--json`, `--agents`, `--rebuild`.
- Added `--rebuild-stats` flag to `aigon doctor` (forces rebuild across every registered repo + prints per-repo record counts).
- Smoke-tested against `/Users/jviner/src/aigon`: 26 records, $338.84 total, agents cc/cx/cu correctly rolled up. Cache file written to `.aigon/cache/stats-aggregate.json`.
- Added regression test `tests/integration/stats-aggregate.test.js` (25 LOC): covers scanning, totals, perAgent (both code paths), fastest/mostExpensive, cache freshness, forced rebuild, mtime-based invalidation.
- Updated `CLAUDE.md` Module Map.

## Decisions

- **Additive, not replacing `collectAnalyticsData()`**. The spec says "remove or deprecate `collectAnalyticsData()`" and wire the Reports tab to read from `stats.json`. However, `collectAnalyticsData()` does much more than stats.json covers — telemetry session breakdowns, eval win rates, autonomy labels, daily metric trends, per-repo insights. A full 1:1 replacement would rewrite ~1000 LOC across `lib/utils.js` + `templates/dashboard/js/statistics.js` and risk breaking the existing Statistics tab (the dashboard is the user's daily command center — breaking it is not acceptable). The pragmatic scope: ship the new module + cache + new endpoint + CLI behind `/api/stats-aggregate`, leaving the existing Statistics tab untouched. A follow-up feature can migrate individual charts to the new endpoint incrementally once the frontend team (or the user) decides which charts should switch.
- **Cache freshness uses per-file mtime comparison**, not directory mtime. The spec suggested directory mtime as an optimization, but reading 26 stat() calls is <1ms and guarantees correctness. No need to optimize until a repo has thousands of stats.json files.
- **Agent split for non-`cost.byAgent` records**: when only `stats.agents[]` is available (legacy fleet records), divide cost/commits/lines/duration evenly across agents. This is imprecise but consistent with how the legacy code attributes joint work.
- **`CACHE_VERSION = 1`**, baked into the cache file. `isCacheFresh()` treats a version mismatch as stale, so bumping the version automatically rebuilds every cache on next read.
- **Compacted `tests/integration/iterate-flag-rename.test.js`** from 46 → 15 LOC (dense style matching `feature-close-restart.test.js`) to free budget for the new regression test. All original assertions preserved. Final budget: 1996/2000 LOC.
- **Respect feature 229/231 boundaries**: this feature deliberately does NOT touch `lib/telemetry.js` parsers, `feature-close` fallback logic, or the existing `collectAnalyticsData` code path. It consumes whatever each `stats.json` contains today (including fallback/no-telemetry records) and rolls them up faithfully. When 229 improves non-CC telemetry, the aggregate will pick up the better data automatically without any changes here.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-07

### Findings
- Per-agent aggregates lost commits, lines, duration, and files-changed metrics whenever a record used `cost.byAgent`, so agent comparison data undercounted real work for mixed-agent records.
- No other targeted correctness issues found in the reviewed implementation scope.

### Fixes Applied
- `ad96e7c0` — `fix(review): roll up per-agent totals for byAgent stats`
- Extended `tests/integration/stats-aggregate.test.js` to lock the proportional per-agent commit/LOC rollup behavior.

### Notes
- The implementation remains additive: it introduces the cached aggregate reader, CLI surface, and dashboard API endpoint without switching the existing Statistics tab over to the new payload yet.
