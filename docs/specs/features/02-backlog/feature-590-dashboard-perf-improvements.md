---
complexity: high
research: 47
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-25T01:56:24.729Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-perf-improvements

## Summary

The dashboard pipeline page has become slow to refresh. Live measurement of the running
instance (14 repos) shows `/api/status` returning a **3.5 MB uncompressed** JSON payload with
**893 features**, of which **739 (83%) are `done`**. Response times measured at 3.9–7.8s with
TTFB spiking to **7.6s**. `/api/status` only returns the cached `latestStatus`
(`lib/dashboard-routes/system.js:221`) — it does not recompute — so the multi-second TTFB is the
single-threaded event loop being **starved by the background `pollStatus()` collection**
(`lib/dashboard-server.js:738`) walking every repo × every feature × filesystem state.

Two compounding causes, both scaling with *total historical* features rather than *active* ones:

1. **Done features are fully enriched.** The `workflowFeatureIds` loop in
   `collectFeatures` (~line 817) walks every engine-backed feature and runs the full enrichment
   path (agents, `detailFingerprint`, `startupReadiness`, `cardHeadline`, `stateRenderMeta`,
   `validActions`, …) regardless of `stage`. Done features with workflow dirs therefore ship the
   same heavy shape as in-progress ones — e.g. 504 done features in the `aigon` repo carrying
   ~826 KB of runtime cruft. F459's `collectDoneSpecs` lean path only applies to folder-only done
   rows merged via `extraDone`; it does not short-circuit engine-backed done entries. The
   `specFiles` loop (~line 986) also attaches heavy fields to done-stage rows that pass through it.
2. **Far more done features ship than the UI renders.** Pipeline shows at most `DONE_CAP = 6` done
   cards per column (`templates/dashboard/js/pipeline.js:1546`), yet `features` carries every
   engine-backed done feature and `allFeatures` merges **all** folder-only done rows from
   `doneSpecs.all` (~line 1074). The browser re-parses the full payload and re-runs
   `flattenStatuses` + `statusFingerprint` on every client poll (`POLL_MS = 10000` in
   `templates/dashboard/js/state.js`; server poll is 20 s per F460 — the client can request stale
   cache up to twice per server refresh).

This feature continues the list-vs-detail boundary established by **F469** (which split heavy
per-entity detail off the poll path) by closing the remaining gap for **done features**, adds
**gzip compression** to the status response, and **adds first-class perf logging** (server-side
threshold logging + the currently-absent client-side instrumentation) so the next regression
self-reports instead of relying on "it feels slow".

## User Stories
- [ ] As an operator with a long project history, when I refresh the pipeline page the kanban
      updates quickly regardless of how many features I have closed over time.
- [ ] As a maintainer diagnosing a future slowdown, I can read a server log line that names the
      slow poll and the repos responsible, and a client-side timing breakdown (fetch vs parse vs
      render) without adding instrumentation by hand.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] **Lean done shape in `features`.** When `stage === 'done'`, entries in `repo.features` use
      only the lean list fields: `id`, `displayKey`, `name`, `stage`, `specPath`, `updatedAt`,
      `createdAt`, `set`, `logPaths` (plus `doneTotal` at repo level). No `detailFingerprint`,
      `startupReadiness`, `autonomousController`, `cardHeadline`, `stateRenderMeta`, `agents`,
      `validActions`, or `nextActions`. Applies to **both** the `workflowFeatureIds` loop (~817)
      and the `specFiles` fallback loop (~986). `extraDone` (~1074) already models the target
      shape — reuse or extract a shared helper.
- [ ] **Bounded done in poll payload.** `/api/status` includes at most **15** recent done features
      per repo in `repo.features` (numeric id descending — same ordering as `collectDoneSpecs`;
      comfortably above `DONE_CAP=6`). Engine-backed done features outside that window are omitted
      from `features`, not fully enriched. `doneTotal` remains accurate (already populated from
      `tierCache.cold.doneTotal`).
- [ ] **`allFeatures` off the hot poll path.** Default `/api/status` does **not** include
      `repo.allFeatures`. The All Items / Logs view fetches the full lean list on first mount via a
      new read endpoint (e.g. `GET /api/repos/all-features?repoPath=…`) that returns the same lean
      shape for every done feature. F67's uncapped list contract is preserved for that view only.
- [ ] **gzip on large JSON.** `sendJson` in `lib/dashboard-routes/util.js` gzip-compresses when
      `Accept-Encoding: gzip` is present and serialized body exceeds a threshold (e.g. 8 KB). Response
      carries `content-encoding: gzip` and `vary: Accept-Encoding`. SSE / WebSocket / PTY paths are
      untouched. Wire bytes for `/api/status` on the 14-repo dataset drop from ~3.5 MB to well
      under 1 MB.
- [ ] **Measured improvement.** `/api/status` steady-state total time (cached `latestStatus`) is
      below 1 s on the current 14-repo dataset, and multi-second TTFB starvation spikes during
      `pollStatus()` are eliminated or substantially reduced.
- [ ] **Server perf logging.** The `AIGON_DASH_TIMING` poll summary (`lib/dashboard-server.js:743`)
      logs automatically when `totalMs > 1000` even without the env var (env var still enables
      per-repo `_perf` detail). Log line includes total ms and top slow repos.
