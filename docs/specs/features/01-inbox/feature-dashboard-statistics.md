# Feature: dashboard-statistics

## Summary
Add a statistics layer to the existing Aigon dashboard so users can understand delivery throughput across all registered repos, not just live agent state. The dashboard should show completed-feature counts over standard periods (day, week, month, quarter), feature duration metrics from implementation start to completion, and a breakdown of completed implementations by coding agent. This should build on the current Radar/dashboard data path and introduce durable lifecycle timestamps where Aigon does not already record enough history.

## User Stories
- [ ] As a user running Aigon across multiple repos, I want to see how many features I completed this day, week, month, and quarter so I can understand throughput trends.
- [ ] As a user, I want average and maximum feature duration metrics so I can see how long work takes from implementation start to feature completion.
- [ ] As a user, I want a breakdown of completed features by coding agent so I can compare how work is being delivered in drive and fleet workflows.
- [ ] As a user, I want these statistics in the existing dashboard surface so I do not need to inspect git history or spec folders manually.

## Acceptance Criteria
- [ ] The existing dashboard/Radar UI includes a statistics section above or alongside the current live-status repo cards.
- [ ] The statistics are aggregated across all repos registered in the global Radar/conductor repo registry.
- [ ] The dashboard shows completed-feature counts for `today`, `last 7 days`, `last 30 days`, and `last 90 days`.
- [ ] The dashboard also shows calendar-bucket counts for `daily`, `weekly`, `monthly`, and `quarterly` completion series suitable for simple charts or summary cards.
- [ ] The dashboard shows duration metrics for completed features: `average`, `median`, and `max`.
- [ ] Duration is defined as the elapsed time between implementation start and feature completion.
- [ ] The dashboard shows a completed-features-by-agent breakdown using the winning implementation agent when available, and a `solo` bucket for drive-mode features without agent attribution in the filename.
- [ ] A new analytics payload is exposed from the local dashboard service, either as a dedicated `/api/analytics` endpoint or an additive extension to `/api/status`, without breaking the current UI client.
- [ ] The analytics payload includes enough per-feature metadata to support period filtering, duration calculations, repo grouping, and agent attribution.
- [ ] New features completed after this change record explicit lifecycle timestamps so duration and completion time are durable and do not depend only on file mtimes.
- [ ] Historical features that predate the new metadata are included using best-effort inference from existing logs and git history, with missing values omitted rather than fabricated.
- [ ] Empty states are handled clearly when no registered repos exist or when no completed-feature analytics can be computed yet.
- [ ] `node --check aigon-cli.js` passes.

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach
Extend the current dashboard architecture rather than creating a separate analytics product. Today the web dashboard is built from `collectDashboardStatusData()` in [lib/utils.js](/Users/jviner/src/aigon/lib/utils.js) and rendered via [templates/dashboard/index.html](/Users/jviner/src/aigon/templates/dashboard/index.html). The new work should add a parallel analytics collection path that reuses the same registered-repo scan and returns completed-feature metrics alongside the live status data.

### Data sources

For each registered repo, analytics should read:

- Feature specs in `docs/specs/features/05-done/` to identify completed features.
- Selected implementation logs in `docs/specs/features/logs/selected/` to determine the winning agent and lifecycle metadata.
- Git history as a fallback for historical completion timestamps where explicit metadata does not yet exist.

### Lifecycle metadata

Current logs record `status` and `updated`, and `feature-close` moves specs/logs into done/selected state, but Aigon does not currently persist explicit `startedAt` and `completedAt` values. That is not strong enough for durable duration analytics. This feature should therefore:

- Add `startedAt` when `feature-setup` creates an implementation log.
- Add `completedAt` when `feature-close` completes a feature and organizes the winning log/spec.
- Preserve `status` and `updated` for existing live-status features.

For historical features without these fields:

- Infer `startedAt` from the earliest commit that introduced the selected implementation log, or fall back to the log file birth/mtime if git history is unavailable.
- Infer `completedAt` from the commit that moved the feature spec to `05-done` and/or the log into `logs/selected`.
- If a timestamp cannot be established with confidence, exclude that feature from duration statistics but still allow it to count toward totals when completion time is known.

### Aggregation model

Add a new analytics collector, likely adjacent to `collectDashboardStatusData()`, that returns a structure such as:

```json
{
  "generatedAt": "2026-03-13T00:00:00.000Z",
  "summary": {
    "completedToday": 2,
    "completed7d": 9,
    "completed30d": 18,
    "completed90d": 41,
    "durationHours": {
      "average": 14.2,
      "median": 9.5,
      "max": 61.0
    }
  },
  "series": {
    "daily": [],
    "weekly": [],
    "monthly": [],
    "quarterly": []
  },
  "agents": [
    { "agent": "cc", "completed": 12 },
    { "agent": "cx", "completed": 8 },
    { "agent": "solo", "completed": 5 }
  ],
  "features": []
}
```

The feature-level records should include repo path, feature ID, feature name, started/completed timestamps, duration, and winning agent. That supports both summary cards now and more detailed views later without rescanning the filesystem in the browser.

### UI changes

Update the existing inline dashboard template to add a compact analytics band before the repo grid. It should fit the current premium dashboard aesthetic from feature 41 and avoid introducing a new visual language. A reasonable first cut is:

- Four summary cards for completion throughput windows.
- One duration card showing average, median, and max.
- One agent breakdown card or simple horizontal bar list.
- One compact chart area or bucket list for daily/weekly/monthly/quarterly series.

The UI should degrade cleanly when analytics are partially unavailable due to older historical data.

### Performance and scope constraints

- Repo scanning should remain local-only and filesystem-first.
- Git history lookups should be cached per request cycle so the dashboard does not become slow on every poll.
- Analytics should target completed features only and must not interfere with current live-status polling behavior.

## Dependencies
- Feature 31: [feature-31-log-status-tracking.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-31-log-status-tracking.md) for the existing log-file front matter contract.
- Feature 41: [feature-41-conductor-web-dashboard.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-41-conductor-web-dashboard.md) for the current dashboard UI and `/api/status` model.
- Feature 45: [feature-45-aigon-radar.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-45-aigon-radar.md) for the unified Radar/dashboard service direction and multi-repo registry.

## Out of Scope
- Cost estimation, token usage, or provider billing analytics.
- Per-step implementation timing inside a feature beyond start-to-complete duration.
- Cross-user or cloud-synced team analytics; this remains local to the machine and registered repos.
- Replacing the current live status dashboard with a separate analytics-only screen.
- Perfect historical reconstruction for legacy features when timestamps cannot be inferred reliably.

## Open Questions
- Should analytics live under `/api/status` for one-payload simplicity, or `/api/analytics` to keep the live-status contract stable?
- Should duration metrics use wall-clock elapsed time only, or also report business-day-style duration later?
- Should drive-mode features remain attributed to `solo`, or should Aigon start storing the launching agent identity for single-agent runs as new metadata?
- Should the first version show lightweight inline charts, or only summary cards and bucket tables?

## Related
- Research:
- Feature: [feature-agent-cost-awareness.md](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-agent-cost-awareness.md) for adjacent analytics ideas, though this feature is explicitly about throughput and delivery statistics rather than cost.
