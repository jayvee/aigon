# Feature: dashboard-statistics

## Summary

Add a **Statistics tab** to the Aigon dashboard (alongside Monitor, Pipeline, Settings) that tracks delivery throughput, agent performance, and — most importantly — how effectively the user is leveraging AI over time. The core question this answers is: "Am I building more, faster, at higher quality, and with less manual intervention than last month?"

The statistics surface three dimensions:
1. **Volume** — features completed, code committed, code created, across time periods
2. **Autonomy** — what percentage of work happens without human intervention, measured by wait events, time-of-day signals, and autonomous mode usage
3. **Quality & Speed** — cycle times, first-pass success rates, eval win rates, iteration counts

This builds on the current Radar/dashboard data path and introduces durable lifecycle timestamps and interaction event tracking where Aigon does not already record enough history.

## User Stories

- [ ] As a user running Aigon across multiple repos, I want to see how many features I completed this day, week, month, and quarter so I can understand throughput trends.
- [ ] As a user, I want to see whether my AI usage is becoming more autonomous over time — fewer interventions, more overnight work, more first-pass successes — so I can measure improvement.
- [ ] As a user, I want average and maximum feature duration metrics so I can see how long work takes from implementation start to feature completion.
- [ ] As a user, I want a breakdown of completed features by coding agent so I can compare how work is being delivered in drive and fleet workflows.
- [ ] As a user, I want to see volume metrics (LOC added, files changed, commits) alongside feature counts so I can understand the scale of what's being built.
- [ ] As a user, I want an "autonomy score" that tracks what fraction of my AI-assisted work required no manual intervention, so I can see if I'm getting better at delegating to agents.
- [ ] As a user, I want these statistics in a dedicated Statistics tab so I do not need to inspect git history or spec folders manually.

## Acceptance Criteria

### Statistics tab
- [ ] A new "Statistics" tab appears in the dashboard tab bar alongside Monitor, Pipeline, and Settings.
- [ ] The tab renders a dashboard of cards, charts, and leaderboards organised into sections: Volume, Autonomy, Quality & Speed, and Agent Performance.
- [ ] Statistics are aggregated across all repos registered in the global Radar/conductor repo registry.
- [ ] A repo filter allows viewing stats for a single repo or all repos.
- [ ] A time-range selector allows switching between last 7 days, 30 days, 90 days, and all time.

### Volume metrics
- [ ] Completed-feature counts for `today`, `last 7 days`, `last 30 days`, and `last 90 days`.
- [ ] Calendar-bucket series for `daily`, `weekly`, `monthly`, and `quarterly` completion counts, suitable for sparkline or bar chart rendering.
- [ ] Lines of code added/removed per period (from git diff stats of feature branches at merge time).
- [ ] Files changed per period.
- [ ] Total commits per period.
- [ ] Trend indicators (up/down arrow + percentage change vs previous period).