- [ ] **Server request logging.** `/api/status` logs JSON serialization ms and uncompressed byte
      count (every request or sampled at 1-in-10 when under threshold).
- [ ] **Client perf instrumentation.** `poll()` in `templates/dashboard/js/init.js` records
      `performance.now()` around fetch (wire bytes from `content-length`), `res.json()` parse,
      `flattenStatuses`/`statusFingerprint`, and `render()`, emitting a one-line console breakdown.
      Gated behind `?debug=perf` or `localStorage.aigon-debug-perf`; off by default.
- [ ] **Tests.** Integration coverage for: lean done shape (no heavy keys on `stage==='done'`),
      bounded `features` done count with correct `doneTotal`, gzip response headers on `/api/status`,
      and `all-features` endpoint returning the full lean list. REGRESSION comments name F459/F469
      invariants.
- [ ] **No regression.** Kanban renders correctly; done column still caps at `DONE_CAP` cards; done
      column "N more — open in Finder" still works; All Items view still lists every feature after
      its lazy fetch; fingerprint-gated re-render behaviour is preserved.

## Validation
```bash
npm run test:iterate
```

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

Four strands, ship lean → loud. Each strand is a separate commit when possible.

1. **Lean done features (biggest CPU + payload win).** In `lib/dashboard-status-collector.js`:
   extract a `buildLeanDoneFeatureRow(...)` from the `extraDone` mapper; call it from both
   enrichment loops when `stage === 'done'` instead of the full `features.push({...})` block. Skip
   agent-row construction and `buildDetailFingerprint` for done stage in the `workflowFeatureIds`
   loop. Done detail stays on `/api/feature/:id/details` (F469).
2. **Bound poll + lazy `allFeatures`.** Keep `collectDoneSpecs(..., limit=15)` as the single source
   for which done ids appear in `repo.features`. Omit workflow-backed done features outside that
   window from the poll payload (they remain reachable via the lazy endpoint). Remove
   `allFeatures` from the default collector return; add `GET /api/repos/all-features` (read-only,
   repo-scoped) and have `templates/dashboard/js/logs.js` fetch it on All Items view mount (show
   loading state; fall back to `repo.features` if fetch fails). **Do not** change the done-column
   "open in Finder" UX — that is disk browsing, not in-kanban pagination.
3. **gzip.** Implement in `lib/dashboard-routes/util.js:sendJson` — check
   `req.headers['accept-encoding']`, compress above threshold with `zlib.gzipSync`, set
   `content-encoding` + `vary`. Status route and other `sendJson` consumers inherit automatically.
4. **Perf logging.** Server: unconditional threshold log in `pollStatus()`; serialize-time +
   byte-count on `/api/status` handler (`lib/dashboard-routes/system.js:219`). Client: `poll()`
   phase timings behind debug flag. Optional stretch: `perf_hooks.monitorEventLoopDelay()` p99 per
   poll — only if threshold logging is insufficient to confirm starvation fix.

**Ownership:** collector changes → `lib/dashboard-status-collector.js`; transport →
`lib/dashboard-routes/util.js` + `system.js`; client → `templates/dashboard/js/init.js` +
`logs.js`. Dashboard action rules unchanged — read-only contract.

Constraints: no engine/workflow mutations. Preserve fingerprint-gated re-render and `DONE_CAP`.
Iterate gate only mid-implementation. After `lib/*.js` edits: `aigon server restart`. Dashboard
HTML/CSS edits: browser-MCP snapshot per CONTRIBUTING.

## Dependencies
- Builds on (already done): F467 cold-probe TTL, F468 status cache, F469 list-vs-detail split.

## Out of Scope
- SSE / delta / incremental-diff streaming of status (natural follow-up; F469 boundary enables it).
- Worker-thread offload of the collection pass — revisit only if lean done + gzip + bounded poll
  do not eliminate event-loop starvation.
- Archiving / purging old done specs from disk; data stays, poll path stops shipping it in full.
- Any change to active-feature (`in-progress`/`in-evaluation`/`paused`) payload shape.
- R47 post-hoc payload dedup wins not covered here: `nextActions` ≡ `validActions` duplication,
  client-side `cardHeadline`/`stateRenderMeta` derivation — file as separate follow-up features if
  measurement after F590 still shows headroom.
- Aligning client `POLL_MS` (10 s) with server poll interval (20 s, F460) — worthwhile but separate;
  note only if this feature touches `init.js` anyway.

## Decisions (resolved at spec review)
- **Recent-N window:** 15 done features per repo in `features` (matches raised `collectDoneSpecs`
  limit; > `DONE_CAP=6` with margin).
- **gzip surface:** `sendJson` in `lib/dashboard-routes/util.js` — all JSON routes inherit; not a
  one-off on `/api/status` only.
- **Full done list UX:** lazy `all-features` endpoint for All Items view; kanban done "more" stays
  Finder-open (no in-kanban pagination in this feature).

## Related
- Research: R47 — dashboard-perf-and-state-architecture (`docs/specs/research-topics/05-done/research-47-dashboard-perf-and-state-architecture.md`); post-hoc km findings (`docs/specs/research-topics/logs/research-47-km-findings.md`) for `allFeatures` opt-in rationale
- Prior features: F467 (cold-probe-ttl), F468 (status-cache), F469 (list-vs-detail-split), F67 (`allFeatures` for All Items view)
