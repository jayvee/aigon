---
complexity: high
set: git-backed-storage-hardening
depends_on: [595]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:38:28.346Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard storage status and lease visibility

## Summary

Expose git-backed storage state in the dashboard. Users should be able to see whether a repo is using local or git-ref storage, whether it is ahead/behind/degraded, and whether a feature or research item has an active lease held by another machine/agent. The CLI already has `aigon storage status`, `aigon storage report`, and `aigon board --storage`; the dashboard should surface the same server-owned information without frontend-only inference.

## User Stories

- [ ] As a user, I can open the dashboard and see whether each repo is using local or git-ref storage.
- [ ] As a user with two machines, I can see that feature 10 is leased by machine A and avoid accidentally trying to start it on machine B.
- [ ] As a user, I can trigger a storage sync or inspect storage health without leaving the dashboard.

## Acceptance Criteria

- [ ] Repo status/settings payloads include `storage.backend`, and for git-ref repos include remote, ref prefix, offline flag, last sync time, ahead/behind counts, health, and last error.
- [ ] The dashboard Settings or repo header displays storage backend and health in a read-only status section.
- [ ] Feature/research card or detail payloads include active lease metadata when present: spec key, role, holder id, agent id, acquired time, expiry time, and expired flag.
- [ ] Feature/research cards or detail drawer render active leases in a compact, readable way, including holder machine and agent.
- [ ] Dashboard has explicit actions for `storage sync`, `storage doctor`, and `storage report` where appropriate, implemented through existing server action boundaries rather than frontend shell strings.
- [ ] Local-backend repos show a clear "local" state and do not render irrelevant git-ref details.
- [ ] Tests cover API payload shape and at least one rendered dashboard state for a git-ref repo with an active lease.

## Validation

```bash
node -c aigon-cli.js
npm run test:related -- lib/dashboard-status-collector.js lib/dashboard-settings.js lib/dashboard-routes templates/dashboard/js
MOCK_DELAY=fast npm run test:browser:smoke
```

## Technical Approach

Server owns all storage and lease derivation. Use `resolveStorageConfig()`, `createSpecStore().health()`, and `readLeases()` from `lib/spec-store/` to build DTOs in dashboard read paths. Prefer adding a focused helper so the collector and detail endpoints do not duplicate storage logic.

For lease display, do not parse raw refs in the browser. Attach active lease metadata to feature/research rows from the server, or expose it through the detail payload if card payload size becomes a concern.

For actions, route through dashboard action helpers and existing CLI command implementation where possible. Keep operations explicit and safe: sync/report/doctor are fine; takeover should remain CLI-only unless a separate UX is designed.

## Dependencies

- depends_on: canonical-stats-sync-for-git-backed-storage

## Out of Scope

- Changing lease semantics.
- Adding dashboard takeover/cancel lease controls.
- Making git-ref storage default.

## Open Questions

- Should storage status live in Settings, repo header, or both?
- Should lease badges appear on cards, only in detail drawer, or both?

## Related

- Set: git-backed-storage-hardening
- Prior features: F573-F578
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="2368" height="132" viewBox="0 0 2368 132" role="img" aria-label="Feature dependency graph for feature 596" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-596" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-596)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