### Autonomy metrics
- [ ] **Autonomy score**: percentage of total feature wall-time that was autonomous (no human interaction). Calculated as `1 - (total wait time / total wall time)` across all features in the period.
- [ ] **Overnight output**: volume of code committed during configured "away hours" (default: 11pm–7am in user's local timezone, configurable in dashboard settings). More overnight output = more autonomous work.
- [ ] **Wait events per feature**: average number of times agents entered `waiting` status per feature. Trend should decrease over time as the user improves specs and autonomous mode usage.
- [ ] **Autonomous mode adoption**: percentage of features run with `--autonomous` flag vs manual mode.
- [ ] **First-pass success rate**: percentage of features where the agent's implementation passed validation on the first attempt without user intervention (no `waiting` events before `submitted`).
- [ ] **Touch time vs wall time**: for each feature, calculate the ratio of time the user was actively involved (sum of durations between `waiting` and next `implementing` status) vs total elapsed time. Show the average ratio and trend.
- [ ] **Autonomy trend chart**: weekly autonomy score plotted over time to show improvement trajectory.

### Quality & speed metrics
- [ ] Duration metrics for completed features: `average`, `median`, and `max` cycle time (setup to close).
- [ ] Cycle time trend: is average duration decreasing over time?
- [ ] Iteration count: average number of agent retry cycles per feature (implement → fail validation → retry). Lower is better.
- [ ] Fleet eval win-rate leaderboard: for each agent, show total wins, total evals participated in, and win percentage. Data sourced from evaluation files in `docs/specs/features/evaluations/`.

### Agent performance
- [ ] Completed-features-by-agent breakdown using the winning implementation agent when available, and a `solo` bucket for drive-mode features.
- [ ] Per-agent autonomy score: which agents require the least human intervention?
- [ ] Per-agent first-pass success rate.
- [ ] Per-agent average cycle time.
- [ ] Per-repo agent breakdown (some agents perform better in certain codebases).

### Data collection
- [ ] A new analytics payload is exposed as `GET /api/analytics` (separate from `/api/status` to keep the live-status contract stable).
- [ ] The analytics payload includes enough per-feature metadata to support period filtering, duration calculations, repo grouping, agent attribution, and autonomy calculations.
- [ ] New features completed after this change record explicit lifecycle timestamps (`startedAt`, `completedAt`) so duration and completion time are durable.
- [ ] Agent status transitions (`implementing`, `waiting`, `submitted`, `error`) are appended with timestamps to an `events` array in the existing implementation log frontmatter. No new files are created — `aigon agent-status` already writes to the log file and simply appends to this array.
- [ ] Historical features that predate the new metadata are included using best-effort inference from existing logs and git history, with missing values omitted rather than fabricated.
- [ ] Empty states are handled clearly when no registered repos exist or when no completed-feature analytics can be computed yet.
- [ ] `node --check aigon-cli.js` passes.

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

Extend the current dashboard architecture with a new analytics collection path and a dedicated Statistics tab.

### Data sources

For each registered repo, analytics should read:

- Feature specs in `docs/specs/features/05-done/` to identify completed features.
- Selected implementation logs in `docs/specs/features/logs/selected/` to determine the winning agent and lifecycle metadata.
- Evaluation files in `docs/specs/features/evaluations/` to extract fleet eval winners. Each eval file contains a `**Winner:**` line with the winning agent ID (cc, cx, cu, gg). Parse this to build per-agent win tallies.
- Agent status transition history from the `events` array in implementation log frontmatter (when available).
- Git history for commit counts, LOC stats, completion timestamps, and time-of-day analysis.

### Lifecycle metadata

Current logs record `status` and `updated`, and `feature-close` moves specs/logs into done/selected state, but Aigon does not currently persist explicit `startedAt` and `completedAt` values. This feature should:

- Add `startedAt` when `feature-setup` creates an implementation log.
- Add `completedAt` when `feature-close` completes a feature and organizes the winning log/spec.
- Preserve `status` and `updated` for existing live-status features.

For historical features without these fields:

- Infer `startedAt` from the earliest commit that introduced the selected implementation log, or fall back to the log file birth/mtime if git history is unavailable.
- Infer `completedAt` from the commit that moved the feature spec to `05-done` and/or the log into `logs/selected`.
- If a timestamp cannot be established with confidence, exclude that feature from duration statistics but still allow it to count toward totals when completion time is known.

### Agent status event tracking

When `aigon agent-status <status>` is called, it already updates the log file's frontmatter (`status`, `updated`). Extend this to also append to an `events` array in the same frontmatter:

```yaml
---
status: submitted
updated: 2026-03-15T11:00:00.000Z
startedAt: 2026-03-15T09:30:00.000Z
events:
  - { ts: "2026-03-15T09:30:00Z", status: implementing }
  - { ts: "2026-03-15T10:15:00Z", status: waiting }
  - { ts: "2026-03-15T10:18:00Z", status: implementing }
  - { ts: "2026-03-15T11:00:00Z", status: submitted }
---
```

No new files — all metadata stays in the existing implementation log. Agents reading the log for context can ignore the `events` array; it's structured data that doesn't pollute the prose context window.

From this data, calculate:
- **Wait count**: number of `waiting` events
- **Total wait time**: sum of durations in `waiting` status
- **Wall time**: first `implementing` to final `submitted`
- **Autonomy ratio**: `1 - (wait_time / wall_time)`
- **First-pass success**: `true` if no `waiting` events between first `implementing` and `submitted`

### Autonomy: time-of-day classification

```javascript
function classifyCommitAutonomy(commitTimestamp, activeHours) {
  // activeHours = { start: 8, end: 23 } (user's configured active hours)
  const hour = new Date(commitTimestamp).getHours();
  if (hour >= activeHours.end || hour < activeHours.start) {
    return 'autonomous';  // overnight / away hours
  }
  return 'attended';  // during active hours (may still be autonomous)
}
```

For attended-hours commits, cross-reference with the event log: if the agent was in `implementing` status (no `waiting` events) during that commit, classify it as autonomous even during active hours.

### Aggregation model

New `GET /api/analytics` endpoint returns:

```json
{
  "generatedAt": "2026-03-15T00:00:00.000Z",
  "config": {
    "activeHours": { "start": 8, "end": 23 },
    "timezone": "Australia/Melbourne"
  },
  "volume": {
    "completedToday": 2,
    "completed7d": 9,
    "completed30d": 18,
    "completed90d": 41,
    "linesAdded30d": 12400,
    "linesRemoved30d": 3200,
    "filesChanged30d": 187,
    "commits30d": 94,
    "series": {
      "daily": [],
      "weekly": [],
      "monthly": [],
      "quarterly": []
    }
  },
  "autonomy": {
    "score": 0.78,
    "overnightCommitPct": 0.35,
    "avgWaitEventsPerFeature": 1.2,
    "autonomousModeAdoption": 0.45,
    "firstPassSuccessRate": 0.62,
    "avgTouchTimeRatio": 0.22,
    "trend": [
      { "week": "2026-W08", "score": 0.65 },
      { "week": "2026-W09", "score": 0.71 },
      { "week": "2026-W10", "score": 0.74 },
      { "week": "2026-W11", "score": 0.78 }
    ]
  },
  "quality": {
    "durationHours": { "average": 14.2, "median": 9.5, "max": 61.0 },
    "avgIterationsPerFeature": 1.4,
    "cycleTrend": []
  },
  "agents": [
    { "agent": "cc", "completed": 12, "autonomyScore": 0.82, "firstPassRate": 0.70, "avgCycleHours": 11.5 },
    { "agent": "cx", "completed": 8, "autonomyScore": 0.75, "firstPassRate": 0.55, "avgCycleHours": 16.2 },
    { "agent": "solo", "completed": 5 }
  ],
  "evalWins": [
    { "agent": "cc", "wins": 27, "evals": 43, "winRate": 0.63 },
    { "agent": "cx", "wins": 10, "evals": 43, "winRate": 0.23 },
    { "agent": "cu", "wins": 2, "evals": 43, "winRate": 0.05 },
    { "agent": "gg", "wins": 0, "evals": 10, "winRate": 0.00 }
  ],
  "features": []
}
```

### UI layout — Statistics tab

```
┌─────────────────────────────────────────────────────────────┐
│  [Monitor] [Pipeline] [Statistics ●] [Settings]             │
├─────────────────────────────────────────────────────────────┤
│  Repo: [All ▾]    Period: [30 days ▾]                       │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Features    │  Lines Added │  Commits     │  Cycle Time    │
│  ██████ 18   │  ██████ 12.4K│  ██████ 94   │  ██████ 9.5h   │
│  ▲ 22%       │  ▲ 15%       │  ▲ 8%        │  ▼ 18% ✓       │
├──────────────┴──────────────┴──────────────┴────────────────┤
│                                                             │
│  AUTONOMY                                        Score: 78% │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ████████████████████████████░░░░░░░░░░  78%        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Overnight output    35%  │  First-pass success  62%        │
│  Waits/feature       1.2  │  Autonomous mode     45%        │
│  Touch time ratio    22%  │                                 │
│                                                             │
│  Autonomy Trend (weekly)                                    │
│  ·  ·  ·                                                    │
│     ·     ·  ·                                              │
│  ·           ·  ·  ·                                        │
│  W06 W07 W08 W09 W10 W11                      ▲ improving  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AGENT LEADERBOARD                                          │
│                                                             │
│  Agent   │ Wins │ Win% │ Features │ Autonomy │ Cycle Time  │
│  cc      │  27  │  63% │    12    │   82%    │  11.5h      │
│  cx      │  10  │  23% │     8    │   75%    │  16.2h      │
│  cu      │   2  │   5% │     3    │   68%    │  18.0h      │
│  gg      │   0  │   0% │     2    │   71%    │  14.8h      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Performance and scope constraints

- Repo scanning should remain local-only and filesystem-first.
- Git history lookups (LOC stats, commit timestamps) should be cached per request cycle so the dashboard does not become slow on every poll.
- Event array parsing from log frontmatter should be lightweight — small structured arrays within existing files.
- Analytics should target completed features only and must not interfere with current live-status polling behavior.
- The `/api/analytics` endpoint should cache results and only recompute when the underlying data changes (new features closed, new evals written).

### User configuration

The user's active hours and timezone are stored in the global config (`~/.aigon/config.json`):

```json
{
  "analytics": {
    "activeHours": { "start": 8, "end": 23 },
    "timezone": "Australia/Melbourne"
  }
}
```

These can be edited from the Statistics tab's settings gear, or from the dashboard Settings tab.

## Example: Real-World Eval Data (March 2026)

Scanning evaluation files across two repos (farline + aigon) produced the following fleet eval win rates:

| Agent | Wins | Total Evals | Win Rate | Notes |
|-------|------|-------------|----------|-------|
| **cc (Claude)** | 27 | 47 | 57% | Dominant in full-stack/frontend (farline) |
| **cx (Codex)** | 10 | 47 | 21% | Stronger in CLI/tooling (aigon: 5/13 wins) |
| **cu (Cursor)** | 2 | 47 | 4% | Rarely wins fleet evals |
| **gg (Gemini)** | 0 | 10 | 0% | 1 tie with cc, no solo wins |

Per-repo breakdown shows context matters — Codex wins 38% of aigon evals but only 15% of farline evals. The leaderboard should support both cross-repo aggregate and per-repo views.

This data directly informed a cost-benefit analysis: at $200/mo for Codex Pro (unlimited) vs $20/mo Plus (weekly-limited), the 21% overall win rate translates to roughly $20 per winning implementation.

## Example: Autonomy Improvement Over Time

A user's hypothetical autonomy trajectory as they improve their Aigon workflow:

| Week | Autonomy Score | Waits/Feature | Overnight % | What Changed |
|------|---------------|---------------|-------------|--------------|
| W06 | 45% | 4.2 | 10% | First week using fleet mode |
| W07 | 55% | 3.1 | 15% | Started writing better specs |
| W08 | 65% | 2.0 | 25% | Added validation sections to specs |
| W09 | 71% | 1.5 | 30% | Started using `--autonomous` flag |
| W10 | 74% | 1.3 | 32% | Improved AGENTS.md with common patterns |
| W11 | 78% | 1.2 | 35% | Agents rarely need intervention now |

The trend chart visualises this progression, motivating the user to continue improving their specs and workflow to push autonomy higher.

## Dependencies

- Feature 31: [feature-31-log-status-tracking.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-31-log-status-tracking.md) for the existing log-file front matter contract.
- Feature 41: [feature-41-conductor-web-dashboard.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-41-conductor-web-dashboard.md) for the current dashboard UI and `/api/status` model.
- Feature 45: [feature-45-aigon-radar.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-45-aigon-radar.md) for the unified AIGON server direction and multi-repo registry.

## Out of Scope

- Cost estimation, token usage, or provider billing analytics (see `feature-agent-cost-awareness`).
- Per-step implementation timing inside a feature beyond start-to-complete duration.
- Cross-user or cloud-synced team analytics; this remains local to the machine and registered repos.
- Perfect historical reconstruction for legacy features when timestamps cannot be inferred reliably.
- Predictive analytics or ML-based recommendations.

## Open Questions

- Should duration metrics use wall-clock elapsed time only, or also report business-day-style duration later?
- Should drive-mode features remain attributed to `solo`, or should Aigon start storing the launching agent identity for single-agent runs as new metadata?
- Should the first version show lightweight inline charts (sparklines, mini bar charts), or full interactive charts? Leaning toward lightweight with CDN sparkline library.
- How should the autonomy score weight its components? Equal weighting, or should overnight output count more than first-pass success?
- Should event tracking be opt-in or always-on? Always-on is simpler and the overhead is minimal (appending to an array in an existing file write).

## Related

- Research:
- Feature: [feature-agent-cost-awareness.md](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-agent-cost-awareness.md) for adjacent analytics ideas, though this feature is explicitly about throughput and delivery statistics rather than cost.
