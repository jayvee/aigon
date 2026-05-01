# Research Findings: dashboard perf and state architecture

**Agent:** Kimi (km)  
**Research ID:** 47  
**Date:** 2026-05-02  
**Note:** Post-hoc independent pass; research already closed. These findings are offered as a fresh perspective on the post-F467/F468/F469 state of the system.

---

## Key Findings

### 1. Current-state measurements (post-F467/F468/F469)

I profiled `collectDashboardStatusData()` against the live 7-repo configuration at the user's scale:

| Metric | Value |
|--------|-------|
| Total poll time | **1,476 ms** |
| Aigon repo (434 features, 20 research) | **650 ms** (625 ms in `features` step) |
| `readdirSync` calls | **17,885** |
| `statSync` calls | **3,232** |
| `readFileSync` calls | **5,256** |
| JSON payload size | **1.72 MB** |

This is materially better than the pre-F468 baseline cx reported (1,834 ms, 21,115 `readdirSync`, 7,872 `readFileSync`). The spec-index cache and probe-TTL layers are working. However, 1.5 s is still 6–7× away from the sub-200 ms target, and the aigon repo alone dominates the budget.

### 2. Payload analysis: hidden duplication

Breaking down the 1.72 MB `/api/status` response:

| Component | Size | % of total |
|-----------|------|------------|
| `features` array | 1,286 KB | 75 % |
| `allFeatures` array | 297 KB | 17 % |
| `research` array | 103 KB | 6 % |
| Other | 36 KB | 2 % |

Within `features`, three items stand out as **independent of the other agents' findings**:

1. **`validActions` and `nextActions` are near-identical** (~193 KB each). In the collector, `nextActions` is populated from the same `snapshotActions.validActions` array that feeds `validActions`. The dashboard consumes both, but `nextActions` is a strict superset semantic of `validActions` with no additional filtering. This is ~193 KB of duplication per poll that could be eliminated by deriving `nextActions` client-side or replacing it with a reference/count.

2. **`allFeatures` duplicates data already present in `features`**. It carries `id`, `name`, `stage`, `specPath`, `updatedAt`, `createdAt`, `logPaths` for every feature — the same identifiers exist in the `features` array. The dashboard uses `allFeatures` for search/dropdown surfaces, but sending it on every poll inflates the payload by 17 % even when the user has no search panel open.

3. **`cardHeadline` + `stateRenderMeta` + `detailFingerprint` are collectively ~135 KB** of per-feature computed strings that the dashboard re-derives on every poll. They are not authoritative state; they are pure functions of snapshot + agent rows. The client already has enough data to compute these.

**Quick-win estimate:** removing `nextActions` duplication, making `allFeatures` opt-in, and moving `cardHeadline`/`stateRenderMeta` to client-side derivation would cut the payload by **~35–40 %** (~600–700 KB) without touching the collector's CPU work at all.

### 3. Event log scale: smaller than expected

The workflow event logs are tiny:

- **6,336 events** total across 424 features with engine state
- Average: **14.9 events per feature**
- Maximum: **557 events** (feature 186 — an outlier with many review cycles)
- 95th percentile: likely <40 events

This matters for two reasons:

- **Event-driven push is cheap.** Replaying 15 JSON lines per feature is trivial. The engine already writes append-only events; a push transport does not need complex batching or backpressure at this scale.
- **Snapshot reads are not the bottleneck.** A single `readFileSync` of `snapshot.json` is ~0.08 ms. Even 434 snapshot reads is <35 ms. The 625 ms `features` step is in per-feature orchestration (agent row building, tmux checks, liveness, action derivation), not in I/O volume.

### 4. The async collector yields between repos, not within them

F471 introduced `collectDashboardStatusDataAsync`, which inserts `setImmediate` between repos. This prevents a 1.5 s synchronous block from freezing the HTTP server. However, the aigon repo alone takes 650 ms. A single large repo can still delay an incoming `/api/action` POST by hundreds of milliseconds. Yielding every N features (e.g., every 50) within the aigon repo loop would bound per-chunk blocking to ~50–80 ms without changing semantics.

