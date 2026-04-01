# Feature: Unified Feature Stats — One Source Throughout Lifecycle

## Summary

Feature stats are currently pulled from different sources depending on lifecycle stage: live worktree git log (implementing), transcript files (cost), spec file checkboxes (criteria), tmux session (alive/dead). When a feature completes, the worktree is deleted and most stats become zero or "n/a." The Status tab shows "Dead" with a red dot for completed features, zero commits, zero files — all wrong. This feature creates a single stats record that accumulates throughout the lifecycle and persists after close, so the Status tab always shows the correct picture.

## The Problem

Current data sources and what breaks:

| Stat | Source (implementing) | Source (done) | Problem |
|------|----------------------|---------------|---------|
| Session alive | tmux check | tmux check | Shows "Dead" for done — alarming, should say "Completed" |
| Commits | `git log` in worktree | worktree deleted | Shows 0 |
| Files/lines | `git diff` in worktree | worktree deleted | Shows 0 |
| Cost | transcript telemetry file | transcript file | Sometimes works, sometimes 0 |
| Model | transcript or fallback | fallback "cc-cli" | Wrong |
| Criteria | spec file `- [ ]` count | spec file | Usually 0 — agents don't check boxes |
| Paths | absolute paths | absolute paths | Should be relative |

## User Stories

- [ ] As a user, I want the Status tab to show correct stats for completed features — how many commits, how much it cost, how long it took
- [ ] As a user, I want the Status tab to say "Completed" not "Dead" when a feature is done
- [ ] As a developer, I don't want to think about which data source to use — one record, always correct

## Acceptance Criteria

### Single stats record per feature
- [ ] Stats are accumulated in `.aigon/workflows/features/{id}/stats.json` throughout the feature lifecycle
- [ ] `feature-start` initialises the stats record with `startedAt`, mode, agents
- [ ] Agent heartbeat/status signals update `lastActivityAt`
- [ ] `feature-close` writes final stats: total commits, files changed, lines added/removed, duration, cost, model — captured from git and telemetry at close time (before worktree is deleted)
- [ ] The stats file persists after close — it's never deleted

### Status tab reads from stats record
- [ ] `collectFeatureDeepStatus()` reads from `stats.json` as the primary source
- [ ] Live tmux/worktree data supplements (not replaces) the stats record for in-progress features
- [ ] For done features: session section shows "Completed" with a green checkmark, duration, and completion time — not "Dead"
- [ ] Paths are shown relative to the repo root, not absolute

### No lifecycle-dependent data sources
- [ ] The Status tab renders the same way regardless of lifecycle stage — it reads one record
- [ ] No `if (isDone) { readFromLog } else { readFromWorktree }` branching

## Validation

```bash
node -c lib/feature-status.js
node -c lib/feature-close.js

# Stats file exists after close
# (test with a completed feature)
```

## Technical Approach

### 1. Stats record: `.aigon/workflows/features/{id}/stats.json`

```json
{
  "startedAt": "2026-04-01T10:00:00Z",
  "completedAt": "2026-04-01T10:15:00Z",
  "durationMs": 900000,
  "mode": "solo_worktree",
  "agents": ["cc"],
  "commits": 3,
  "filesChanged": 5,
  "linesAdded": 120,
  "linesRemoved": 15,
  "lastCommitMessage": "feat: add dark mode toggle",
  "cost": {
    "inputTokens": 145000,
    "outputTokens": 12000,
    "estimatedUsd": 4.20,
    "model": "opus",
    "sessions": 1
  }
}
```

### 2. Write stats at key lifecycle points

- **`feature-start`**: create `stats.json` with `startedAt`, mode, agents
- **`feature-close`** (before worktree deletion): snapshot git stats from the worktree/branch (`git log --stat`), capture telemetry, write to `stats.json`
- **Heartbeat/signals**: update `lastActivityAt` (lightweight, no git calls)

### 3. `collectFeatureDeepStatus()` reads stats.json

Replace the current "gather from 5 different sources" approach with:
1. Read `stats.json`
2. If feature is in-progress AND worktree exists, overlay live session data (tmux alive, current commit count)
3. Return unified object

### Key files:
- `lib/feature-status.js` — read from stats.json, simplify
- `lib/feature-close.js` — write final stats before worktree deletion
- `lib/commands/feature.js` — write initial stats on start
- `templates/dashboard/js/detail-tabs.js` — render "Completed" for done features, relative paths

## Dependencies

- None

## Out of Scope

- Historical stats tracking across multiple features (analytics/trends)
- Changing what stats are collected (just fixing where they're stored)
- Cost tracking accuracy (separate concern)

## Related

- Feature 199: Feature Status Panel (introduced the Status tab — this fixes its data layer)
