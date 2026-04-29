# Research Findings: dashboard perf and state architecture

**Agent:** Codex (cx)
**Research ID:** 47
**Date:** 2026-04-30

---

## Key Findings

### A. Where the 2.5s actually goes (codebase profile)

I read `lib/dashboard-status-collector.js`, `lib/dashboard-server.js`, `lib/workflow-read-model.js`, and `lib/proxy.js` end-to-end. The 2.5s floor is **not** one fat call — it's the cumulative cost of an unparallelised loop over hundreds of features doing un-mtime-gated reads. The "no surgical strike left" hypothesis from the spec is **disprovable**. There is meaningful low-risk headroom.

**Per-poll structure (`pollStatus` → `collectRepoStatus`):**

1. Repos collected **sequentially** via `.forEach()` (`dashboard-status-collector.js:1385`). Repos are independent — there is no semantic reason for serial iteration. Wrapping in `Promise.all` collapses wall time toward `max(per-repo)` instead of `sum(per-repo)`.

2. **`parseCaddyRoutes()`** is called for every repo on every poll (`dashboard-status-collector.js:1301` → `proxy.js:202`). Single Caddyfile read+parse per repo per tick, with no mtime cache. The Caddyfile changes only on dev-server lifecycle events.

3. **Per-feature reads** in `collectFeatures` (lines 621–991) for each of ~667 features:
   - `getFeatureDashboardState()` reads snapshot JSON + filtered events. F460 dedups the *second* call within the same poll (passes `baseState`); it does **not** dedup across polls. Same snapshot is re-read every 20s even when nothing changed.
   - Per-agent status file (`feature-N-AGENTID.json`) read unconditionally per agent (line 533).
   - `readFeatureEvalState`, `readFeatureAutoState`, `readSpecReviewSessions` called per feature unconditionally regardless of stage. F344 turned `applySpecReviewFromSnapshots` into a no-op shim but the per-feature spec-review session read remains.

4. **Per-research reads** in `collectResearch` (lines 998–1240): no F460-style dedup at all (only one `getResearchDashboardState()` call per item, vs. two for features), AND active research has **no mtime gate** — every active research dir is re-listed every poll even if untouched. `research-N-AGENTID.json` read unconditionally.

5. **Feedback** (`collectFeedback`, lines 1242–1286): full re-enumeration every poll; reconciliation can trigger a *second* `collectFeedbackItems()`. `feedbackDoneTotal` is computed but **never rendered** — dead work per poll.

6. **Response payload**: `/api/status` returns a **full snapshot** every poll. No deltas, no ETag, no fingerprint-based 304. F454 added a *frontend* fingerprint (skip render if unchanged) but the wire payload itself is still a fat object every cycle.

7. **Active vs idle cadence**: F460 set 20s active, 60s idle. There's no adaptive throttling (e.g. when no `events.jsonl` append in N ticks, slow further).

What F454/F459/F460 *did* address: async quota scan moved post-status, second snapshot read deduped within a single poll, frontend fingerprint to skip render, cadence halved. What they **didn't** address: cross-poll snapshot caching, parallel repo collection, Caddy route caching, dead computation, and full-snapshot payload semantics.

### B. Transport options (push vs pull)

Citation-backed comparison on the table:

| Option | p95 (warm) | Complexity (1-5) | Local-failure mode |
|---|---|---|---|
| Long-polling (tuned) | 150–450ms | 1 | Reconnect cost dominates |
| **SSE** | 5–20ms LAN | 2 | Proxy buffering — N/A on loopback |
| WebSockets | ~1 RTT | 3 | Stateful; needs reconnect glue |
| FS watcher (chokidar) → push | 5–50ms FSEvents | 2 | Rename storms; macOS FSEvents instance limit |
| Append-only event-log tail (`events.jsonl`) | 1–10ms | 2–3 | Truncation/rotation handling |
| Replicache/Automerge CRDT | <50ms (Linear) | 5 | Schema migrations harder; "distributed state cost" |
| Hybrid: push-invalidate + pull-content (SWR shape) | invalidate ping ~5ms, refetch 20–100ms | 3 | Invalidation key derivation |