### 5. File-watcher landscape (2026)

Raw `fs.watch()` remains unreliable across platforms: missing events on atomic saves, no recursive watching on Linux before Node 19, inconsistent `rename` vs `change` semantics. The three viable options for a file-watcher-driven invalidation layer are:

| Option | Pros | Cons |
|--------|------|------|
| **chokidar** (v4, 1 dep) | Battle-tested, 30M+ repos, handles atomic writes, normalises events | Extra dependency (not in tree today), watches more than asked if not careful |
| **@parcel/watcher** | Powers VS Code, very fast native bindings, rename detection | Native dependency, more complex build story |
| **fs.watchFile polling** | Zero deps, works everywhere | CPU-intensive, unsuitable for large trees |

For Aigon's use case — watching a bounded set of directories (`docs/specs/features/*`, `.aigon/workflows/*`, `.aigon/state/*`) across 7 repos — **chokidar v4** is the pragmatic choice. It is one dependency, actively maintained, and the watched surface is small enough that recursive overhead is negligible.

---

## Short-term wins still available (independent of other agents)

These are additive to the F467/F468/F469 punch list; they do not overlap with the three shipped features.

### 1. Payload deduplication: `nextActions` → client-side derivation
**Effort:** low | **Risk:** near-zero | **Impact:** −193 KB per poll  
Replace `nextActions` on the server with a single `validActions` array. The dashboard can derive `nextActions` by filtering `validActions` for `board: true`. The contract change is backward-compatible if the dashboard already consumes `validActions`.

### 2. `allFeatures` as opt-in or separate endpoint
**Effort:** low | **Risk:** near-zero | **Impact:** −297 KB per poll  
Add `?include=allFeatures` to `/api/status` (default false). The search dropdown can hit `/api/all-features` once on open, or the dashboard can request it only when the search panel mounts. This is not a cache — it is simply not sending data that most polls do not need.

### 3. Intra-repo `setImmediate` yields in `collectFeatures`
**Effort:** low | **Risk:** near-zero | **Impact:** bounds HTTP latency to ~50 ms under load  
Inside the `workflowFeatureIds.forEach` loop in `collectFeatures`, yield every N iterations (e.g., `if (i % 50 === 0) await new Promise(r => setImmediate(r))`). This extends F471's "don't block HTTP" principle from inter-repo to intra-repo.

### 4. Done-feature short-circuit
**Effort:** medium | **Risk:** low | **Impact:** ~10–15 % of feature step  
Done specs are immutable. The collector still reads their snapshots and builds agent rows (empty arrays). A fast path: if `isEntityDone()` is true and the spec is in `05-done/`, return a minimal stub without snapshot+events reads. The dashboard kanban only needs `id`, `name`, `stage`, `stateRenderMeta` for done cards. F459 already skips snapshot reads for done specs in `collectDoneSpecs`, but the main `features` loop still processes done workflow IDs.

### 5. `cardHeadline` + `stateRenderMeta` client-side derivation
**Effort:** medium | **Risk:** low (dashboard-only change) | **Impact:** −135 KB per poll  
The server already sends all raw inputs (`snapshot`, `agents`, `stage`, `autonomousPlan`). The dashboard JS can compute `cardHeadline` and `stateRenderMeta` locally. This mirrors the existing frontend-side fingerprint logic (F454) — move pure computation to the client.

---

## Transport: pull vs push (independent assessment)

I agree with cc/cx/gg that SSE is the right first push transport. My additional observation:

**Do not build a general pub-sub system.** The dashboard only needs three event streams:
1. **Entity invalidation:** `{repo, entityType, entityId, fingerprint}` when a workflow event is appended.
2. **Agent status invalidation:** `{repo, featureId, agentId}` when an agent-status file is written.
3. **Spec index invalidation:** `{repo}` when a spec file moves stages.

