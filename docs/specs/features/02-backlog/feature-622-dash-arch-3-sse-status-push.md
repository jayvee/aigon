---
complexity: medium
set: dash-arch
depends_on: [620, 621]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:19.142Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-3-sse-status-push

## Summary

Add a Server-Sent Events channel (`GET /api/events`) that pushes a lightweight `status` event whenever `statusVersion` bumps (dash-arch-1), plus `server-restarting` and `notification` events. The client subscribes with `EventSource`; on a `status` event it performs the existing conditional `/api/status` fetch immediately instead of waiting for the next 10s poll tick. While the SSE connection is healthy, the client demotes its poll loop to a slow fallback (~60s); when SSE drops, it resumes 10s polling. This is the last leg of the latency chain: after dash-arch-2, the server knows about changes within ~500ms; this feature gets that knowledge to the browser within milliseconds instead of ≤10s.

SSE is chosen over extending the existing WebSocket infra (`pty-session-handler.js`) because status flow is strictly one-directional, SSE reconnects automatically for free (`EventSource` built-in retry), works through the dev proxy as plain HTTP, and needs no client library.

## User Stories

- [ ] As a user, when an agent finishes implementation, the card flips to "ready" on my dashboard within ~1 second of the status file being written.
- [ ] As a user clicking a dashboard action (Start, Close, Prioritise), the post-action state lands via push — no more watching a stale board for seconds after the toast said "Done".
- [ ] As a user whose laptop slept overnight, the dashboard silently reconnects (EventSource retry) and immediately resyncs to the current version — the health indicator never lies about connectedness.
- [ ] As a user on `aigon preview <id>` (worktree preview through the proxy), push works the same as on the primary dashboard.

## Acceptance Criteria

- [ ] `GET /api/events` streams `text/event-stream` with: `cache-control: no-store`, `connection: keep-alive`, `x-accel-buffering: no`, a `retry:` hint, an initial `status` event carrying the current `statusVersion`, a comment heartbeat every ~25s (keeps proxies from idling the connection), and correct connection cleanup on client disconnect (no leaked response objects; verify with repeated open/close).
- [ ] Every `statusVersion` bump from the single helper introduced by dash-arch-1 (initial load excluded; interval poll, watcher-triggered `pollRepoStatus`, `/api/refresh`, action-triggered refresh included) broadcasts `event: status`, `data: {"statusVersion": N}` to all connected clients. No full payload over SSE — clients fetch `/api/status` with `If-None-Match`, reusing the dash-arch-1 path and its gzip/serialization cache.
- [ ] The feature-234 restart flow emits `event: server-restarting` before the process exits, and the client shows the existing restart banner, then reconnects and resyncs when the new server is up (replacing/augmenting the current 500ms poll-hammer loop in `init.js`).
- [ ] Notification events (`emitNotification`) broadcast `event: notification` so the bell badge updates without its separate 30s `setInterval` poll in `init.js` — that interval is removed; the initial badge load stays.
- [ ] Client: an SSE manager in the dashboard JS owns the `EventSource`, exposes connection state, and drives: `status` event → conditional status fetch + render; `open` → poll interval drops to 60s fallback; `error`/closed → poll interval restores to 10s. Multiple rapid `status` events coalesce into one in-flight fetch (never stack fetches); if another status event arrives while a fetch is in flight, one follow-up fetch runs after the current one settles so the newest version is not lost.
- [ ] Health indicator (`setHealth`) reflects the real transport: "Connected (live)" when SSE is open, current poll-based states otherwise. Keep it subtle — no layout change.
- [ ] Works through the dev proxy (`isProxyAvailable` / Caddy route): confirm the proxy does not buffer SSE (set `x-accel-buffering: no` / flush headers as needed) and document any Caddy config requirement found.
- [ ] Multiple simultaneous dashboard tabs each get events; server handles ≥10 connections without measurable overhead.
- [ ] If `/api/events` is unavailable (older server, proxy strips it), the dashboard behaves exactly as today — 10s polling, no console error spam (one warning max).
- [ ] Playwright e2e: action → card updates without waiting a poll interval (assert update visible well under the 10s poll period); SSE-blocked fallback test keeps polling behaviour green.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Server: keep a `Set` of open SSE responses in `runDashboardServer` scope; broadcast helper `broadcastEvent(name, data)` called from the single place `statusVersion` bumps (dash-arch-1 centralised that) and from `emitNotification` / restart marker path. Heartbeat via one shared 25s interval (`.unref()`).
- The route must bypass any JSON helpers — raw `res.writeHead(200, {...})` + `res.write` per event, `req.on('close')` for cleanup. Check `lib/dashboard-server.js` request logging so `/api/events` doesn't spam the quiet-path log (add it to the `isQuiet` list).
- Client: put the SSE manager in its own module (`js/live.js` or fold into `js/api.js`), wired from `init.js`. Do not touch render paths — this feature only changes *when* the existing fetch+render runs.
- Keep the existing `POLL_MS` machinery as the fallback loop; implement interval switching as a single `setPollInterval(ms)` helper rather than scattered `setInterval` juggling.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3); verify with MCP `browser_snapshot` (hot rule #4).

## Dependencies

- depends_on: dash-arch-1-status-version-etag
- depends_on: dash-arch-2-fs-watch-collection

## Out of Scope

- Sending status payloads or deltas over the SSE channel itself — version ping + conditional fetch only.
- Replacing the PTY WebSocket terminal transport.
- Push for auxiliary endpoints (`/api/sessions`, analytics, insights) — their views still fetch on demand.
- Browser Notifications API / desktop notifications.

## Open Questions

- Should `budget-widget.js` and `aigon-status-pill.js` (which have their own fetch cadences) hook the same `status` event? Nice if trivial; otherwise leave and note as follow-up in the feature log.
- EventSource max reconnect backoff — default browser behaviour is fine; only tune if the restart-banner UX needs a faster first retry (`retry: 1000`).

## Related

- Prior work: feature 234 (server-restart banner + poll-hammer reconnect), F445/auto-nudge (notification emission paths), F590 (status serialization cache this reuses).
- Set: dash-arch — wave 1 (server/data plane: 1 → 2 → 3). This completes the latency chain: fs event → ~500ms collect → ~0ms push → conditional fetch → render.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 622" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-622" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-622)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-622)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-622)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#620</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 1 status versio…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#621</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 2 fs watch coll…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#622</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 3 sse status pu…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
