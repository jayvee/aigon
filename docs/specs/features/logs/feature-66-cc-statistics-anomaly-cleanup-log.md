---
status: submitted
updated: 2026-03-16T09:07:01.697Z
startedAt: 2026-03-16T02:42:27.705Z
completedAt: 2026-03-16T09:07:01.697Z
events:
  - { ts: "2026-03-16T02:42:27.705Z", status: implementing }
  - { ts: "2026-03-16T02:42:42.999Z", status: implementing }
  - { ts: "2026-03-16T02:52:17.362Z", status: waiting }
  - { ts: "2026-03-16T04:11:13.995Z", status: submitted }
---

# Implementation Log: Feature 66 - statistics-anomaly-cleanup
Agent: cc

## Plan

Explored: `templates/dashboard/index.html`, `lib/utils.js`, `lib/commands/shared.js`, and 7 affected log files across 4 repos.

## Progress

All 6 acceptance criteria groups implemented:
1. **Median switch** — `buildCycleTimeSeries()` uses median per bucket; stat card shows median; chart title updated
2. **Outlier detection** — P95 cap (min 48h) computed globally; outliers excluded from buckets with tooltip note
3. **Quality section** — shows both median and mean, clearly labelled
4. **cycleTimeExclude** — parsed from frontmatter, propagated to payload; excluded from all cycle time calculations, not volume counts
5. **Leaderboard** — uses median and respects cycleTimeExclude
6. **--exclude-above flag** — added to feature-backfill-timestamps
7. **Data quality fixes** — committed cycleTimeExclude: true to 7 log files across aigon, farline, when-swell repos

## Decisions

- **Outlier cap per bucket vs globally**: computed outlier cap globally from all non-excluded features, then applied per bucket. Avoids small-bucket distortion.
- **Stat card subtitle**: changed from "start to close" to "median, start to close" for clarity.
- **Legacy log files** (farline 37-38): prepended YAML frontmatter with only `cycleTimeExclude: true` — minimal disruption to legacy format, `updateLogFrontmatterInPlace` handles missing frontmatter by prepending.
- **when-swell 37-39**: marked as cycleTimeExclude (legitimate batch but causes distortion). batchId option from spec left for future work.
- Pre-existing test failures (3 of 151) confirmed unrelated to this feature via git stash test.
