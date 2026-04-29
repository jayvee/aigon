# Research Findings: dashboard perf and state architecture

**Agent:** Codex (cx)
**Research ID:** 47
**Date:** 2026-04-30

---

## Key Findings

### Current-state measurements

I profiled `lib/dashboard-status-collector.js:collectRepoStatus()` against the configured 7 conductor repos from `~/.aigon/config.json`, with filesystem write methods disabled in-process so the pass could not mutate `.aigon/state` or specs. The first read-only pass took **1,834.5 ms** total, with the local `aigon` repo dominating at **1,365.1 ms** for **422 features / 21 research / 8 feedback**. Across all repos that pass made **7,872 `readFileSync` calls**, **21,115 `readdirSync` calls**, **1,817 `statSync` calls**, and **8 `execSync` calls**.

The biggest surprise was not stat/read cost but repeated directory enumeration. A path-level pass showed `~/src/aigon/docs/specs/features/{01-inbox,02-backlog,03-in-progress,04-in-evaluation,05-done,06-paused}` each being read **2,105 times** in one status collection. The code explains it:

- `collectFeatures()` iterates every workflow feature id, then `resolveFeatureIdentity()` calls `featureSpecResolver.resolveFeatureSpec()`.
- `resolveFeatureSpec()` calls `listVisibleEntitySpecs()`, which scans all 6 visible stage dirs for each entity id.
- Set cards also rescan: `collectFeatures()` calls `featureSets.scanFeatureSets()` once, then `featureSets.summarizeSets()` rescans, and every set card calls `getSetMembersSorted()` and `getSetDependencyEdges()`, both of which rescan and rebuild dependency data.
- Backlog dependency annotation calls `checkUnmetDependencies()` feature-by-feature; when a spec has dependencies it rebuilds the feature index inside the hot collector path.

So the "many small synchronous reads" hypothesis is directionally right, but there are still surgical wins. The highest-ROI one is to build a per-repo **visible spec index** once per poll/cache invalidation and share it across identity resolution, set summaries, set cards, dependency checks, and done/recent rows.

### Short-term wins still available

1. **Build one repo-visible spec index per repo pass.** Replace per-feature `featureSpecResolver` stage scans with a single index keyed by `{entityType,id,slug,path}`. This should remove thousands of `readdirSync` calls from the largest repo. Expected impact: drop warm poll p95 from ~2.5 s toward **700-1,000 ms** at current scale.

2. **Memoise set/dependency scans inside one collector pass.** `featureSets.scanFeatureSets()`, `buildFeatureIndex()`, and `buildDependencyGraph()` are deterministic for a repo snapshot. Compute once in `collectFeatures()` and pass a derived context to set-card and blocked-by helpers. Expected impact: smaller than #1 but low-risk; likely **100-300 ms** on the large repo and removes quadratic growth as sets expand.

3. **Split `collectRepoStatus()` into hot/warm/cold tiers with explicit TTLs.** Today `parseCaddyRoutes()`, `getDevServerState()` port probes, `detectDefaultBranch()`, GitHub remote detection, profile/config reads, feedback reconciliation, and schedule decoration live in the same status pass. Caddy/dev-server and remote/config checks can tolerate 60-300 s TTLs. Expected impact depends on active dev-server count; it also reduces event-loop variance.

4. **Add server-side status fingerprints/deltas.** F454 added frontend fingerprint-gated rendering, but `/api/status` still serializes and transfers the full model. Keep a server cache `{fingerprint,payload}` and support `/api/status?since=<fingerprint>` returning `304` or `{unchanged:true}`. This does not reduce collector CPU by itself, but cuts browser JSON parse/network work and composes with event push.

5. **Adaptive polling.** F460 moved active polling from 10 s to 20 s. Add an idle backoff ladder: after N unchanged fingerprints, stretch to 60-120 s; collapse to 1-2 s briefly after a user action or engine event. Expected impact: not lower p95 per poll, but lower total background load and better laptop/battery behavior.

6. **Parallel repo collection only after cache cleanup.** Repos are independent, so `Promise.all` looks attractive. But the collector is mostly synchronous filesystem/child-process work; wrapping sync work in promises will not parallelize it on the Node event loop. Worker threads or child processes would help but add complexity. Do #1-#3 first; then consider workerized per-repo collection if the remaining hot path is still CPU-bound.

### Targets: what "fast enough" means

For the dashboard workflows the user named:

