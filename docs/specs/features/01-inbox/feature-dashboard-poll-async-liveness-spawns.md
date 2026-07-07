---
complexity: high
---

# Feature: dashboard-poll-async-liveness-spawns

## Summary
The dashboard status poll blocks the Node event loop for ~13s per cycle on the
`aigon` repo because per-feature card enrichment fires a storm of **synchronous
child-process spawns** (`git` via `execFileSync`, `tmux` via `spawnSync`) with no
event-loop yields between them. With ~20s poll cadence this produces a **~13–15s
window every cycle where all HTTP is starved** — `/api/health`, `/api/status`,
and `/` all time out — so from a browser the dashboard reads as "not responding."
The immediately-prior fix (commit `85677c678`) made the 531 *done* rows lean and
skipped their read-model reads, but it did **not** touch the synchronous spawns
per *active* feature, which are now the dominant cost. This feature removes the
synchronous-spawn stall from the poll path so the event loop stays responsive
during collection, without changing the collector's output shape.

### Diagnostic evidence (captured 2026-07-07)
- **CPU sample of the wedged server**: `node::SyncProcessRunner::Spawn` = 843/1546
  samples (≈55%), remainder in `node::fs::ReadFileUtf` / `uv__fs_work`. The block
  is synchronous shell-outs + synchronous file reads on the main thread, not JS
  compute.
- **Timing**: `[perf] poll summary total≈16.7s repos=14 top=[aigon:~13s, ...]`.
  Health probes: 1–3ms *between* polls, then `000`/timeout for ~13–15s *during*
  each poll, recovering the instant the poll completes. It oscillates; it is not
  a permanent hang (though under overlapping cold-start processes it degraded into
  100s+ blackouts — see Open Questions on launchd KeepAlive respawn).
- **Scale that tipped it over**: `.aigon/workflows/features` = 531 done / **67
  active** (25 inbox, 21 backlog, 20 paused, 1 spec-review). 17 features (620–636)
  were prioritised today plus ~15 `feature-*-arch-*` inbox specs — that growth
  pushed active-feature enrichment cost past the threshold where a poll's
  synchronous portion exceeds the poll interval's tolerance.

### Attributed hot spots (starting points, verify by profiling)
- `lib/dashboard-status-helpers.js`: `detectDefaultBranch` (2–3 `git` spawns:
  `symbolic-ref`, `show-ref`, `branch --show-current`), `worktreeHasImplementationCommits`
  (`git branch --show-current` + calls `detectDefaultBranch`), and the branch /
  `rev-list --count` (ahead) / `log -1 --pretty=%s` (subject) block (~lines 290–337).
  These run per active feature that has a worktree, ~5 `git` subprocesses each, all
  `execFileSync` (blocking). `detectDefaultBranch(repoPath)` appears to be recomputed
  per feature with the same `repoPath` — a per-repo-per-poll cache is an obvious win.
- `lib/worktree.js`: `tmuxSessionExists` → `runTmux(['has-session'])` (`spawnSync`)
  per autonomous-controller build. Note: `_getCachedTmuxList()` already caches the
  session list per poll — confirm nothing bypasses that cache.
- `lib/supervisor.js` `sweep()` / `sweepEntity`: the first cold-start full sweep
  across all entities is a second synchronous-spawn source that overlaps polls.
  The new poll↔sweep coordination (`waitUntilSweepIdle`, `setSweepSkipGuard`) means
  a sweep that blocks in a synchronous spawn also stalls the waiting poll.

## User Stories
- [ ] As an operator with the dashboard open, `/api/health` and `/api/status`
      stay responsive (sub-200ms) *while* a status poll is running, so the page
      never appears to hang.
- [ ] As an operator on a large repo (hundreds of features), the dashboard is
      usable on a cold `aigon server restart`, including through the first
      supervisor sweep, without multi-second blackouts.
- [ ] As a maintainer, the poll payload is byte-identical before and after this
      change — only its blocking behaviour changes.

## Acceptance Criteria
- [ ] During a full status poll of the `aigon` repo (67+ active features), the
      event loop is never blocked for more than a small bounded interval
      (target: **≤250ms contiguous**). Measure via an event-loop-lag probe (e.g.
      a repeating timer that records scheduling delay) captured across a poll.
- [ ] `/api/health` p99 latency **< 200ms** measured continuously across ≥3 full
      poll cycles on the `aigon` repo (contrast: current behaviour times out for
      ~13s/cycle). Add a repeatable measurement script under `scripts/` or a test.
- [ ] The `/api/status` feature-row payload is **deep-equal** to the pre-change
      output for a fixture repo containing a mix of active (in-progress with
      worktree, paused, backlog, inbox) and done features — no field added,
      dropped, or reordered. Lock with a regression test alongside
      `tests/integration/dashboard-perf-lean-done.test.js`.
- [ ] Features with **no live worktree and no live tmux session** (inbox, backlog,
      most paused) perform **zero** `git`/`tmux` subprocess spawns during poll
      enrichment (verify by counting spawns, e.g. stub/spy on the spawn helpers).
