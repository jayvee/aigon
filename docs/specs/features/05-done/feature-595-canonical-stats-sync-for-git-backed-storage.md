---
complexity: high
set: git-backed-storage-hardening
depends_on: [578]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:38:28.034Z", actor: "cli/feature-prioritise" }
---

# Feature: canonical stats sync for git backed storage

## Summary

Make closed feature/research stats converge across machines when a repo uses git-ref SpecStore. Today workflow events, snapshots, and leases can sync through `refs/aigon/specs/*`, but `.aigon/workflows/{features,research}/<id>/stats.json` and `.aigon/cache/stats-aggregate.json` remain local analytics artifacts. This means machine A and machine B can agree on lifecycle state while Reports/analytics diverge. This feature promotes stats into the canonical git-backed storage path or makes them reproducibly rebuilt from canonical events.

## User Stories

- [ ] As a user working across two machines, when feature 10 closes on machine A, machine B eventually sees the same cost, duration, commit, agent, and token stats after storage sync.
- [ ] As a user viewing Reports, aggregate stats are derived from shared canonical data rather than whichever machine happened to close the feature.
- [ ] As a maintainer, the stats storage contract is explicit: canonical payload, local projection, cache invalidation, and doctor repair behavior are all documented and tested.

## Acceptance Criteria

- [ ] A canonical representation for stats exists in SpecStore for numbered feature and research specs. It may be a dedicated `stats.recorded` event, a typed payload under the existing events ref, or another explicit SpecStore method, but it must sync through git-ref storage.
- [ ] `feature-close` and `research-close` write stats to the canonical path when `storage.backend === 'git-ref'`, while preserving existing local `stats.json` compatibility.
- [ ] `aigon storage sync` rebuilds or refreshes local `.aigon/workflows/**/stats.json` projections from canonical stats data.
- [ ] `.aigon/cache/stats-aggregate.json` is invalidated or rebuilt when canonical stats imported from sync are newer than the cache.
- [ ] Local backend behavior remains unchanged and existing stats tests still pass.
- [ ] `aigon storage doctor` detects projection drift where canonical stats and local `stats.json` disagree, and `--fix` repairs safe drift.
- [ ] Tests cover two cloned repos: machine A records stats for one feature, machine B records stats for another, both sync, and both repos compute matching aggregate stats.

## Validation

```bash
node -c aigon-cli.js
node tests/unit/spec-store.test.js
node tests/unit/spec-store-git-ref.test.js
node tests/unit/spec-store-leases.test.js
node tests/integration/stats-aggregate.test.js
npm run test:related -- lib/spec-store lib/feature-close.js lib/feature-status.js lib/stats-aggregate.js
```

## Technical Approach

Start by auditing `lib/feature-close.js`, `lib/feature-status.js`, `lib/stats-aggregate.js`, `lib/spec-store/git-ref-backend.js`, and `lib/spec-store/projection.js`.

Preferred shape: append a typed, idempotent stats event keyed by spec key, such as `stats.recorded`, with a deterministic event id based on `{key, statsVersion, completedAt}` or a stable hash of the stats payload. The git-ref backend already merges by event id, so stats sync should reuse the same dedupe model. The local projection rebuild should write `stats.json` from the latest canonical stats event.

Do not make `.aigon/cache/stats-aggregate.json` canonical. It is a derived per-repo cache and should remain disposable.

## Dependencies

- depends_on: specstore-sync-leases-and-reporting

## Out of Scope

- Uploading transcripts or raw agent logs.
- Making normal Git working-tree changes sync through SpecStore.
- Changing pricing or telemetry parsing semantics.

## Open Questions

- Should stats be stored as standalone typed events in each spec event log, or should SpecStore grow a separate stats payload API?
- Should imported stats projections preserve original file mtime semantics or explicitly touch the file to trigger cache invalidation?

## Related

- Set: git-backed-storage-hardening
- Prior features: F573-F578
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="3268" height="132" viewBox="0 0 3268 132" role="img" aria-label="Feature dependency graph for feature 595" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-595" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 2644 66 C 2684 66, 2684 66, 2724 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><path d="M 2944 66 C 2984 66, 2984 66, 3024 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-595)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#597</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">storage convert command f…</text><text x="2436" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="2724" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2736" y="48" font-size="14" font-weight="700" fill="#0f172a">#598</text><text x="2736" y="70" font-size="13" font-weight="500" fill="#1f2937">git backed storage two cl…</text><text x="2736" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="3024" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="3036" y="48" font-size="14" font-weight="700" fill="#0f172a">#599</text><text x="3036" y="70" font-size="13" font-weight="500" fill="#1f2937">document specstore git re…</text><text x="3036" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
