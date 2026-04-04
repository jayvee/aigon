# Feature: tiered-polling-hot-warm-cold-data-separation

## Summary

The dashboard server polls all 400+ features on every 10-second cycle, performing a `statSync()` on every done feature regardless of whether anything has changed. Done features are static by definition — once closed, they never change. This causes unbounded I/O growth as completed features accumulate. This feature introduces a three-tier polling model (hot / warm / cold) that eliminates ~95% of redundant I/O with a surgical change to `lib/dashboard-status-collector.js`. The API contract and frontend are unchanged.

---

## Current Architecture and Weaknesses

### How polling works today

The server runs `collectDashboardStatusData()` on a 10-second `setInterval`. For each registered repo it calls `collectFeatures()`, which:

1. `readdirSync()` on 5 spec directories (inbox, backlog, in-progress, in-evaluation, paused)
2. `listRecentDoneSpecFiles()` → `readdirSync()` on `05-done/` + **`statSync()` on every done file** to sort by mtime
3. `statSync()` on every snapshot file (mtime cache avoids re-parsing, but the stat still happens)
4. `readFileSync()` on every agent status file for active features
5. One tmux subprocess call per active agent (session liveness check)
6. Heartbeat `statSync()` per active agent

`collectResearch()` and `collectFeedback()` follow the same pattern.

### I/O cost per poll cycle (current)

| Operation | Count per poll | Notes |
|-----------|---------------|-------|
| `statSync()` on done feature files | **400+** and growing | Every done file, every 10s |
| `readdirSync()` on spec dirs | 10 | 5 dirs × 2 entity types |
| Snapshot `statSync()` + conditional re-read | ~N active features | mtime cache reduces parse, not stat |
| Agent status `readFileSync()` | ~N×P active agents | Necessary |
| Tmux subprocess spawns | ~N×P active agents | Necessary |
| Heartbeat `statSync()` | ~N×P active agents | Necessary |

**The pathological case:** 400 done features → 400 `statSync()` calls per 10s = **40 stat calls/second**, all returning identical results. This grows linearly with every shipped feature, forever.

### Why done features are included

The dashboard shows the 10 most recent done features in the pipeline view and a `doneTotal` count in stats. The server reads all done files to sort by mtime and slices the top 10. This is correct behaviour — the implementation is just not cached.

### Why this causes crashes

Poll cycles at ~200ms with 400 done features. As done-feature count grows, cycle time grows, memory pressure from JSON regeneration accumulates, and the process is eventually OOM-killed. The crash logs show clean cutoffs (no uncaught exception) consistent with a SIGKILL from the OS.

### Other weaknesses

- **Inbox/backlog polled at the same rate as in-progress** — these change only when a user runs a CLI command, yet they're re-read every 10s
- **No concept of data temperature** — a 6-month-old done feature costs the same to poll as one submitted 30 seconds ago
- **Full JSON regeneration every cycle** — `latestStatus` rebuilt from scratch even when nothing changed, creating GC pressure at ~100KB–2MB per cycle

---

## Solution: Tiered Polling (Quick Win)

Introduce three tiers with different collection strategies. The server merges all tiers into one `latestStatus` — **the API shape and frontend are completely unchanged**.

### Tier definitions

| Tier | Data | Strategy | Effective cost per poll |
|------|------|----------|------------------------|
| **Hot** | `03-in-progress`, `04-in-evaluation`, active agent sessions, tmux, heartbeats | Full re-collect every 10s | Unchanged — necessary |
| **Warm** | `02-backlog`, `01-inbox`, `06-paused` | 1 `statSync(dir)` per poll; re-read only if dir mtime changed | 3 stats → full read on change |
| **Cold** | `05-done`, done research, done feedback | 1 `statSync(dir)` per poll; serve from cache if unchanged | **1 stat replaces 400+** |

### Key insight: directory mtime as a cheap change signal

On macOS and Linux, a directory's mtime updates when a file is added, removed, or renamed within it. A `git merge` that moves a spec into `05-done` updates that directory's mtime, triggering a one-time cache invalidation. Between feature closings the mtime never changes.

```js
// Before: 400+ statSync() calls per poll
const doneSpecs = listRecentDoneSpecFiles(doneDir, pattern);

// After: 1 statSync() per poll
const cache = getTierCache(repoPath);
const dirMtime = safeStat(doneDir)?.mtimeMs ?? 0;
if (dirMtime !== cache.cold.featuresDirMtime) {
    cache.cold.featuresDirMtime = dirMtime;
    cache.cold.features = collectDoneFeatures(doneDir);  // full re-read, but rare
    cache.cold.doneTotal = cache.cold.features.length;
}
const doneSpecs = cache.cold.features;  // from cache
```

