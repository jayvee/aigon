---
complexity: very-high
set: specstore-git-backed-storage
depends_on: [576]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:41.385Z", actor: "cli/feature-prioritise" }
---

# Feature: git ref specstore backend

## Summary
Add an experimental `git-ref` SpecStore backend that stores canonical spec state in Git refs under `refs/aigon/specs/...`, making GitHub/GitLab/Bitbucket the distributed storage and sync substrate instead of an Aigon-operated database.

## User Stories
- [ ] As a user working from two machines, I can sync Aigon spec state through the Git remote.
- [ ] As a maintainer, I can inspect Aigon state using normal Git plumbing.
- [ ] As an operator, I can opt into Git-backed storage per repo without changing feature/research workflows.

## Acceptance Criteria
- [ ] Project config supports selecting `storage.backend: git-ref` with a remote and ref prefix.
- [ ] The Git-ref backend implements the same `SpecStore` interface as the local adapter for feature and research specs.
- [ ] Canonical per-spec state is written under `refs/aigon/specs/<key>/meta` or a documented equivalent.
- [ ] Events are append-only and idempotent by event ID.
- [ ] Push rejection is handled as a normal optimistic-concurrency path: fetch, replay/merge, retry, then fail clearly if unresolved.
- [ ] The backend fetches and pushes explicit `refs/aigon/*` refspecs; users do not need to run custom Git commands manually.
- [ ] `aigon storage status` or equivalent shows backend, remote, last sync, and health.
- [ ] Local `.aigon/workflows` files remain usable as caches/projections or compatibility exports.
- [ ] Tests cover ref naming, event serialization, duplicate event handling, and rejected push/retry behavior using a local bare remote.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Use Git plumbing (`hash-object`, `mktree`/`commit-tree`, `update-ref`, fetch, push) through focused helper modules.
- Keep commit/event format documented and versioned.
- Store large payloads as tree blobs when needed; small events may live in commit bodies if that remains inspectable and robust.
- Do not rely on Git notes as the canonical store; reserve notes for optional commit annotations later.
- Start experimental and opt-in only.

## Dependencies
- depends_on: specstore-local-adapter

## Out of Scope
- Cross-repo portfolio reporting
- Distributed active-work leases
- Linear/Jira integrations
- Making Git-ref the default backend

## Open Questions
- Should the first implementation store one event per commit or batch multiple events per commit when a command appends several events atomically?

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1768" height="132" viewBox="0 0 1768 132" role="img" aria-label="Feature dependency graph for feature 577" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-577" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
