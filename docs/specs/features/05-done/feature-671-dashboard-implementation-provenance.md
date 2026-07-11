---
aigon_id: F671
complexity: medium
depends_on: [596]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-11T23:12:54.829Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-implementation-provenance

## Summary

Show **which machine and operator implemented a feature** in the dashboard detail drawer — including after close, when active leases are gone. F596 already surfaces active lease holder/user on cards and in the Status tab Lock section while work is in flight; this feature closes the gap for **done** features and makes lease events readable in the Events timeline. Multi-machine repos (e.g. brewboard-sync-test) need a durable answer to "who did this?" visible on both clones after sync.

## User Stories

- [ ] As a user with two machines syncing the same repo, I can open a **done** feature's detail drawer and see which machine and git user implemented it without parsing events.jsonl.
- [ ] As a user reviewing the Events tab, I can see lease acquire/release events attributed to `user @ machine` instead of generic `system`.
- [ ] As a user on either machine after `storage sync`, I see the same implementation provenance because it is persisted in synced workflow state (stats), not derived only from local tmux/session state.

## Acceptance Criteria

- [ ] **Status tab → Identity section** includes an **Implemented by** row when provenance is known, formatted consistently with existing lease labels (`user @ machine (AGENT)` via `formatLeaseHolderLabel` semantics).
- [ ] The drawer presentation distinguishes durable implementation provenance from active lease state: **Implemented by** appears in Identity as a stable historical fact; the existing **Lock** section continues to represent only active leases and must not be shown for closed features merely to display provenance.
- [ ] The Identity row includes a subdued source hint when useful: `from close stats` when read from `stats.json`, `from lease history` when derived read-only from workflow events, and no hint for active in-progress lease provenance.
- [ ] For **in-progress** features, provenance comes from the active `impl` lease (same source as the Lock section).
- [ ] For **done/closed** features, provenance is durable: written to `stats.json` at close from the impl lease (`holderId`, `user`, `agentId`) and exposed through `collectFeatureDeepStatus` / `/api/status` deep-status endpoint.
- [ ] **Events tab** decorates `lease.acquired`, `lease.renewed`, `lease.released`, and `lease.taken_over` with human-readable labels and actor `user @ holderId` (agent appended when present).
- [ ] Lease event summaries include the lease role (`impl`, `close`, etc.) and TTL/expiry when present so the timeline remains understandable without opening raw JSON.
- [ ] **Backfill path**: when stats lack provenance but events contain an impl `lease.acquired`, deep-status derives it read-only (no silent mutation on read); `aigon doctor --fix` or close-time write is the durable repair for already-closed features.
- [ ] New/changed status fingerprint fields added to `computeStatusFingerprint` if list-card payloads gain provenance (optional — drawer-only is acceptable for v1).
- [ ] Integration test: fixture with impl lease events → close persists `implementedBy` in stats → deep-status API returns it → Events tab decoration covered by server-side unit test on `decorateDetailEvent`.
- [ ] `feature-status` CLI human output includes Implemented by when present.

## Validation

```bash
node -c aigon-cli.js
npm run test:related -- lib/feature-status.js lib/feature-close.js lib/dashboard-detail.js templates/dashboard/js/detail-tabs.js
```

## Pre-authorised

- Skip full Playwright browser suite mid-iteration; run `npm run test:iterate` only until implementation-complete.

## Technical Approach

**Write path (close):** In `feature-close` final stats snapshot, resolve impl lease holder from the active lease at close time or the last impl `lease.acquired` event in the workflow log. Merge into stats:

```json
"implementedBy": { "holderId": "docker-machine-b", "user": "testuser-b@example.com", "agentId": "cu" }
```

Mirror for research close if research uses impl leases the same way.

**Read path (deep status):** Extend `collectFeatureDeepStatus` identity block with `implementedBy` — prefer stats, fall back to scanning events once. Frontend `renderStatus` adds Identity rows; no frontend-only inference from raw events.

Suggested shape:

```json
"implementedBy": {
  "holderId": "docker-machine-b",
  "user": "testuser-b@example.com",
  "agentId": "cu",
  "source": "stats",
  "acquiredAt": "2026-07-11T23:10:00.000Z"
}
```

Use `source: "active-lease"` for in-progress rows and `source: "event-history"` for read-only fallback. Omit unknown keys rather than inventing placeholder values.

## Drawer Design Notes

The least surprising layout is:

1. Keep **Identity** as the place for durable facts: ID, name, lifecycle, mode, primary agent, **Implemented by**, and worktree when applicable.
2. Keep **Lock** as the place for live coordination state only. Active leases can still show `this machine` / `active` / `stale`; done features should not get a fake lock card.
3. Render **Implemented by** as a compact two-line value when there is enough data:

   - primary line: `testuser-b@example.com @ docker-machine-b (CU)`
   - secondary line: `from close stats · acquired Jul 12, 2026, 9:10 AM`

4. Use the same visual density as existing `stats-row` values. Do not introduce a large hero card or badge-heavy treatment inside the detail drawer; this is audit metadata, not the main workflow state.

If a richer affordance is desired later, add a small `Provenance` section above `Identity` only for closed features, with exactly two rows: **Implemented by** and **Closed by**. That should be a follow-up unless **Closed by** is added in this feature.

**Events decoration:** Extend `decorateDetailEvent` in `lib/dashboard-detail.js` for `lease.*` types — reuse holder label helper shared with dashboard `formatLeaseHolderLabel` (extract to a small shared module or duplicate minimally in server decorator).

**Do not** add provenance to `feature.started` events in v1 unless needed — lease events already carry holder/user and are the authoritative audit trail.

## Dependencies

- depends_on: dashboard-storage-status-and-lease-visibility (F596 — active lease display patterns)

## Out of Scope

- Pipeline card badges for done-feature machine names (drawer-only for v1).
- Dashboard takeover/cancel lease controls.
- Changing lease TTL or holder-id resolution (`AIGON_MACHINE_ID` / `machineId` config).
- Provenance for spec-review-only work with no impl lease (follow-up if needed).

## Resolved decisions

- **Closed by** is out of scope for v1 (follow-up). Identity shows **Implemented by** only; close-role lease holder stays in Events decoration.
- Research entities reuse the same `implementedBy` stats field and Identity row label — research `impl` leases use the same lease role semantics.

## Related

- Prior work: F596 (active lease visibility), F612/F598 (two-clone harness — brewboard-sync-test validation repo)
- Incident: brewboard-sync-test feature 13 — `lease.acquired` records `docker-machine-b` / `testuser-b@example.com` but drawer Status/Events tabs show only `cu` / `system` after close.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="2668" height="132" viewBox="0 0 2668 132" role="img" aria-label="Feature dependency graph for feature 671" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-671" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-671)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#671</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard implementation …</text><text x="2436" y="90" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