- Spec drawer open: p95 **<150 ms warm**, p99 **<300 ms**. This path must not wait behind full status collection.
- Terminal handshake: p95 **<250 ms** to first paint, p99 **<500 ms**. F455 already attacked xterm/PTY buffering.
- Kanban refresh after state mutation: p95 **<500 ms** to visible update, with push target **<100 ms** when the server observes the event.
- Autonomous modal open: first paint **<100 ms**, complete hydrated controls **<700 ms** warm.
- Background poll: p95 **<500 ms** in current filesystem architecture; structural target **<100 ms** for warm read-model queries.

Sub-200 ms for a full cold filesystem sweep across 7 repos / 700+ entities is the wrong target. Sub-200 ms is realistic for user-facing reads when the server maintains a warm read model.

### Transport: polling vs push

Polling is an artifact of the CLI-first design. It is still a good reconciliation safety net, but it should not be the primary latency mechanism. The engine already writes append-only workflow events. The dashboard should move toward:

- file-watcher or write-path invalidation on `.aigon/workflows/**/events.jsonl`, `.aigon/state/*.json`, and spec folders;
- in-process read-model cache invalidation;
- SSE to browsers for one-way "repo/entity changed" notifications;
- periodic full reconciliation as a fallback.

SSE is the best first push transport because the dashboard mostly needs server-to-browser updates. MDN documents native `EventSource` reconnection and event IDs, which gives Aigon a straightforward missed-event repair hook. WebSockets are already in the dependency tree via `ws` and are appropriate for interactive PTY sessions, but MDN notes the stable browser `WebSocket` API has no backpressure, so it is unnecessary complexity for status updates. Node's own `fs.watch()` docs also warn that file watching can be unreliable on network filesystems and virtualization, so push must be paired with reconciliation polling, not replace it completely.

### State backend options

**Filesystem as authority, optimized read model.** Best near-term choice. It preserves human-readable markdown specs, git history, current repair semantics, and offline behavior. Weakness: cold scans get expensive and ad-hoc reads are easy to reintroduce.

**SQLite as derived read model.** Best medium-term local backend. Keep specs/events/status files authoritative; project a query-optimized SQLite database under `.aigon/cache/dashboard.sqlite`. SQLite WAL is a good fit for one local daemon and multiple dashboards: official SQLite docs state WAL lets readers and writers proceed concurrently, with the important caveat that WAL is same-host, not network-filesystem friendly. This gives Aigon fast indexed reads without migrating the workflow engine's write path.

**SQLite as authoritative state.** Not recommended yet. It would improve query speed but would be a trapdoor for git-readable state, manual repair, and current CLI compatibility. Consider only after the derived cache has proven stable.

**Server-side SQL/Postgres.** Good for team/cloud mode later. Postgres `LISTEN/NOTIFY` can wake app servers, and SQL solves cross-user query patterns. It adds operations, auth, migration, backup, and cloud assumptions that are wrong for the solo/local default today.

**Embedded KV/LSM stores.** RocksDB/LMDB can be fast, but the dashboard needs relational queries over entities, stages, agents, sets, dependencies, and timestamps. KV stores would push indexing/query semantics into Aigon code. SQLite is the simpler embedded store unless profiling proves otherwise.

**Hosted services: GitHub Issues / Linear / Notion.** Useful as integrations, not core state. GitHub's authenticated REST limit is generally 5,000 requests/hour but has secondary limits; Notion's official API limit is about 3 requests/sec with 429 handling. Linear offers GraphQL, webhooks, and realtime clients, but using Linear/GitHub/Notion as the primary backend creates lock-in, weaker offline behavior, and a mismatch with Aigon's agent-local workflows.

### Personas and topology

In 12 months, Aigon should still be primarily a **CLI + local dashboard** for solo developers and power users, with credible support for:

- one user with multiple read-only dashboards/screens;
- pair mode on one shared repo/workstation;
- small-team mode through an optional central server or Pro sync layer.

Org/cloud-multi-tenant should remain aspirational unless product strategy changes. The correct topology is therefore:

- default: local daemon + local filesystem authority + derived SQLite/read-model cache;
- optional: multiple browser dashboards connected to the same local daemon;
- later: central server consuming the same event/read-model contract, not a forked dashboard architecture.

### Multi-dashboard and multi-user sync

Multiple local dashboards are easy once status is evented: all clients subscribe to the same daemon and occasionally reconcile with `/api/status`. Two collaborators sharing one workspace is harder because writes need identity, authorization, and conflict policy. A team of 5-20 requires central-authoritative state, per-user auth, and explicit write boundaries.

CRDTs are not the right first team abstraction for Aigon workflow state. Engine events are already command/event shaped, so central-authoritative op-log replay is a better fit. CRDT ideas may help collaborative markdown editing, but lifecycle transitions should stay engine-validated.

