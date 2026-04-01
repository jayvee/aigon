# Implementation Log: Feature 206 - unified-feature-stats-one-source-throughout-lifecycle
Agent: cc

## Summary

Created a persistent `stats.json` record per feature that accumulates throughout the lifecycle and persists after close, so the Status tab always shows correct data regardless of whether the worktree still exists.

## Changes

### `lib/feature-status.js`
- Added `readStats()` / `writeStats()` helpers for `.aigon/workflows/features/{id}/stats.json`
- Updated `collectFeatureDeepStatus()` to read stats.json as primary data source
- For done features: session shows "Completed" with completedAt/duration instead of "Dead"
- For in-progress features: live git/tmux data overlays the persisted record
- Added `relativePath()` helper — spec/log/worktree paths now shown relative to repo root

### `lib/feature-close.js`
- Added `snapshotFinalStats()` — captures git stats (commits, files, lines) and telemetry cost data into stats.json before worktree deletion

### `lib/commands/feature.js`
- `feature-start`: initializes stats.json with startedAt, mode, agents
- `feature-close`: calls `snapshotFinalStats()` between telemetry and engine state transition (Phase 6.5)

### `lib/commands/misc.js`
- `agent-status`: updates `lastActivityAt` in stats.json on every status signal (including `reviewing` / `review-complete`, which return early after the review store update)

### `templates/dashboard/js/detail-tabs.js`
- `statusIndicator()` now accepts session object, renders "Completed" with green dot for done features
- Session section shows completedAt and duration for done features instead of tmux info

### `templates/dashboard/styles.css`
- Added `.status-completed` class (green dot, matching alive style)

## Decisions

- Stats file location: `.aigon/workflows/features/{id}/stats.json` — alongside snapshot.json and events.jsonl, part of the workflow-core directory structure
- Merge semantics: `writeStats()` merges new data into existing record (never overwrites), so multiple lifecycle points can contribute without clobbering each other
- Atomic writes: uses temp file + rename pattern (same as agent-status.js) to prevent corruption
- Cost data at close: re-reads telemetry files directly rather than relying on what recordCloseTelemetry computed, to ensure stats.json is self-contained
- Live overlay strategy: for in-progress features, live git data takes precedence only if it has commits (avoids showing stale stats record when worktree is active)

## Code Review

**Reviewed by**: cu (Cursor agent)
**Date**: 2026-04-01

### Findings
- `agent-status reviewing` / `review-complete` returned before the `lastActivityAt` stats update, so those signals did not match the spec (“every status signal”).

### Fixes Applied
- `fix(review): update stats lastActivityAt for review agent-status signals` — `lib/commands/misc.js`

### Notes
- `node -c` on touched modules and `npm test` (13 integration tests) pass after the fix.
- `stats.json` field names use `commitCount` (not the spec sketch’s `commits`); dashboard progress already expects `commitCount`.
- `lastActivityAt` is written but not yet read in the Status tab UI (future enhancement).
