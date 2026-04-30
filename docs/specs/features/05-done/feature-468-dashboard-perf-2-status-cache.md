---
complexity: high
research: 47
set: dashboard-perf
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-30T00:20:17.993Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-perf-2-status-cache

## Summary

Build a per-repo visible spec index once per `collectRepoStatus` pass and route every consumer through it instead of rescanning stage directories per entity ID. Cache the index across polls behind stage-directory mtime + per-file mtime checks. Also cache `snapshot.json` reads behind per-file mtime. Add a watchdog that periodically asserts the cached index matches a cold rebuild — this is the trust mechanism that justifies the cache existing at all.

Profiled impact (cc/cx findings): warm `readdirSync` from ~21,000 to ~50, `readFileSync` from ~5,700 (with duplicates) to ~882 (each file once), wall-time from ~1,000 ms to ~300–400 ms.

## User Stories
- [ ] As a dashboard user, my poll cycle completes in under 500 ms warm
- [ ] As an operator, I can see in logs whether the cache ever diverges from a cold scan
- [ ] As an operator, I can disable the cache via env var to fall back to today's behaviour if the watchdog ever fires

## Acceptance Criteria
- [ ] One canonical `{stage, id, slug, fullPath, setSlug, dependsOn, frontmatterRaw}` index built per repo per pass
- [ ] `resolveFeatureSpec`, `scanFeatureSets`, `summarizeSets`, `getSetMembersSorted`, `getSetDependencyEdges`, `buildFeatureIndex`, `buildDependencyGraph` all read from the index — none rescan stage dirs
- [ ] Cross-poll reuse gated on stage-dir mtime + per-file mtime (per-file stat is the tiebreaker for in-place frontmatter edits)
- [ ] `readFeatureSnapshotSync` / `readWorkflowSnapshotSync` cache behind per-file mtime
- [ ] Watchdog: every Nth poll (default N=10), do a cold rebuild and `deepEqual` against the cached index. Log loudly on divergence with the diff
- [ ] Env var `AIGON_DISABLE_STATUS_CACHE=1` short-circuits the cache (every poll is cold)
- [ ] Warm `/api/status` poll p95 < 500 ms at user's current scale (7 repos / 670 features / 39 research)
- [ ] No regression in dashboard correctness (specs in correct stage, set membership accurate, dependency graph accurate)

## Technical Approach

New module `lib/dashboard-spec-index.js`. Per-call entry point: `getRepoSpecIndex(repoPath, opts)`. Internal Map keyed by `repoPath`. On call:
1. `stat` each of the 6 stage dirs; compare against cached mtimes.
2. If any dir mtime moved, scan that stage's files with `readdirSync` and read any whose per-file mtime moved.
3. Otherwise return the cached index.
4. Watchdog counter: every Nth call, force a full cold scan and assert.

Refactor the seven consumer functions (`resolveFeatureSpec`, `scanFeatureSets`, `summarizeSets`, `getSetMembersSorted`, `getSetDependencyEdges`, `buildFeatureIndex`, `buildDependencyGraph`) to accept an optional pre-built index argument; have `collectRepoStatus` pass the index down. Keep their existing signatures working for CLI call sites that don't have an index handy.

Snapshot cache: `lib/workflow-read-model.js readFeatureSnapshotSync` wraps its `readFileSync` with a per-file mtime gate.

**Drift defenses (the core of this feature's trust story):**
- Per-file mtime check, not just dir-mtime, kills the in-place-frontmatter-edit drift hole
- Watchdog converts "we hope mtime invalidation is reliable" into "we'd know within minutes if it isn't"
- Process-only cache means daemon restart fully resets — no persistent drift surface
- Env-var kill switch for fast rollback if production behaves unexpectedly

## Dependencies
-

## Out of Scope
- Persisting the index to disk or SQLite (that's the medium-term `dashboard-read-model-facade` work)
- TTL caches for non-workflow data (covered by `dashboard-perf-1-cold-probe-ttl`)
- Server-side fingerprint short-circuit for `/api/status` payload (deferred — depends on this feature earning trust first)

## Open Questions
- Watchdog cadence: every 10 polls reasonable, or should it be time-based (every 5 min)?
- Should watchdog divergence trigger automatic cache disable for the rest of the process, or just log?

## Related
- Research: #47 dashboard-perf-and-state-architecture
- Set: dashboard-perf
- Builds on: F454, F459 (existing mtime-gated caches for inbox/backlog/paused/done)