### Doors vs trapdoors

Doors:

- One repo-visible spec index per collector pass.
- Read-model facade/cache behind `collectRepoStatus()`.
- SSE change stream with periodic full reconciliation.
- Derived SQLite cache populated from existing filesystem/event sources.
- Server-owned `validActions` and state render metadata continuing to be the frontend contract.

Trapdoors:

- Making SQLite authoritative before the projection layer is proven.
- Adding hosted backends as first-class storage before there is an adapter contract.
- Making the browser compose raw specs/snapshots directly.
- Replacing polling with file-watch-only push and no reconciliation.
- Parallelizing sync filesystem work with promises and assuming it is real parallelism.

## Sources

- Local code: `lib/dashboard-status-collector.js`, `lib/feature-spec-resolver.js`, `lib/feature-sets.js`, `lib/feature-dependencies.js`, `lib/dashboard-server.js`, `templates/dashboard/js/init.js`.
- Recent local perf logs: F454, F459, F460 under `docs/specs/features/logs/`.
- SQLite WAL docs: https://www.sqlite.org/wal.html
- MDN SSE docs: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- MDN WebSocket API docs: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- Node.js `fs.watch()` caveats: https://nodejs.org/api/fs.html
- Linear API/webhooks docs: https://linear.app/docs/api-and-webhooks
- Linear sync-engine talk page: https://linear.app/now/scaling-the-linear-sync-engine
- GitHub REST API rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Notion request limits: https://developers.notion.com/reference/request-limits
- Ink & Switch local-first paper: https://www.inkandswitch.com/essay/local-first/local-first.pdf

## Recommendation

Ship the short-term collector fixes first. The single highest-ROI change is **repo-visible status indexing**: one stage-dir scan per repo, per entity type, per collector invalidation, with feature/research identity resolution reading from that index instead of scanning all stage dirs per workflow id. Follow it with pass-scoped set/dependency memoization and TTL separation for cold infra probes.

For the longer term, build an **evented local read-model service**:

1. Keep workflow events, snapshots, agent status files, and markdown specs as the authoritative write model.
2. Add a dashboard read-model cache with an internal adapter API.
3. Project that cache into memory first, then SQLite when query shape and invalidation semantics are stable.
4. Push invalidations/status deltas to browsers via SSE, with a slow reconciliation poll as the safety net.
5. Leave WebSockets for PTY/interactive terminal use.

This composition preserves current behavior and opens the future doors: multiple dashboards, central server, alternate backends, and hosted-service integrations can all target the same read-model/event contract later.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| dashboard-visible-spec-index | Build a per-repo feature/research spec index once per status pass and route identity resolution through it instead of rescanning stage dirs per entity. | high | none |
| dashboard-set-dependency-memoization | Compute set membership, feature index, and dependency graph once per repo collector pass and pass the memoized context to set cards and blocked-by annotation. | high | dashboard-visible-spec-index |
| dashboard-cold-probe-ttl-cache | Move Caddy route parsing, dev-server port probes, default-branch detection, GitHub remote detection, and schedule decoration onto explicit warm/cold TTL caches. | high | none |
| dashboard-status-delta-api | Add server-side status fingerprints so `/api/status` can return unchanged/delta responses instead of full payloads on every poll. | medium | dashboard-visible-spec-index |
| dashboard-adaptive-poll-cadence | Back off polling after unchanged fingerprints and briefly accelerate after user actions or observed workflow events. | medium | dashboard-status-delta-api |
| dashboard-sse-change-stream | Add an SSE endpoint that broadcasts repo/entity invalidation events with event IDs and browser reconnection, while retaining reconciliation polling. | high | dashboard-status-delta-api |
| dashboard-read-model-adapter | Introduce a narrow dashboard read-model adapter behind `collectRepoStatus()` so filesystem, memory-cache, SQLite, and future remote backends share one contract. | high | dashboard-visible-spec-index |
| dashboard-sqlite-derived-cache | Project workflow snapshots, status sidecars, spec identity, sets, dependencies, and feedback summaries into a local SQLite cache for indexed dashboard reads. | medium | dashboard-read-model-adapter |
| dashboard-multi-client-daemon | Treat the local dashboard server as the canonical multi-client daemon, allowing several browser dashboards to subscribe to the same read model and SSE stream. | medium | dashboard-sse-change-stream |
| dashboard-hosted-backend-spike | Prototype GitHub Issues, Linear, and Notion as import/export or mirror adapters, explicitly not as authoritative storage, to validate lock-in and offline tradeoffs. | low | dashboard-read-model-adapter |