**The relevant insight for Aigon:** the engine already writes `events.jsonl`. The Write-path Contract in CLAUDE.md is essentially "every state mutation goes through that log." Tailing the log is therefore not a new source of truth — it's reading from the one we already have. SSE on loopback dodges every documented SSE failure mode (proxy buffering, HTTP/1.1 origin cap, idle-proxy timeouts). CRDTs solve a problem Aigon doesn't have (concurrent offline edits — git already merges).

**Linear-style local-first** (Replicache/Automerge/IndexedDB) is the conventional reference architecture but is **the wrong reference class for Aigon today**. Linear's complexity is justified by multi-tenant collaboration with offline edits; Aigon is single-user with git as the merge layer.

### C. State backend options

Hard numbers (sourced):

- **Filesystem (current)**: SQLite is 35% faster than direct FS reads on Android, 2x on macOS, 10x on Windows for 100k blob workloads (sqlite.org/fasterthanfs). APFS `readdir` takes a global kernel lock that serialises parallel reads (Tempel). HTree on ext4 helps past 32k entries.
- **SQLite (WAL)**: Concurrent readers + one writer; `BEGIN IMMEDIATE` + busy-timeout handles multi-process CLI fine; "database is locked" only fires if a write txn is held across user think-time. Doesn't work over network filesystems (irrelevant locally). Litestream gives 11-nines durability for ~$1/mo.
- **DuckDB**: 10-100x faster on aggregations, but 1-2 orders of magnitude **slower** on indexed point lookups. Wrong choice as primary; right choice as analytics adjunct.
- **Embedded KV (LMDB/RocksDB/BoltDB/sled)**: Sled itself documents instability ("APIs and on-disk format changing rapidly"). All KV stores require building a query layer for kanban-shape joins. Not worth the build vs SQLite.
- **Hosted (GitHub Issues / Linear / Notion)**: Aigon's read pattern (~245k reads/min at 7 repos × 700 features × 20s tick) exceeds every hosted rate limit immediately. Plus offline breaks. Plus lock-in. Rate-limit table:

| | Limit | Source |
|---|---|---|
| GitHub REST | 5,000 req/hr per PAT | docs.github.com/rate-limits |
| Linear | 250k complexity-pts/hr per user | developers.linear.app |
| Notion | ~3 req/sec, 2,700/15min | developers.notion.com/request-limits |

**Hybrid (markdown specs in FS + derived state in SQLite)** is the tested pattern. Obsidian's `obsidian-index-service`, Logseq DB-mode, Joplin, Fossil all do shapes of this. Joplin keeps notes+settings+cache in SQLite per-device, exports flat files for sync. Fossil bundles tickets/wiki/code in **one self-contained SQLite file** per project — the closest topological match to Aigon.

### D. Comparable tool lessons

The closest analogues are **Fossil SCM** (single-user developer tool, all project state in one SQLite, optional server) and **lazygit** (local dashboard over filesystem state, polling-vs-watcher tradeoff).

The single biggest cross-tool lesson — read **Taskwarrior 3.0 + lazygit pending refactor** together:

