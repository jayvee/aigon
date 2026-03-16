# Feature: statistics-anomaly-cleanup

## Summary

The Statistics tab's cycle time charts and metrics are distorted by a small number of outlier features (7 of 220) that were parked, batched, or misattributed. A feature with a 40-day cycle time (parked research task) makes the daily average jump to 78h while the median is 0.3h. This feature switches cycle time aggregation from mean to median, adds outlier detection and capping, and fixes specific data quality issues in the backfilled log timestamps.

## User Stories

- [ ] As a user, I want cycle time charts to show median instead of mean so that a single parked feature doesn't distort an entire week or month of data.
- [ ] As a user, I want to see when data points are outliers so I can understand anomalies without them wrecking the chart scale.
- [ ] As a user, I want the Statistics tab to flag features with suspiciously long cycle times so I can decide whether to exclude or correct them.
- [ ] As a user, I want a way to mark specific features as "parked" or "batched" so their cycle times are excluded from averages without deleting the data.

## Acceptance Criteria

### Switch to median cycle time
- [ ] `buildCycleTimeSeries()` uses median instead of mean for the per-bucket cycle time value.
- [ ] The stat card "Avg Cycle Time" is renamed to "Cycle Time" and shows the median value.
- [ ] The cycle time chart title changes to "Median Cycle Time Over Time".
- [ ] The Quality section shows both median and mean, clearly labelled.

### Outlier detection and capping
- [ ] Features with cycle time above a configurable threshold (default: P95, or 48h if P95 < 48h) are flagged as outliers in the analytics payload.
- [ ] The cycle time chart visually distinguishes days/weeks where outliers were excluded (e.g., a small marker or tooltip note: "2 outliers excluded").
- [ ] Outlier features are still counted in volume metrics (features completed) but excluded from cycle time calculations.
- [ ] The agent leaderboard's "Cycle Time" column also uses median, excluding outliers.

### Data quality fixes
- [ ] aigon feature-03 "arena-research" (971.8h) — add `cycleTimeExclude: true` to log frontmatter. It's a research task, not an implementation.
- [ ] farline feature-70 "add-logo-images" (466.4h) — add `cycleTimeExclude: true`. Parked for 19 days.
- [ ] farline features 37-38 (984.2h each) — `startedAt` is Dec 8 but these are early farline features unlikely to have taken 41 days. Investigate git history and correct timestamps if possible.
- [ ] when-swell features 37-39 (~252h each) — legitimate batch but should be flagged. Add `batchId` or `cycleTimeExclude: true` to prevent distortion.

### Exclusion mechanism
- [ ] A new `cycleTimeExclude: true` field in log frontmatter causes `collectAnalyticsData()` to skip that feature in duration/cycle time calculations while still counting it in volume and completion metrics.
- [ ] `feature-backfill-timestamps` gains a `--exclude-above=<hours>` flag that auto-sets `cycleTimeExclude: true` for features exceeding the threshold.

### Validation
- [ ] `node --check aigon-cli.js` passes.
- [ ] All existing analytics tests pass.
- [ ] The cycle time chart no longer shows spikes above 50h for the current dataset.

## Validation

```bash
node --check aigon-cli.js
npm test
npx playwright test tests/dashboard-statistics.spec.js
```

## Technical Approach

### Median calculation

In `buildCycleTimeSeries()` (templates/dashboard/index.html), replace the mean aggregation:

```javascript
// Current: mean
const avg = vals.reduce((s, v) => s + v, 0) / vals.length;

// New: median
vals.sort((a, b) => a - b);
const mid = Math.floor(vals.length / 2);
const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
```

Same change in `collectAnalyticsData()` (lib/utils.js) for the server-side `quality.durationHours.average` — rename to `median` or add a separate field.

### Outlier detection

Compute P95 from the full feature set, then filter before chart aggregation:

```javascript
const sorted = allDurations.sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)];
const cap = Math.max(p95, 48); // never cap below 48h
const filtered = features.filter(f => !f.cycleTimeExclude && (f.durationMs / 3600000) <= cap);
```

### Exclusion frontmatter

Add to `parseLogFrontmatterFull()` recognition of `cycleTimeExclude` field. In `collectAnalyticsData()`, propagate it to the feature object. Client-side filtering respects it in cycle time calculations but not volume counts.

### Data fixes

Apply via targeted `updateLogFrontmatterInPlace()` calls or a one-time script. The 7 affected logs across 4 repos need `cycleTimeExclude: true` added to their frontmatter.

## Dependencies

- Feature 64: [feature-64-dashboard-statistics.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-64-dashboard-statistics.md) — the Statistics tab being cleaned up.

## Out of Scope

- Redesigning the chart library or chart types (keep Chart.js bar charts).
- Adding interactive outlier removal in the UI (future enhancement).
- Changing volume metrics or completion counts — only cycle time is affected.
- Predictive anomaly detection or ML-based outlier classification.

## Open Questions

- Should the P95 cap be computed per-repo or globally across all repos?
- Should "batched" features (multiple features closed together) get special handling beyond exclusion, e.g., splitting the elapsed time evenly?
- Should the exclusion mechanism be reversible from the Statistics tab UI, or only via CLI/frontmatter edits?

## Related

- Research:
- Feature: [feature-64-dashboard-statistics.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-64-dashboard-statistics.md)
