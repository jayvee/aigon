---
complexity: very-high
set: specstore-git-backed-storage
depends_on: [577]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:41.659Z", actor: "cli/feature-prioritise" }
---

# Feature: specstore sync leases and reporting

## Summary
Complete the distributed SpecStore story by adding Git-backed sync ergonomics, active-work leases, and local cross-repo reporting built from fetched Aigon refs.

## User Stories
- [ ] As a user on Machine B, I am warned before starting or modifying a spec currently owned by Machine A.
- [ ] As a maintainer, I can recover from a dead machine with an auditable takeover action.
- [ ] As a user with multiple repos, I can build a local cross-repo report without an Aigon-hosted database.

## Acceptance Criteria
- [ ] Mutating commands perform backend sync before writes when using Git-ref storage, unless explicitly offline.
- [ ] Active implementation/research sessions acquire renewable leases scoped to spec key and role.
- [ ] Commands block or require explicit takeover when another active unexpired lease owns the same spec/role.
- [ ] Lease acquire, renew, release, expiry, and takeover are represented as durable events or refs with audit data.
- [ ] `aigon storage sync` fetches/pushes Aigon refs and reports conflicts clearly.
- [ ] `aigon storage doctor` validates ref reachability, duplicate events, stale projections, and lease health.
- [ ] A local portfolio/reporting command can enumerate configured repos or bare mirrors, fetch `refs/aigon/*`, and produce a merged read-only report.
- [ ] High-churn runtime data is checkpointed/summarized into durable Git-backed state without turning heartbeat ticks into noisy canonical events.
- [ ] Documentation explains Git remote permission requirements and the fact that hosting UIs may not display custom refs.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Add lease APIs to SpecStore after Git-ref backend basics exist.
- Use optimistic, auditable coordination rather than pretending Git offers hard distributed locks.
- Treat projections and cross-repo reports as rebuildable from canonical events.
- Consider bare mirrors under `~/.aigon/remotes/` for cross-repo reporting so reports do not require every worktree to be checked out.

## Dependencies
- depends_on: git-ref-specstore-backend

## Out of Scope
- A hosted Aigon database
- Real-time collaboration UI
- Replacing Git provider auth or permissions

## Open Questions
- What is the default lease TTL for interactive agent sessions, and how often should sessions renew without creating excessive Git traffic?

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1768" height="132" viewBox="0 0 1768 132" role="img" aria-label="Feature dependency graph for feature 578" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-578" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
