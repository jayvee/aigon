# Research Findings: dashboard perf and state architecture

**Agent:** Claude (cc)
**Research ID:** 47
**Date:** 2026-04-30

---

## Key Findings

### Direct profile at user scale (7 repos / 674 features / 39 research)

I instrumented `fs` and ran `collectDashboardStatusData()` end-to-end out of `node`. Numbers from this machine, this repo set, right now:

| Metric                       | Cold pass | Warm pass |
|------------------------------|-----------|-----------|
| Wall time                    | ~1,520 ms | ~1,000 ms |
| `readdirSync` calls          | 21,250    | 21,214    |
| `readFileSync` calls         | 8,050     | 7,266     |
| `statSync` calls             | 1,851     | 1,329     |
| `existsSync` calls           | 3,024     | 2,962     |
| `execSync` calls             | 8         | 1         |

Two facts jump out:

1. **F454/F459/F460's mtime-gated caches barely change syscall counts between cold and warm.** They do help — wall time drops ~500 ms — but they don't reduce the *amount* of filesystem work, only the parsing/derivation work on top of it.
2. **The same six stage directories are read ~2,127 times per warm poll** in the aigon repo alone. Across all 7 repos, that's where ~99% of the readdirSync calls go.

### Where the directory rescans come from

The 2,127 reads of `01-inbox`/`02-backlog`/`03-in-progress`/`04-in-evaluation`/`05-done`/`06-paused` per repo per warm poll decompose roughly as:

- ~422 calls × 6 dirs from `featureSpecResolver.listVisibleEntitySpecs`, invoked once per workflow feature id via `resolveFeatureIdentity` → `resolveFeatureSpec`.
- Multiple full sweeps from `featureSets.scanFeatureSets` (one in `collectFeatures`, one inside `summarizeSets`, two per set card via `getSetMembersSorted` + `getSetDependencyEdges`). Each sweep reads every spec file in every stage dir to look for a `set:` frontmatter tag.
- One sweep per backlog dependency check via `featureDependencies.buildFeatureIndex` (and another from `buildDependencyGraph`).

### Where the file reads come from

A warm pass reads **5,683 markdown files** but only **882 distinct files** — every spec is read ~6.4× per poll. First-call traces show all of them originate in `lib/feature-sets.js:93` (`scanFeatureSets`). Snapshot and event reads, by contrast, are not the dominant cost:

- `snapshot.json` reads: 4 (basically a no-op at warm)
- `events.jsonl` reads: 636 (one per active feature/research, small files)
- `feature-N.json` manifests: 188

So the popular short-term hypothesis "cache `snapshot.json` reads behind an mtime" is a real but modest win at this scale — a few hundred milliseconds, not seconds. The structural waste is the repeated full-spec sweeps.

### Other observations from the profile

- `scanFeatureSets` doing a per-spec-file `readFileSync` to parse frontmatter for the `set:` tag is by itself the largest single contributor to warm-pass `readFileSync` count. There's no caching whatsoever — the function is pure I/O per call, and it gets called many times per poll.
- `pollStatus` runs every 20 s active / 60 s idle (F460). The full poll-to-render cycle is therefore ~5% of wall-clock CPU on this machine. That's not catastrophic, but it's loud — the `aigon` directory mtime ticks dozens of times per minute even when no work is happening.
- The poll already does a per-repo serial loop (`readConductorReposFromGlobalConfig().forEach`). At this scale that is ~150 ms of avoidable serialization (1,000 ms total / 7 repos averaged). However, since the work is sync filesystem + child_process, `Promise.all`-wrapping won't actually parallelize it on Node's event loop — agreeing with cx here. Worker threads or a child-process worker pool would, but they add real complexity.

### Architectural framing — agreement and divergence with the other agents

I read both gg's and cx's findings before completing my own profile. Where I land:

- **Strong agreement with cx** on the surgical hierarchy. The single-highest-ROI change is a per-poll **visible spec index** + **scan memoization**: build the canonical `{stage,id,slug,path,setSlug,depends_on}` index once per repo per poll, route identity resolution, set scanning, and dependency checks through it. This eliminates the ~10,000 redundant readdirSync and ~4,800 redundant `.md` re-reads in one shot.
- **Partial disagreement with gg** on snapshot caching priority. gg lists "cache snapshot.json reads behind mtime" as the top-priority short-term fix; my profile shows snapshot reads are ~640/poll (one per active feature) of small files — a real but secondary win. The collector spends most of its time *reading specs we just read*, not *re-reading the same snapshot*.
- **Structural agreement with both** on the long-term picture. Filesystem stays authoritative; a derived in-memory read-model facade is the door. SQLite as a *projection target* is right for the medium term; SQLite as an *authoritative store* would close more doors than it opens (kills `git diff` over state, kills `aigon doctor --fix` repair semantics).
- **One framing I'd add:** the right structural primitive is **a three-tier read model** sitting behind `collectRepoStatus`:
    - **Tier 0 — fingerprint:** stage-dir mtimes hashed; if unchanged since the last poll, return the previous response object verbatim.
    - **Tier 1 — incremental diff:** for repos whose fingerprint did move, identify which entities' `events.jsonl`/`snapshot.json`/spec mtimes changed and re-derive only those rows.
    - **Tier 2 — cold rebuild:** the only path that does what `collectRepoStatus` does today.
  This decomposition is the actual generalisation of F454's frontend fingerprint and F459's "skip done" pattern back into the server. It also makes SSE almost trivial later — the server already knows when each tier fires, so it just emits `{repo, fingerprint, deltaIds}` on tier-1.

### What "fast enough" should mean

Aligning with cx's targets and adding my own:

| Operation | p95 target | p99 target | Notes |
|-----------|------------|-----------|-------|
| Spec drawer open (warm) | <150 ms | <300 ms | Must NOT wait behind the next poll |
| Terminal handshake (warm) | <250 ms | <500 ms | F455 partially landed |
| Kanban update after action | <500 ms (poll) / <100 ms (push) | <1 s | Push target only with SSE |
| Autonomous modal open | <100 ms first paint | <700 ms hydrated | |
| Background poll | <500 ms warm in fs model; <100 ms with read-model | — | Sub-200 ms cold across 7 repos / 700 entities is the wrong target — use a warm read model. |

### Doors vs trapdoors

**Doors (preserve all current behaviour AND open future options):**
- A read-model facade in front of `collectRepoStatus` (same return shape, swappable backend).
- Per-repo visible spec index + memoized set/dependency scans inside one collector pass.
- Tier-0/1/2 fingerprint-driven incremental polls (composes with both polling and SSE).
- SSE channel that emits invalidation events and falls back to polling when disconnected.
- Derived SQLite cache populated *from* the existing event log + snapshots (i.e. a projector, not a replacement).