These three streams cover >95 % of observable mutations. Everything else (Caddy routes, dev-server state, npm updates) can stay on the slow poll tier. A minimal SSE endpoint that subscribes to these three narrow channels is a weekend project, not an architecture rewrite.

**Reconciliation strategy:** SSE is the fast path; polling is the safety net. If SSE disconnects, the dashboard falls back to 20 s polling and re-subscribes on reconnect. This is the same model MDN recommends for `EventSource` — the browser handles reconnection automatically.

**File-watcher vs write-path tap:** Two ways to detect mutations:
- **Write-path tap:** The engine and CLI commands emit in-process events after `appendEvent` / `writeSnapshot`. Zero latency, zero deps, but only catches engine writes (not manual `git mv` of specs).
- **File watcher (chokidar):** Catches all filesystem mutations, including manual edits. Slightly higher latency (~10–50 ms), requires the dependency.

The robust composition is **both**: write-path tap for instant invalidation of engine events, chokidar for spec-folder moves and external edits. They converge on the same invalidation bus.

---

## State backend (independent assessment)

The other agents converged on "filesystem authority + SQLite derived cache." I largely agree, with one caveat:

**Do not build the SQLite cache until profiling proves it is necessary.** At 14.9 events per feature and 0.08 ms per snapshot read, the filesystem is not the bottleneck. The bottleneck is per-feature orchestration (agent rows, tmux, liveness). A SQLite cache would make snapshot reads faster, but snapshot reads are already <35 ms of a 625 ms budget. The ROI of SQLite is in **query flexibility** (filtering, sorting, full-text search) and **multi-process safety**, not in raw read speed at current scale.

**When SQLite becomes worth it:**
- >2,000 active features, or
- Multiple dashboard clients doing independent queries, or
- Need for server-side search/filtering without loading all specs into memory

Until then, an **in-memory LRU cache with mtime invalidation** (what F468 already built) is the right complexity/performance tradeoff.

---

## Server topology

The no-server question is worth revisiting. Could the dashboard be a static SPA reading from disk?

**No — but the daemon could be much thinner.** Today `dashboard-server.js` is ~2,578 lines of HTTP routing, WebSocket relay, notification logic, analytics, and polling. If the read model were event-driven, the server's role collapses to:
1. Serve static assets
2. Maintain one in-memory read-model projection
3. Broadcast invalidations via SSE
4. Proxy action POSTs to the CLI

That's maybe 400 lines. The dashboard JS would own its own data composition, caching, and delta application. This is a door, not a trapdoor — it does not change the CLI or engine at all.

---

## Multi-dashboard / multi-user

The three scenarios from the research brief:

| Scenario | Feasibility today | What is missing |
|----------|-------------------|-----------------|
| (a) One user, multiple read-only dashboards | **Easy** once SSE exists | SSE endpoint + browser `EventSource` |
| (b) Two collaborators, one workspace | **Hard** | Write coordination, identity, conflict policy |
| (c) Team of 5–20 | **Very hard** | Central auth, per-user views, write boundaries, migration from single-user mental model |

My independent take: **Scenario (a) should be the only near-term goal.** It requires no auth, no conflict resolution, and no state backend changes — just an SSE stream that multiple browsers can consume. Scenarios (b) and (c) are product decisions first, architecture decisions second. Building infrastructure for them before there is product demand is a trapdoor.

---

## Doors vs trapdoors

**Doors (additive, preserves current behaviour):**
- Payload deduplication (`nextActions`, `allFeatures` opt-in, client-side `cardHeadline`)
- Intra-repo async yielding (F471 extended)
- SSE invalidation stream (narrow, three-channel)
- Write-path event tap + chokidar fallback
- Thinner server (read model in JS, not filesystem scan per poll)

