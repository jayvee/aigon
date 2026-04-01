# Feature: Aggregate Stats from stats.json — Reports and Trends

## Summary

The Reports/Statistics tab currently scrapes data from log file frontmatter YAML — inconsistent, fragile, and slow. Feature 206 introduces `stats.json` per feature/research as the structured source of truth. This feature wires the Reports tab to read from `stats.json` files, replacing markdown scraping with JSON reads. It also introduces an aggregate cache to avoid scanning hundreds of files on every dashboard load.

## Scale Considerations

**Current scale:** ~200 features across 2 repos. Scanning 200 JSON files takes <100ms. No problem.

**Future scale (1000+ features across 10+ repos):**
- Scanning 1000 `stats.json` files: ~500ms. Noticeable but acceptable.
- Scanning 5000+: >2 seconds. Needs a cache.

**Design decision: aggregate cache, not a database.** A single `.aigon/stats-cache.json` per repo that holds the aggregated totals. Rebuilt lazily when any `stats.json` file is newer than the cache. This avoids:
- SQLite dependency (overkill for a CLI tool)
- Migration complexity
- Cross-platform database issues

If aigon ever needs real-time queries across thousands of features, the cache can be replaced with SQLite. But for now, a JSON file that rebuilds in <1 second covers the next 2-3 years of usage.

## User Stories

- [ ] As a user, I want the Reports tab to show accurate cost, throughput, and agent comparison charts
- [ ] As a user with 500+ features, I want the Reports tab to load in under 1 second
- [ ] As a developer, I want to add new aggregate metrics without changing the collection pipeline

## Acceptance Criteria

### Reports read from stats.json
- [ ] The Reports/Statistics tab reads from `stats.json` files, not log file frontmatter
- [ ] Fallback: for features without `stats.json` (pre-206), read from log frontmatter as before
- [ ] Charts show: cost per feature over time, throughput (features/week), agent comparison (cost, speed, commits), lines of code trend

### Aggregate cache
- [ ] `.aigon/cache/stats-aggregate.json` stores precomputed aggregates per repo
- [ ] Cache is rebuilt when any `stats.json` has a newer mtime than the cache file
- [ ] Cache rebuild scans all `stats.json` files and computes: total cost, total features, avg duration, per-agent totals, weekly/monthly rollups
- [ ] Dashboard reads from cache, not from individual files
- [ ] `aigon doctor` can rebuild the cache: `aigon doctor --rebuild-stats`
- [ ] Cache format is versioned (`{ version: 1, ... }`) so future changes can trigger automatic rebuild

### Performance
- [ ] Reports tab loads in <500ms for repos with up to 1000 features
- [ ] Cache rebuild completes in <2 seconds for 1000 features

### CLI
- [ ] `aigon stats` prints a summary to the terminal (total cost, features completed, avg duration)
- [ ] Same data as the dashboard, same source

## Validation

```bash
node -c lib/feature-status.js
node -c lib/dashboard-server.js

# Cache file is created after first load
# Stats are consistent between CLI and dashboard
```

## Technical Approach

### 1. Stats collector: `lib/stats-aggregate.js` (~150 lines)

```js
function collectAggregateStats(repoPath) {
    const cachePath = path.join(repoPath, '.aigon', 'cache', 'stats-aggregate.json');

    // Check if cache is fresh
    if (isCacheFresh(cachePath, repoPath)) {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }

    // Scan all stats.json files
    const stats = scanAllStatsFiles(repoPath);

    // Compute aggregates
    const aggregate = {
        version: 1,
        generatedAt: new Date().toISOString(),
        totals: { features: 0, research: 0, cost: 0, commits: 0, linesAdded: 0, linesRemoved: 0 },
        perAgent: {},       // { cc: { features: 5, cost: 120, avgDuration: 300000 }, ... }
        perWeek: [],        // [{ week: '2026-W14', features: 3, cost: 45 }, ...]
        perMonth: [],       // [{ month: '2026-04', features: 12, cost: 180 }, ...]
        avgDurationMs: 0,
        fastestFeature: null,
        mostExpensive: null,
    };

    // Write cache
    fs.writeFileSync(cachePath, JSON.stringify(aggregate, null, 2));
    return aggregate;
}
```

### 2. Cache freshness check

```js
function isCacheFresh(cachePath, repoPath) {
    if (!fs.existsSync(cachePath)) return false;
    const cacheMtime = fs.statSync(cachePath).mtimeMs;
    // Check if any stats.json is newer than cache
    const statsDir = path.join(repoPath, '.aigon', 'workflows');
    // Quick check: compare cache mtime against directory mtime
    // Full check only if directory changed
    return fs.statSync(statsDir).mtimeMs < cacheMtime;
}
```

This is approximate — directory mtime changes when files are added/removed but not when file contents change. For exact freshness, scan individual file mtimes. The tradeoff is acceptable: the cache rebuilds on close (new file created) and on doctor (forced rebuild).

### 3. Wire into dashboard

Replace the current `collectAnalyticsData()` in `lib/utils.js` (which scrapes log frontmatter) with `collectAggregateStats()`. The dashboard API endpoint returns the aggregate object. The frontend charts read from it.

### 4. Fallback for pre-206 features

Features without `stats.json` get a synthetic record built from log frontmatter during cache rebuild. This handles the transition period. Once all features have `stats.json`, the fallback can be removed.

### Key files:
- NEW: `lib/stats-aggregate.js` — collector and cache
- `lib/dashboard-server.js` — serve aggregate stats from cache
- `templates/dashboard/js/statistics.js` — read from new aggregate format
- `lib/utils.js` — remove or deprecate `collectAnalyticsData()`

## Dependencies

- depends_on: unified-feature-stats (206) — provides `stats.json` per feature

## Out of Scope

- SQLite or any database (JSON cache is sufficient for foreseeable scale)
- Real-time streaming stats (cache is rebuilt lazily, not on every event)
- Cross-repo aggregation (each repo has its own cache; multi-repo totals computed client-side)
- Changing the dashboard chart library or visual design

## Open Questions

- Should the cache include raw per-feature records or only aggregated totals? Raw records make the cache larger but enable drill-down without re-scanning files.
- Should `aigon stats` show per-agent breakdown by default or require a flag?

## Related

- Feature 206: Unified Feature Stats (provides the per-feature `stats.json`)
- The current `collectAnalyticsData()` in utils.js (720 lines of log scraping — to be replaced)