Same pattern applied to warm tier (backlog/inbox/paused dirs).

### Cache structure (per repo, module-level)

```js
// lib/dashboard-status-collector.js
const _tierCache = new Map();  // repoPath → TierCache

// TierCache shape:
{
    cold: {
        featuresDirMtime: 0,    features: [],  doneTotal: 0,
        researchDirMtime: 0,    research: [],
        feedbackDirMtime: 0,    feedback: [],
    },
    warm: {
        backlogMtime: 0,    backlog: [],
        inboxMtime: 0,      inbox: [],
        pausedMtime: 0,     paused: [],
    }
}
```

Cache is cleared on process restart. An optional `clearTierCache(repoPath)` export can be called by `aigon server restart` if needed (not strictly required — restart already resets module state).

`_snapshotCache` (already present in the module) uses an identical mtime pattern — the new tier cache follows the same established idiom.

---

## User Stories

- [ ] As a user, the dashboard stays responsive and doesn't OOM-crash as the project accumulates hundreds of done features
- [ ] As a user, closing a feature still appears in the dashboard within one poll cycle (cache invalidation is correct)
- [ ] As a developer, the poll cycle log line shows elapsed time dropping from ~200ms to under 50ms on large repos

## Acceptance Criteria

- [ ] `05-done` directory is `statSync()`d once per poll cycle (1 call), not once per done file
- [ ] Done features list is served from cache when `05-done` mtime is unchanged
- [ ] Cache is correctly invalidated when a feature moves to `05-done` (directory mtime changes)
- [ ] `doneTotal` count remains accurate
- [ ] `02-backlog`, `01-inbox`, `06-paused` follow same pattern (1 dirstat per poll, re-read only if changed)
- [ ] Hot tier (in-progress, evaluating, tmux, heartbeats) is unchanged
- [ ] Poll cycle time with 400+ done features drops significantly (target: under 50ms)
- [ ] API response shape is identical — no frontend changes required
- [ ] Cache is per-repo (multi-repo setups work correctly)
- [ ] Server restart clears all caches (no stale data)
- [ ] End-to-end: close a feature → it appears in dashboard within one poll cycle

## Validation

```bash
node -c lib/dashboard-status-collector.js
node -c lib/dashboard-server.js
```

## Technical Approach

All changes confined to `lib/dashboard-status-collector.js`:

1. Add module-level `const _tierCache = new Map()` keyed by `repoPath`
2. Add `function getTierCache(repoPath)` — returns or initialises a cache entry
3. Add `function safeStat(p)` — `statSync` wrapped in try/catch, returns `null` on error
4. Extract `collectDoneFeatures(doneDir, pattern)` as a pure function (currently inlined in `listRecentDoneSpecFiles`)
5. In `collectFeatures()`, replace the `listRecentDoneSpecFiles()` call with the dir-mtime cache check (see Technical Approach above)
6. Apply same pattern to `collectResearch()` done dir and `collectFeedback()` done dir
7. Apply warm-tier pattern to backlog/inbox/paused dirs in `collectFeatures()`
8. Export `clearTierCache(repoPath)` for completeness (not strictly needed)

`listRecentDoneSpecFiles()` can be retained as an internal helper but its `statSync` loop should only be called from inside the cold-tier cache miss path.

## Dependencies

- None. Self-contained change in `lib/dashboard-status-collector.js`.

## Out of Scope

- Option B (filesystem watchers / chokidar) — separate feature, higher complexity, macOS reliability concerns
- Option C (SSE push model) — separate feature, requires frontend changes
- Changing the 10s poll interval
- Caching snapshot reads beyond the existing `_snapshotCache` behaviour
- Reducing tmux subprocess calls (separate optimisation, affects supervisor module)

## Open Questions

- Should `clearTierCache` be wired into `aigon server restart` explicitly, or is process restart sufficient? (Proposed: process restart is sufficient — no persistent cache storage)

## Related

- Research: n/a
- Polling alternatives: Option B (fs-watch event-driven) and Option C (SSE push model) are documented in the architecture discussion but not implemented here
- Crash context: dashboard OOM crashes correlate with growing done-feature I/O count; this feature directly addresses the root cause
