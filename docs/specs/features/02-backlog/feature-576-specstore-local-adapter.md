---
complexity: very-high
set: specstore-git-backed-storage
depends_on: [575]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:41.114Z", actor: "cli/feature-prioritise" }
---

# Feature: specstore local adapter

## Summary
Move workflow-core persistence behind the `SpecStore` local adapter while preserving current local JSON/file behavior. This creates the real adapter seam before any Git-ref backend is introduced.

## User Stories
- [ ] As a maintainer, I can change where spec state is stored without editing workflow transition code.
- [ ] As an agent, I can use one module to read or write spec events/snapshots.
- [ ] As a user, local Aigon behavior remains unchanged while the internals become cleaner.

## Acceptance Criteria
- [ ] Workflow event/snapshot read/write paths for feature and research go through the local `SpecStore` adapter.
- [ ] The local adapter preserves the current `.aigon/workflows/.../events.jsonl` and `snapshot.json` layout.
- [ ] Existing file-lock behavior is wrapped behind a spec-level lock method.
- [ ] Direct new imports of workflow event/snapshot file helpers are discouraged or removed from migrated paths.
- [ ] Feature and research lifecycle commands continue to work with no storage config changes.
- [ ] Tests cover local adapter reads, appends, snapshot writes, duplicate/missing file behavior, and lock behavior.
- [ ] Dashboard/read-model paths either use `SpecStore` or have an explicit compatibility reason documented.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Start with the write path: `persistEntityEvents`, feature persistence, and research persistence.
- Keep snapshots as derived local files for now.
- Keep spec markdown files in `docs/specs/...`; this feature does not move documents into another store.
- Make the smallest possible engine change: replace path/file helper calls with adapter calls while preserving semantics.
- Leave a compatibility barrel for old helpers where migration cannot be completed in one feature.

## Dependencies
- depends_on: repo-wide-spec-identity-keys

## Out of Scope
- Git refs, remote sync, leases, and cross-machine conflict handling
- Removing `.aigon/workflows`
- Changing feature/research lifecycle states

## Open Questions
- Which dashboard sync reads must remain synchronous, and should the local adapter expose sync read methods for those hot paths?

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="132" viewBox="0 0 1168 132" role="img" aria-label="Feature dependency graph for feature 576" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-576" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
