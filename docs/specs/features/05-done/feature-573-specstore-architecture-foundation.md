---
complexity: high
set: specstore-git-backed-storage
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-21T13:13:40.321Z", actor: "cli/feature-prioritise" }
---

# Feature: specstore architecture foundation

## Summary
Define Aigon's next storage architecture around a `SpecStore` boundary. Aigon is an SDD tool, so the durable work object should be a spec, not a generic entity or a workflow-specific file path. This feature introduces the vocabulary, module boundary, and non-behavior-changing local implementation skeleton that later features can build on.

## User Stories
- [ ] As a maintainer, I can point implementers at one storage boundary for durable spec state instead of having them read scattered workflow path/file code.
- [ ] As an agent, I can tell that specs are the top-level durable objects and feature/research are spec kinds.
- [ ] As a future backend implementer, I can add a storage backend without changing command modules, dashboard collectors, and workflow transition logic directly.

## Acceptance Criteria
- [ ] A design note is added at `docs/specstore-architecture.md` (linked from `docs/architecture.md`) describing the target model: `Spec`, spec kinds (`feature`, `research`), spec keys (`F42`, `R43`), events, snapshots, leases, indexes, and projections. It must state the intended layering (SpecStore = durable storage protocol; workflow-core = lifecycle semantics; spec files = projections; folders = derived from lifecycle).
- [ ] The design explicitly states that feedback is not a top-level spec kind; customer feedback is represented as research origin/source metadata.
- [ ] A `lib/spec-store/` module exists with a documented interface and a local backend placeholder/wrapper, but no Git-ref backend behavior yet.
- [ ] The interface is spec-shaped, not generic CRUD. Name the methods explicitly and the existing `lib/workflow-core/` helper each thin-wraps or stubs:
  - `listSpecs` / `readSpec` — delegate to existing path/read helpers (`lib/workflow-core/paths.js`).
  - `readEvents` / `appendEvent` — delegate to `lib/workflow-core/event-store.js`.
  - `readSnapshot` / `writeSnapshot` — delegate to `lib/workflow-core/snapshot-store.js`.
  - `lock` — delegate to `lib/workflow-core/lock.js`.
  - `sync` / `health` — no-op stubs in this feature (document return shape, e.g. `{ ok: true, backend: 'local' }`); they exist to pin the interface, not to do work yet.
- [ ] Existing workflow-core callers are not migrated in this feature unless needed for the skeleton; behavior remains unchanged. Existing event/snapshot/lock files under `lib/workflow-core/` keep their current callers and are not renamed.
- [ ] A test (`test/` or co-located) requires `lib/spec-store/index.js`, asserts the documented method names are all present as functions, and asserts that requiring the module performs no filesystem writes or other side effects.
- [ ] Spec key parsing/formatting round-trips: a test asserts `format(parse('F42'))` and `format(parse('R43'))` are stable, and that a malformed key (e.g. `X1`, `F`, empty) throws or returns a documented error rather than silently coercing.
- [ ] Existing `npm test` and `node -c aigon-cli.js` still pass.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- Add `lib/spec-store/index.js` plus focused files for interface validation, spec key parsing/formatting, and local backend construction.
- Keep the first implementation deliberately thin: it delegates to the current `lib/workflow-core/` helpers (`paths.js`, `event-store.js`, `snapshot-store.js`, `lock.js`). Do not duplicate or reimplement their logic — the SpecStore is a façade over them, not a fork.
- The local backend is the only backend wired in this feature; `index.js` should expose a constructor/selector that returns it (so a future Git-ref backend slots in without changing callers), but ship only the local one.
- Document the intended layering:
  - `SpecStore` owns durable storage protocol.
  - workflow-core owns lifecycle semantics.
  - spec files remain human/agent-facing projections.
  - folders are derived from lifecycle, not authoritative state.
- Avoid changing storage behavior in this feature; the value is naming the boundary and preventing later features from inventing incompatible abstractions.

## Dependencies
- None

## Out of Scope
- Moving workflow-core onto `SpecStore`
- Adding repo-wide numbering
- Removing feedback commands
- Git refs, leases, cross-machine sync, or reporting

## Open Questions
- Should the design use `refs/aigon/specs/<key>/meta` or `refs/aigon/specs/<uuid>/meta` as the long-term Git-ref path? Capture a recommendation, but do not implement it here.

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="2368" height="132" viewBox="0 0 2368 132" role="img" aria-label="Feature dependency graph for feature 573" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-573" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-573)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