**Trapdoors (close options or commit prematurely):**
- Replacing polling entirely with file-watching (Node's `fs.watch` is unreliable on virtualized FS / network FS — would need polling fallback anyway).
- Promoting SQLite to authoritative state before the projector is proven and kept in sync across crashes.
- Promoting Linear / GitHub Issues / Notion to authoritative state — kills offline, kills `git log` of state, brings rate-limit and lock-in baggage.
- Adopting CRDTs for workflow lifecycle. The engine is already command/event shaped; central-authoritative op-log replay is the right multi-user model.
- Wrapping synchronous filesystem work in `Promise.all` and calling it parallelism — it isn't.

### Cost of doing nothing

Tolerable for ~6–12 months at this user's scale. The user already runs 7 repos / 674 features comfortably. But:
- Each new repo adds ~150 ms warm. At 12 repos that's ~1.8 s warm — perceptible.
- The `aigon` repo at 422 features will hit ~1,000 features within a year given the current pace. `scanFeatureSets`-as-it-stands grows linearly with that, so warm poll time roughly doubles to ~2 s in the same repo set.
- More importantly: every UI feature that wants instant feedback (drag-to-reorder, inline edits, multi-tab reflection) is blocked behind that same poll-bound collector, and the gap to making any of them feel native widens monthly.

So: structural work is not urgent, but the *adapter layer* that unlocks structural work later is the cheapest insurance the project can buy now.

## Sources

- Live profile: `node` instrumentation of `lib/dashboard-status-collector.js`'s `collectDashboardStatusData()` against `~/.aigon/config.json` repos at the time of writing.
- `lib/dashboard-status-collector.js` — `collectFeatures`, `collectResearch`, `collectRepoStatus`, `getTierCache`.
- `lib/feature-sets.js:81` — `scanFeatureSets` (full spec sweep, no caching).
- `lib/feature-spec-resolver.js:97` — `listVisibleEntitySpecs` (6 readdirSync per id).
- `lib/feature-dependencies.js:117` — `buildFeatureIndex`, `buildDependencyGraph`.
- `lib/dashboard-server.js:1837–1847,2392` — `POLL_INTERVAL_ACTIVE_MS=20_000`, `POLL_INTERVAL_IDLE_MS=60_000`, `pollStatus` driver.
- `lib/workflow-read-model.js:120–175` — `getBaseDashboardState`, snapshot/event reads.
- F454 / F459 / F460 logs under `docs/specs/features/logs/`.
- Node.js `fs.watch()` reliability caveats: https://nodejs.org/api/fs.html#fswatchfilename-options-listener
- SQLite WAL — same-host concurrency only: https://www.sqlite.org/wal.html
- MDN SSE / `EventSource` reconnection: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- Local-first software (Ink & Switch): https://www.inkandswitch.com/essay/local-first/
- Linear sync engine architecture: https://linear.app/now/scaling-the-linear-sync-engine

## Recommendation

### Short-term punch list (ranked by ROI per engineer-day)

1. **Per-pass visible spec index + scan memoization.** Build a single `{stage, id, slug, fullPath, setSlug, dependsOn[], frontmatterRaw}` index per repo per `collectRepoStatus` invocation. Route `resolveFeatureIdentity`, `featureSets.scanFeatureSets`, `featureSets.summarizeSets`, `featureSets.getSetMembersSorted`, `featureSets.getSetDependencyEdges`, and `featureDependencies.buildFeatureIndex`/`buildDependencyGraph` through it. Expected impact: drops warm `readdirSync` from ~21k to ~50, `.md` reads from ~5,700 to ~880 (each file once), warm wall-time from ~1,000 ms to ~300–400 ms. Highest-ROI item by a wide margin. Composes with everything below.
2. **Memoize the index across polls behind stage-dir mtimes.** Once #1 exists, gate it behind a per-stage-dir mtime check (the same pattern F454 uses for backlog/inbox/paused, extended to `in-progress`, `in-evaluation`, `done`). When the mtime hasn't moved, reuse the previous index entirely. Expected impact: idle-poll warm wall-time drops to <100 ms in steady state. Without #1 this isn't safely possible — too many call sites.
3. **Tier-0 fingerprint short-circuit on `/api/status`.** Hash the per-repo stage-dir mtimes + active state-file mtimes into one fingerprint. If unchanged since last poll, return the cached response object. Composes with the frontend fingerprint already added by F454 to also short-circuit JSON serialization and network transfer.
4. **Move cold infra probes to TTL caches.** `parseCaddyRoutes`, `getDevServerState`'s port probes, `detectGitHubRemote`, default-branch detection, and the Pro `buildPendingScheduleIndex` lookup don't need to run every 20 s. 60–300 s TTLs are fine. Expected impact: removes the `execSync`s and several hundred file reads from steady-state polls.
5. **Strip non-list-view fields from `/api/status` payload.** `workflowEvents`, `autonomousPlan`, full agent log excerpts, full reviewSessions arrays — these are all rendered only on drawer-open. Move them behind on-demand `/api/feature/:id/details` and shrink the polling payload by what I'd estimate is 60–80%. Composes with #3.
6. **Adaptive poll cadence.** After N consecutive unchanged fingerprints, stretch from 20 s → 60 s → 120 s; collapse to 5 s briefly after a user action or observed write. Most of the win here is laptop battery and event-loop variance, not p95 per-poll.
7. **`snapshot.json` mtime cache (gg's #1).** Real but small win at current scale; ~640 reads of small files per poll, mostly already in OS page cache. Worth doing as a defensive measure for future scale, but lower priority than #1–#5.

Items 1–4 are independent; ship them in that order. Each is a small, low-risk feature.

### Longer-term structural direction

**Recommended destination: evented local read-model service, derived from filesystem authority.**

Concretely, in 12 months:

- **Authoritative state stays where it is.** Markdown specs in `docs/specs/`, workflow events in `.aigon/workflows/<entity>/<id>/events.jsonl`, snapshots in `.aigon/state/`, agent status sidecars where they live today. Git remains the audit log for specs.
- **Read-model facade.** A narrow adapter (`getDashboardState(repoPath)` → today's `/api/status` shape) sits behind `collectRepoStatus`. Implementation tier 1 = in-memory cache populated by mtime-gated rebuilds (the punch list above). Implementation tier 2 = SQLite projection populated from a write-path tap. Same contract; the dashboard consumer never knows.
- **Transport: SSE for invalidation, polling as reconciliation.** Server emits `{repo, fingerprint, changedEntityIds[]}` events when its read-model rebuild observes a change. Clients consume those for instant updates and fall back to polling when disconnected. WebSockets stay reserved for PTY/terminal interactivity.
- **Multi-dashboard:** comes for free once SSE exists. Multiple browser tabs / devices subscribe to the same daemon.
- **Multi-user / team mode:** an optional remote daemon implementing the same read-model contract over HTTP+SSE. Postgres replaces the SQLite projection. Auth happens at the daemon edge. The CLI continues to write to a local working copy that syncs via standard git workflows. *Not for v1; the contract just needs to admit it.*
- **Hosted backends (Linear / GitHub Issues / Notion):** import/export and mirror adapters only, never authoritative. Validate with one spike behind a feature flag.

If new evidence emerges that the user wants real-time team collaboration as a near-term primary use case (rather than power-user solo + optional pair), the destination shifts toward central-authoritative earlier — but that's a product decision, not a technical one.

### Composition: short-term × long-term

| Short-term item | Effect on long-term direction |
|-----------------|-------------------------------|
| 1. Visible spec index + memoization | Door — exact same data shape the read-model facade needs as its first projection. |
| 2. Cross-poll mtime memoization | Door — proves the invalidation pattern SSE will use. |
| 3. Fingerprint short-circuit | Door — fingerprint becomes the SSE event payload. |
| 4. Cold-probe TTL caches | Neutral — bounded helper, doesn't constrain anything. |
| 5. Payload trim + on-demand details endpoint | Door — establishes the "list view vs detail view" split that any future backend needs. |
| 6. Adaptive cadence | Neutral. |
| 7. Snapshot mtime cache | Neutral. |

No item in the punch list closes any architectural door I can see, and items 1, 2, 3, 5 actively prepare the shape the long-term direction needs. That's the test.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| dashboard-perf-visible-spec-index | Build one per-repo spec index per `collectRepoStatus` pass and route `resolveFeatureSpec`, `scanFeatureSets`, `summarizeSets`, `getSetMembersSorted`, `getSetDependencyEdges`, `buildFeatureIndex`, and `buildDependencyGraph` through it. | high | none |
| dashboard-perf-stage-mtime-memoization | Extend F454's stage-dir mtime caching to `in-progress`, `in-evaluation`, `done`, and reuse the visible spec index across polls when stage mtimes are unchanged. | high | dashboard-perf-visible-spec-index |
| dashboard-perf-status-fingerprint | Compute a server-side fingerprint per repo and short-circuit `/api/status` polls when nothing has changed since the last response. | high | dashboard-perf-stage-mtime-memoization |
| dashboard-perf-cold-probe-ttl | Move Caddy route parsing, dev-server port probes, GitHub-remote detection, default-branch detection, and Pro schedule lookup to explicit 60–300 s TTL caches. | high | none |
| dashboard-payload-list-vs-detail-split | Strip `workflowEvents`, `autonomousPlan`, agent-log excerpts, and full reviewSessions arrays from `/api/status`; serve them from a new `/api/feature/:id/details` endpoint hit on drawer-open. | medium | dashboard-perf-status-fingerprint |
| dashboard-adaptive-poll-cadence | Back off polling to 60–120 s after N unchanged fingerprints; collapse to 5 s briefly after observed user actions or workflow events. | medium | dashboard-perf-status-fingerprint |
| dashboard-snapshot-mtime-cache | Cache `readFeatureSnapshotSync`/`readWorkflowSnapshotSync` results behind per-file mtime checks, rebuilding only when the entity's snapshot or events file has changed. | medium | none |
| dashboard-read-model-facade | Introduce a narrow `getDashboardState(repoPath)` adapter behind `collectRepoStatus` so the dashboard consumes a stable contract regardless of in-memory, SQLite, or remote backend. | high | dashboard-perf-visible-spec-index |
| dashboard-sse-invalidation-stream | Add an SSE endpoint that emits `{repo, fingerprint, changedEntityIds[]}` invalidation events derived from read-model rebuilds; keep polling as the reconciliation safety net. | high | dashboard-read-model-facade, dashboard-perf-status-fingerprint |
| dashboard-sqlite-projection | Project workflow snapshots, status sidecars, spec identity, sets, dependencies, and feedback summaries into a local SQLite cache populated from the same path that drives the read-model facade. | medium | dashboard-read-model-facade |
| dashboard-write-path-event-tap | Hook the workflow engine's write path to publish in-process invalidation events the read-model can subscribe to without re-statting the filesystem. | medium | dashboard-read-model-facade |
| dashboard-hosted-backend-spike | Time-boxed spike: prototype Linear / GitHub Issues / Notion as mirror adapters (export-only) behind a feature flag to validate lock-in, offline, and rate-limit assumptions. | low | dashboard-read-model-facade |
