---
complexity: high
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

1. **Done features are fully enriched.** Every one of the 504 done features in the `aigon` repo
   carries `detailFingerprint` (283 KB total), `startupReadiness` (236 KB), `autonomousController`
   (106 KB), `cardHeadline`, `stateRenderMeta`, and live `agents` runtime state (201 KB, non-empty
   on 280 of them). None of this is needed to render a terminal "Closed" card. ~826 KB of the
   1.95 MB `aigon` payload is runtime cruft on features that finished long ago.
2. **All done features are shipped every poll.** The client renders only `DONE_CAP = 6` done cards
   per column (`templates/dashboard/js/pipeline.js:1546`), yet the payload carries all 504. The
   browser then re-parses 3.5 MB and re-runs `flattenStatuses` + `statusFingerprint` over all 893
   features every 10s (`templates/dashboard/js/init.js`, `POLL_MS = 10000`).

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
- [ ] Done features in the `/api/status` payload are reduced to the lean list shape (id, displayKey,
      name, stage, specPath, updatedAt, createdAt, set, logPaths) — no `detailFingerprint`,
      `startupReadiness`, `autonomousController`, `cardHeadline`, `stateRenderMeta`, or `agents`
      runtime state. (Anchor: `lib/dashboard-status-collector.js` — `extraDone` at ~line 1061
      already builds this lean shape; the gap is the enrichment path that re-attaches heavy fields
      to done entries.)
- [ ] `/api/status` carries at most a bounded number of done features per repo for the poll path
      (e.g. the most-recent N, where N comfortably exceeds `DONE_CAP=6`), plus a `doneTotal` count.
      The full done list is retrieved on demand (column-expand) via a paginated endpoint, not the
      steady-state poll.
- [ ] `/api/status` (and other large JSON responses) are gzip-compressed when the client sends
      `Accept-Encoding: gzip`. Verified: response carries `content-encoding: gzip` and wire bytes
      drop from ~3.5 MB to well under 1 MB.
- [ ] Measured `/api/status` total time on the current 14-repo dataset drops below 1s steady-state
      (cached), and the 7s TTFB starvation spikes are eliminated or substantially reduced.
- [ ] Server perf logging: the existing `AIGON_DASH_TIMING` summary (`lib/dashboard-server.js:743`)
      logs automatically when a poll exceeds a threshold (e.g. `totalMs > 1000`), without requiring
      the env var — including total ms and the slowest repos.
- [ ] Server request logging: `/api/status` logs serialization time and payload byte count
      (per request or sampled).
- [ ] Client perf instrumentation: `poll()` in `templates/dashboard/js/init.js` records
      `performance.now()` around fetch (+ payload size from `content-length`), `res.json()` parse,
      `flattenStatuses`/`statusFingerprint`, and `render()`, emitting a one-line breakdown. Gated
      behind a debug flag (`?debug=perf` or `localStorage`) so it is off by default.
- [ ] No regression: the kanban still renders correctly, the done column still shows its capped
      cards, expanding a done column still loads the rest, and existing fingerprint-gated re-render
      behaviour is preserved.

## Validation
```bash
npm run test:iterate
```

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

Four independent, separately-shippable strands. Order them lean → loud so early commits already
move the needle:

1. **Lean done features (biggest payload win).** In `lib/dashboard-status-collector.js`, ensure
   done/terminal features never receive the active-feature enrichment (`detailFingerprint`,
   `startupReadiness`, `autonomousController`, live `agents`, `cardHeadline`, `stateRenderMeta`).
   `extraDone` (~line 1061) already models the correct lean shape; find the path that re-attaches
   heavy fields to done entries and gate enrichment on `stage !== 'done'`. This mirrors F469's
   list-vs-detail split — done detail belongs on the on-demand detail endpoint, not the poll.
2. **Bound + paginate the done list.** Cap done features carried in `/api/status` per repo to a
   recent-N window with a `doneTotal` count (`collectDoneSpecs` already takes a `limit`, and the
   client already caps display at `DONE_CAP=6`). Add/extend an endpoint to fetch the remaining done
   features for a repo+stage when the user expands the done column (`pipeline.js` expand handler).
3. **gzip the response.** Add transparent gzip for large JSON responses (status route / shared
   `sendJson`) keyed on `Accept-Encoding`. Confirm no double-compression and that the SSE/stream
   paths are unaffected.
4. **Perf logging.** Server: make the `AIGON_DASH_TIMING` summary fire above a wall-time threshold
   unconditionally; add `/api/status` serialize-time + byte-count logging. Client: instrument
   `poll()` phases behind a debug flag. Consider `perf_hooks.monitorEventLoopDelay()` to record p99
   event-loop lag per poll — that is the metric that directly captures the starvation seen here.

Constraints: read-only dashboard contract — none of this may mutate state. Preserve the
fingerprint-gated re-render and `DONE_CAP` display behaviour. Keep the iterate/deploy gate split;
no Playwright mid-iteration. After any `lib/*.js` edit run `aigon server restart`. If
`templates/dashboard/index.html` changes, follow the browser-MCP snapshot rule.

## Dependencies
- Builds on (already done): F467 cold-probe TTL, F468 status cache, F469 list-vs-detail split.

## Out of Scope
- SSE / delta / incremental-diff streaming of status (a natural follow-up that F469's boundary and
  this feature's fingerprint work enable, but explicitly not built here).
- Worker-thread offload of the collection pass — note it as a future option if gzip + lean done +
  pagination do not fully eliminate event-loop starvation, but do not implement it here.
- Archiving / purging old done specs from disk; the data stays, it just stops shipping in full on
  every poll.
- Any change to active-feature (`in-progress`/`in-evaluation`/`paused`) payload shape.

## Open Questions
- What recent-N done window balances "expand feels instant" against payload size? Start ~10–15.
- Should compression live at the HTTP layer (middleware over all routes) or be scoped to the status
  route only? Prefer the smallest correct surface that also covers other large JSON responses.

## Related
- Research: R47 — dashboard-perf-and-state-architecture (`docs/specs/research-topics/05-done/research-47-dashboard-perf-and-state-architecture.md`)
- Prior features: F467 (cold-probe-ttl), F468 (status-cache), F469 (list-vs-detail-split)