- **Taskwarrior 3.0**: moved from text files to SQLite — got **25× slower** at 744 tasks because the access pattern stayed N+1 (>160k syscalls). SQLite was fine; the per-task query was the bottleneck (issue #3329).
- **Lazygit**: massive CPU win comes from replacing blanket `git status`-every-10s polling with **fsnotify-routed targeted refreshes** scoped per pane (`.git/refs/heads/` → branches pane only). Storage didn't change.

**The bottleneck is the access pattern, not the storage engine.** Replacing FS with SQLite without batching reads would slow Aigon down. Replacing polling with fsnotify+SSE without changing storage would speed it up dramatically. This sequencing matters.

Also notable: lazygit polls `git status` at 10s and `git fetch` at 60s **regardless of changes** — exactly Aigon's current shape. Its proposed fix is the same shape this research recommends.

### Synthesis

The 2.5s poll floor has multiple compounding causes; no single change closes the entire gap, but a ranked punch list of small, low-risk changes can plausibly drop poll p95 below 500ms while preserving all current behaviour. Beyond that floor lies the architectural shift: **an event-driven invalidation channel over the existing `events.jsonl` write log + a derived-state SQLite cache**. That move sequence is monotone — every quick win below also makes the structural move easier, not harder.

## Sources

**Codebase (read directly):**
- `lib/dashboard-status-collector.js` — sequential `.forEach()` at line 1385, sub-collector call sites
- `lib/dashboard-server.js` — `pollStatus()`, quota scan
- `lib/workflow-read-model.js` — `getFeatureDashboardState`, F460 dedup site
- `lib/proxy.js:202` — `parseCaddyRoutes()`

**Transport / push:**
- https://ably.com/blog/websockets-vs-long-polling
- https://dev.to/haraf/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-5ep8
- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- https://html.spec.whatwg.org/multipage/server-sent-events.html
- https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie
- https://jvns.ca/blog/2021/01/12/day-36--server-sent-events-are-cool--and-a-fun-bug/
- https://github.com/paulmillr/chokidar
- https://github.com/lucagrulla/node-tail
- https://www.fujimon.com/blog/linear-sync-engine
- https://github.com/wzhudev/reverse-linear-sync-engine
- https://replicache.dev/
- https://dev.to/isaachagoel/are-sync-engines-the-future-of-web-applications-1bbi
- https://web.dev/articles/stale-while-revalidate

**State backends:**
- https://sqlite.org/fasterthanfs.html
- https://sqlite.org/wal.html
- https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/
- http://blog.tempel.org/2019/04/dir-read-performance.html
- https://fossil-scm.org/home/technote/be8f2f3447ef2ea3344f8058b6733aa08c08336f
- https://github.com/GothenburgBitFactory/taskwarrior/issues/3329
- https://hypermode.com/blog/badger-lmdb-boltdb/
- https://www.getgalaxy.io/learn/glossary/duckdb-vs-sqlite-databases
- https://github.com/pmmvr/obsidian-index-service
- https://joplinapp.org/help/dev/spec/architecture/
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://developers.linear.app/docs/graphql/working-with-the-graphql-api/rate-limiting
- https://developers.notion.com/reference/request-limits
- https://litestream.io/
- https://airbyte.com/data-engineering-resources/sqlite-vs-postgresql

**Comparable tools:**
- https://www.atlassian.com/blog/trello/the-trello-tech-stack
- https://www.atlassian.com/blog/atlassian-engineering/how-we-unlocked-performance-at-scale-with-jira-platform
- https://www.notion.com/blog/how-we-made-notion-available-offline
- https://plane.so/blog/introducing-plane-simple-extensible-open-source-project-management-tool
- https://taskwarrior.org/docs/upgrade-3/
- https://fossil-scm.org/home/doc/tip/www/tech_overview.wiki
- https://github.com/jesseduffield/lazygit/issues/5278
- https://forum.obsidian.md/t/indexing-large-number-of-files/47397
- https://deepwiki.com/logseq/logseq

## Recommendation

### (a) Short-term punch list (current architecture) — ranked by ROI

Each item is small, ships in 1–2 weeks, preserves all current behaviour, and (critically) **does not foreclose** the longer-term direction below. Estimates are best-guess deltas at the user's scale (7 repos / 667 features); each should be measured before committing.

1. **Parallelise the repo loop.** `Promise.all` across repos in `collectRepoStatus` (`dashboard-status-collector.js:1385`). Each repo's collection is independent. Expected: drops poll p95 by roughly `(repos − 1)/repos × per-repo cost`. At 7 repos that's a multiple-second tier reduction without changing semantics.
   - File: `lib/dashboard-status-collector.js`
   - Implementation sketch: convert `.forEach()` to `await Promise.all(repos.map(async (r) => …))`.
   - Risk: shared state writes during collection — audit any module-level mutation in sub-collectors first.

2. **Add cross-poll snapshot cache keyed by mtime.** Today F460 dedups the second `getFeatureDashboardState()` call within one poll; extend to dedup across polls. If `feature-N.json` snapshot mtime + per-agent status mtimes haven't changed, return the previous tick's `baseState`.
   - File: `lib/workflow-read-model.js` (introduce a per-feature memo keyed by `{snapshotMtime, eventsMtime, agentStatusMtimes}`)
   - Expected: at 667 features and a low mutation rate, ~99% of features skip JSON parse + events filter every tick.

3. **Add F460-style dedup to `collectResearch`.** Research collector currently has no per-tick or cross-poll caching. Mirror the feature-side optimisations.
   - File: `lib/dashboard-status-collector.js:998–1240`

4. **Cache `parseCaddyRoutes` behind Caddyfile mtime.** One read+parse per poll per repo today; Caddyfile changes only on dev-server lifecycle events.
   - File: `lib/proxy.js`

5. **Skip per-feature `readSpecReviewSessions`/`readFeatureEvalState`/`readFeatureAutoState` for done-stage features.** F344 left these called unconditionally. Done features can't change these; gate by stage.
   - File: `lib/dashboard-status-collector.js:551,560,566`

6. **Drop dead computation: `feedbackDoneTotal`.** Computed every poll; never rendered. Delete.
   - File: `lib/dashboard-status-collector.js:1284`

7. **Add ETag / 304 to `/api/status`.** Server hashes the response payload and returns `304 Not Modified` if the client's `If-None-Match` matches. Server still does the work but skips the over-the-wire payload + frontend re-render path.
   - File: `lib/dashboard-server.js` (status route)
   - Expected: significant payload reduction in low-mutation periods; orthogonal to #2.

8. **Move slow-tier work off the 20s tick.** Caddy routes parse, npm-update check, GitHub remote detection — none of these need 20s freshness. Promote to a 5-minute side-tier, keep the cached value on the snapshot.
   - File: `lib/dashboard-server.js`

9. **Adaptive cadence.** When `events.jsonl` hasn't appended in N ticks, slow active poll from 20s → 60s; reset on next append. Trivially safe with the structural move below; even without it, mtime-watching `events.jsonl` is a 5-line change.
   - File: `lib/dashboard-server.js`

10. **Mtime-gate active research stage listings.** Active research dirs re-listed every tick today; gate behind dir mtime.
    - File: `lib/dashboard-status-collector.js:1012-1018`

Highest-ROI single change is #1 (parallelise repos). Combined, items 1–6 plausibly drop poll p95 below 500ms; item 7 plus the structural move below get to <50ms perceived.

### (b) Longer-term structural direction

**Recommended destination:** `events.jsonl` becomes the source of truth for *change*. A single chokidar watcher over `events.jsonl` (per repo) drives an in-process EventEmitter. The dashboard subscribes via SSE; on every appended event the server emits a tiny `{type:'invalidate', keys:[…]}` ping; the dashboard refetches only the affected slice via existing REST routes. Polling stays as the safety-net fallback (e.g. 5-minute cadence) for transport failure.

In parallel: derived state (kanban positions, snapshots, agent statuses, feedback rows) migrates to a single `.aigon/state.db` (SQLite, WAL). Markdown specs stay in git — diffable, mergeable, portable. Spec is still authoritative; SQLite is a deterministic projection rebuildable from FS via `aigon doctor --fix`. This is exactly the Joplin/Logseq-DB/Obsidian-index pattern.

The two halves compose. Together they enable:
- <50ms perceived latency for any UI action that's downstream of an event
- Multiple dashboards subscribing to one server (door for the "central server / multiple dashboards" capability the user flagged)
- Bidirectional adapter shape: a `StateBackend` interface (read/apply/subscribe) lets the same client UI talk to SQLite today, Postgres tomorrow, GitHub Issues / Linear as a mirror later — without callsite changes
- Closes the "Write-path Contract" bug class (F294, b1db12d3 incident): one SQL transaction replaces N rename-dance steps

**Contingencies that would change this:**
- If an Aigon Pro/cloud tier ships first, the destination shifts to authoritative server + Replicache-shape sync. That's a Linear-class architecture; the SQLite hybrid above is its natural local cache, so the move composes.
- If single-user-tier scale never crosses 5k features, the FS-only path with quick wins #1–10 may be sufficient indefinitely. The SQLite migration is then optional optimisation, not necessity.

**What I am NOT recommending:**
- Replicache/CRDTs as the primary path (overkill for single-user; git is the merge layer)
- Hosted SaaS as primary state backend (rate limits + offline-break + lock-in, all three; viable only as mirrors)
- Postgres as primary (operational cost not justified until multi-writer)
- Embedded KV (LMDB/sled) (would force a custom query layer)
- DuckDB as primary (wrong access pattern; viable as analytics adjunct via `ATTACH`)

### (c) Composition (short-term × long-term)

Every short-term item below preserves or improves long-term optionality:

| # | Change | Long-term effect |
|---|---|---|
| 1 | Parallelise repos | Improves: same shape works whether each repo loads from FS or SQLite |
| 2 | Cross-poll snapshot cache | Improves: this *is* the prototype of the SQLite-backed in-memory index |
| 3 | Research dedup | Improves: removes a divergent code path, easier to migrate uniformly |
| 4 | Caddy routes mtime cache | Neutral: orthogonal |
| 5 | Stage-gate per-feature reads | Improves: identifies and removes dead reads, fewer call sites to migrate |
| 6 | Drop `feedbackDoneTotal` | Neutral: dead code removal |
| 7 | ETag / 304 on `/api/status` | Improves: ETag becomes the natural fingerprint key for SSE invalidation |
| 8 | Move slow-tier off 20s tick | Improves: tier separation is what the structural move enforces |
| 9 | Adaptive cadence on `events.jsonl` mtime | Improves: this is half of the chokidar-over-events.jsonl shape; the watcher just replaces the mtime poll |
| 10 | Mtime-gate active research listings | Neutral: same shape post-migration |

There is no foreclosure. Every item is on the path.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| dashboard-parallel-repo-collection | Replace sequential `.forEach()` in `collectRepoStatus` with `Promise.all` across repos | high | none |
| dashboard-cross-poll-snapshot-cache | Memoise `getFeatureDashboardState` results keyed by snapshot+events+agent-status mtimes | high | none |
| dashboard-research-collector-dedup | Mirror F460-style dedup + mtime gates for `collectResearch` | medium | none |
| dashboard-caddy-routes-mtime-cache | Cache `parseCaddyRoutes` output behind Caddyfile mtime | medium | none |
| dashboard-stage-gate-per-feature-sidecars | Skip `readSpecReviewSessions`/`readFeatureEvalState`/`readFeatureAutoState` for done-stage features | medium | none |
| dashboard-drop-dead-feedback-total | Remove unused `feedbackDoneTotal` computation | low | none |
| dashboard-status-etag-304 | Add ETag + `If-None-Match`/304 to `/api/status` | high | none |
| dashboard-slow-tier-side-collector | Move Caddy parse, npm update check, GitHub remote detection to a 5-minute side-tier | medium | none |
| dashboard-adaptive-cadence-on-events | Slow active poll when `events.jsonl` mtime hasn't changed in N ticks | medium | none |
| dashboard-mtime-gate-active-research | Gate active-stage research listings behind dir mtime | low | none |
| dashboard-sse-invalidation-channel | Add SSE endpoint emitting `{type:'invalidate', keys:[…]}` pings driven by chokidar over `events.jsonl` | high | dashboard-status-etag-304 |
| state-backend-adapter-interface | Introduce `StateBackend` abstraction (read/apply/subscribe) over current FS implementation | high | none |
| derived-state-sqlite-projection | Migrate kanban positions, snapshots, agent statuses, feedback rows to `.aigon/state.db` (SQLite WAL); keep specs in FS | high | state-backend-adapter-interface |
| doctor-fix-rebuild-sqlite-from-fs | `aigon doctor --fix` rebuilds `state.db` deterministically from FS specs | medium | derived-state-sqlite-projection |
| dashboard-targeted-refetch-on-invalidate | Frontend subscribes to SSE; on invalidate ping, refetches only affected slice via REST | medium | dashboard-sse-invalidation-channel |