- [ ] `detectDefaultBranch` (and any other repo-invariant git query) is computed
      **at most once per repo per poll**, not once per feature.
- [ ] The fix holds under the supervisor's first cold-start full sweep — a fresh
      `aigon server restart` reaches a steady responsive state and stays there
      (no oscillating blackout), verified against the real registered repo set.
- [ ] `npm run test:iterate` passes; the new perf/parity tests pass under
      `npm run test:core`.

## Validation
```bash
npm run test:iterate
node --test tests/integration/dashboard-perf-lean-done.test.js
```

## Technical Approach
High-level, in preference order — the implementer should **profile first** to
attribute the ~13s precisely (git vs tmux vs fs) before choosing the mix:

1. **Eliminate avoidable spawns (cheapest, highest leverage).**
   - Cache repo-invariant results per collect pass: `detectDefaultBranch(repoPath)`
     memoised on a per-repo-per-poll key. Thread a small collect-scoped cache
     object (the collector already threads `repoContext`/`scanCtx`).
   - Gate the worktree-git enrichment (`worktreeHasImplementationCommits`,
     branch/ahead/subject) on cheap preconditions already known from the snapshot:
     only run it for features whose stage/mode implies a live worktree and only
     when the worktree dir exists. Inbox/backlog/paused rows with no worktree must
     short-circuit before any `git` call.
   - Confirm every tmux existence check reads the per-poll `_getCachedTmuxList()`
     cache; remove any path that spawns `tmux` per feature/agent.

2. **Make the remaining spawns non-blocking.** For spawns that genuinely must run
   per active feature, replace synchronous `execFileSync`/`spawnSync` on the poll
   path with awaited async `execFile`/`spawn` (promisified), collected with bounded
   concurrency (e.g. `p-limit`-style, small N) so the event loop interleaves HTTP
   handling between them. The collector's feature loop is already async-capable on
   the poll path (`scanWorkflowFeaturesForPoll` / `collectRepoStatusAsync`), so
   per-feature enrichment can become `await`-based. **Keep the synchronous
   `collectRepoStatus` path** (used by routes/tests) working — either share an
   async core or keep a sync fallback; do not regress the single-repo refresh path.

3. **Batch where the tool allows it.** Prefer one `git` invocation that returns
   multiple facts over several (e.g. resolve default branch once per repo; consider
   `git for-each-ref` / a single `git log`/`rev-list` form) rather than N spawns
   per worktree.

4. **Supervisor sweep**: apply the same "skip entities with no live session/worktree"
   gating so the cold-start first sweep is not a second synchronous-spawn storm,
   and ensure a spawn inside `sweepEntity` cannot indefinitely stall a poll waiting
   in `waitUntilSweepIdle` (bound the wait, or make sweep spawns async too).

**Invariant (load-bearing):** the read path output must not change. This is a
performance/scheduling change only. The existing write-path contract and the
lean-done invariants (F459/F469/F590) must be preserved. Add an
event-loop-lag assertion so future regressions self-report the same way F590's
slow-poll log line does.

## Dependencies
- Builds on commit `85677c678` (`fix(dashboard): stop status poll from starving
  the event loop`) — this feature completes what that fix started by removing the
  synchronous-spawn stall it left in place.

## Out of Scope
- Reducing the *number* of registered/polled repos or a dashboard "hide repo"
  UX (a separate operator-side lever; noted in the prior fix's review).
- Changing the poll cadence or the lean-done payload contract.
- Rearchitecting liveness into a persistent daemon/file-watch model (larger; can
  be a follow-up if async spawns prove insufficient).
- Any change to the collector's output shape or card fields.

## Open Questions
- **Profiling split**: how much of the 13s is `git` vs `tmux` vs `readFileSync`?
  The sample shows meaningful `fs::ReadFileUtf` too — if synchronous file reads
  (events/eval/review sidecars per feature) are a large share, they need the same
  async/batched treatment, not just the spawns.
- **launchd KeepAlive interaction**: `com.aigon.server` auto-respawns on kill, so
  a hard `kill -9` during debugging spawns a fresh cold-start process. Overlapping
  cold-start processes compound the storm into 100s+ blackouts. Should the service
  guard against overlapping starts (single-flight bind on the port before heavy
  work)? At minimum, document that `aigon server restart` is the only safe restart
  path and `kill` will respawn.
- Is bounded-concurrency async spawning enough at 67 active features, or is a
  per-worktree git-state cache with mtime invalidation required to hit the ≤250ms
  target?

## Related
- Prior work: commit `85677c678` (lean-done poll payload + poll/sweep coordination);
  F590 (lean done rows, bounded poll payload, slow-poll self-reporting);
  F459 / F469 (lean-done invariants).
- Hot-spot files: `lib/dashboard-status-collector.js`,
  `lib/dashboard-status-helpers.js`, `lib/worktree.js`, `lib/supervisor.js`.
