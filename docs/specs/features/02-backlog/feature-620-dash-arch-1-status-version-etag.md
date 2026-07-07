---
complexity: medium
set: dash-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:18.757Z", actor: "cli/feature-prioritise" }
---

# Feature: dash-arch-1-status-version-etag

## Summary

Give the dashboard status snapshot a server-side identity: a monotonic `statusVersion` plus a server-computed structural fingerprint, and make `/api/status` a conditional endpoint (`ETag` / `If-None-Match` → `304 Not Modified`). Today the browser polls `/api/status` every 10s (`POLL_MS` in `templates/dashboard/js/state.js`) and receives the **full** multi-repo JSON payload every time, then re-parses it and computes a client-side fingerprint (F454 `statusFingerprint()` in `init.js`) just to decide "nothing changed, skip render". Moving change detection to the server makes every unchanged poll a ~zero-cost 304, removes the duplicated fingerprint logic from the client, and provides the version primitive that the SSE push channel (dash-arch-3) needs.

This also fixes a real drift bug: `lib/dashboard-server.js` comments (F460) claim the server's 20s collection interval "aligns with `templates/dashboard/js/state.js` POLL_MS", but `state.js` still says `POLL_MS = 10000` — the browser polls twice per server collection cycle and every second poll is guaranteed-identical payload.

## User Stories

- [ ] As a dashboard user with 5 repos registered, my browser is not re-downloading and re-parsing a multi-hundred-KB JSON payload every 10 seconds while nothing is happening.
- [ ] As a dashboard user, when nothing changed I keep my scroll position, open overflow menus, and focus — exactly as the F454 fingerprint gate guarantees today — but the guarantee now comes from the server telling me nothing changed.
- [ ] As a maintainer, I can see in the `?debug=perf` instrumentation (F590) whether a poll was a 304 or a full payload, and how big the payload was.

## Acceptance Criteria

- [ ] `collectDashboardStatusData` / the poll loop in `lib/dashboard-server.js` computes a structural fingerprint of the collected snapshot server-side (port the F454 `statusFingerprint()` semantics from `templates/dashboard/js/init.js` — summary counts, per-repo entity counts, per-entity stage/state/agent-status/idle-ladder/close-failure — plus anything else that currently causes a client re-render).
- [ ] A monotonic `statusVersion` (integer, process-lifetime; resets on server restart) increments **only** when the fingerprint changes across a collection (interval poll, `pollRepoStatus`, `/api/refresh` — all paths that replace `latestStatus`).
- [ ] `/api/status` response includes `statusVersion` in the JSON body and sends `ETag: "<statusVersion>"`.
- [ ] `/api/status` with matching `If-None-Match` returns `304` with an empty body. The existing F590 request logging records 304s distinctly.
- [ ] `generatedAt` freshness: the body's `generatedAt` still updates per collection, but a `generatedAt`-only change must NOT bump the version (it is excluded from the fingerprint). The client falls back to "Updated Xs ago" derived from the last full payload — visual behaviour unchanged from today's fingerprint-gate behaviour.
- [ ] Client (`js/init.js` `poll()` + `js/api.js` `requestRefresh()`) sends `If-None-Match` with the last seen version; on 304 it skips JSON parse, skips fingerprint work, skips render, still calls `setHealth()` and timestamp refresh.
- [ ] Client-side `statusFingerprint()` and `state.lastFingerprint` are deleted (server is now authoritative). The `window.__aigonSyncStatusFingerprint` hook and its call sites go with them.
- [ ] The waiting-toast diffing in `poll()` (`flattenStatuses` previous-vs-current comparison) still fires on real transitions — it only ran on changed payloads before, and 304 means unchanged, so behaviour is preserved.
- [ ] F590 client perf line (`[aigon perf] poll ...`) reports `304` vs full-body polls.
- [ ] `/api/status` behaviour with no `If-None-Match` (curl, tests, older clients) is byte-identical to today except for the added `statusVersion` field.
- [ ] Existing dashboard e2e tests pass; add integration coverage: two consecutive GETs with `If-None-Match` where nothing changed → second returns 304; touch a spec + refresh → version bumps and full body returns.

## Validation

```bash
npm run test:iterate
```

## Technical Approach

- Compute the fingerprint once per collection inside the server poll/refresh paths (all of: `pollStatus`, `pollRepoStatus`, `refreshLatestStatus`, and the `/api/refresh` handler), storing `{ latestStatus, statusVersion, fingerprint }` together. Do NOT fingerprint per-request in the `/api/status` handler.
- Keep the pre-serialized-body optimisation from F590 (`sendJsonSerialized`): serialize once per version bump and cache the serialized body + gzipped body alongside the version, so repeat full-body requests don't re-stringify either.
- `304` handling must go through the same helper so `cache-control: no-store` + `ETag` headers stay consistent.
- Leave client `POLL_MS` at 10s — with 304s the extra polls are nearly free and keep worst-case UI latency at server-collect (≤20s) + ≤10s until dash-arch-2/3 land.
- Restart the dashboard server after `lib/*.js` edits (CLAUDE.md hot rule #3). Verify in the browser with an MCP `browser_snapshot` after client changes (hot rule #4).

## Dependencies

- None — this is the foundation feature of the set.

## Out of Scope

- Any push channel (SSE/WebSocket) — dash-arch-3.
- File watchers / collection-latency improvements — dash-arch-2.
- Per-repo delta payloads or partial responses — future work if wire size on *changed* polls becomes a problem.
- Changing what the snapshot contains.

## Open Questions

- Should the fingerprint intentionally include `updateCheck` state so the update pill refreshes without a manual reload? (Recommendation: yes, it's cheap.)
- Whether preview servers (`aigon preview`) share the same code path — they run `runDashboardServer` with a `templateRoot`, so they should inherit this for free; verify.

## Related

- Prior work: F454 (client fingerprint render gate), F460 (server poll interval), F590 (poll perf instrumentation, pre-serialized status body).
- Set: dash-arch — wave 1 (server/data plane: 1 → 2 → 3), wave 2 (client architecture: 4 → 5 → 6/7), wave 3 (assets: 8, 9).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 620" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-620" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-620)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#620</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 1 status versio…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#621</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dash arch 2 fs watch coll…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