**Trapdoors (commits to one path, closes others):**
- Adding chokidar as a hard dependency for *all* users (make it optional: graceful degrade to polling if not installed)
- SQLite cache before profiling proves filesystem is the bottleneck
- Building team/auth infrastructure before scenario (a) is proven
- Removing polling entirely in favour of push-only (push needs reconciliation fallback)

---

## Sources

- Local code profiling: `lib/dashboard-status-collector.js`, `lib/dashboard-server.js`, `lib/workflow-read-model.js`, `lib/dashboard-spec-index.js`, `lib/workflow-core/event-store.js`
- Live measurements taken on 2026-05-02 against the user's actual 7-repo configuration
- Local-first software landscape: [awesome-local-first](https://github.com/alexanderop/awesome-local-first), [Local First Conf 2024](https://digest.browsertech.com/archive/browsertech-digest-trip-report-local-first-conf/)
- File watcher comparison: [chokidar vs alternatives](https://npm-compare.com/chokidar,fsevents,gaze,node-watch,watch), [parcel/watcher](https://github.com/parcel-bundler/watcher)
- chokidar v4 changes: [npm-compare chokidar changelog](https://npm-compare.com/chokidar,gaze,node-watch,nodemon,watch)
- MDN SSE docs: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events

---

## Recommendation

### Immediate (this week)
1. **Deduplicate `nextActions` from `/api/status`** — derive client-side from `validActions`. Cuts ~193 KB instantly.
2. **Make `allFeatures` opt-in** — new `?include=allFeatures` query param, default false. Cuts ~297 KB.
3. **Extend F471 intra-repo** — yield every 50 features inside `collectFeatures` to bound HTTP blocking.

### Short-term (next 2–4 weeks)
4. **Client-side `cardHeadline` + `stateRenderMeta`** — move pure computation to the dashboard JS. Cuts ~135 KB.
5. **Done-feature short-circuit** — minimal stub for engine-done specs in `05-done/`.
6. **SSE invalidation MVP** — three-channel SSE endpoint (`entity`, `agent-status`, `spec-index`) fed by a write-path tap. Keep polling as reconciliation fallback.

### Long-term direction
Build a **thinner, event-driven daemon**:
- In-memory read model rebuilt on invalidation, not polled
- SSE to browsers for sub-100 ms updates
- Polling degraded to a slow reconciliation tier (60–120 s)
- SQLite derived cache added only when profiling shows it is the bottleneck, not before

This preserves every current behaviour, opens the multi-dashboard door, and does not commit to team-mode infrastructure prematurely.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `dashboard-payload-dedup-next-actions` | Derive `nextActions` client-side from `validActions`; remove from `/api/status` payload | high | none |
| `dashboard-all-features-opt-in` | Move `allFeatures` out of default `/api/status`; serve from `?include=allFeatures` or separate endpoint | high | none |
| `dashboard-intra-repo-yield` | Extend F471 `setImmediate` yielding inside `collectFeatures` every N features to bound HTTP blocking | medium | none |
| `dashboard-client-side-headline` | Compute `cardHeadline` and `stateRenderMeta` in dashboard JS instead of server-side per poll | medium | none |
| `dashboard-done-short-circuit` | Return minimal stub for done features instead of full snapshot+agent row build | low | none |
| `dashboard-sse-invalidation-mvp` | Three-channel SSE endpoint (entity, agent-status, spec-index) with write-path tap + chokidar fallback | high | dashboard-write-path-event-tap (from R47 synthesis) |
| `dashboard-thinner-daemon` | Refactor server to event-driven in-memory read model + SSE; polling becomes reconciliation-only | medium | dashboard-sse-invalidation-mvp |
| `dashboard-payload-audit` | Systematic audit: every field in `/api/status` must justify its bytes; remove or lazy-load dead weight | low | dashboard-payload-dedup-next-actions, dashboard-all-features-opt-in |
