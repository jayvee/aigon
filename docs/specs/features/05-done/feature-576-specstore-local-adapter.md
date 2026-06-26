---
complexity: high
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
- [ ] Migration happens at the **engine persistence layer**, not at each caller. The functions in `lib/workflow-core/engine.js` that own event/snapshot/lock I/O — `persistEvents`, `persistResearchEvents`, the underlying `applyEventsUnlocked`/`writeSnapshot`, and the lock wrappers (`withFeatureLockRetry`/`tryWithFeatureLock`) — read and write through the local `SpecStore` adapter's methods (`readEvents`/`appendEvent`, `readSnapshot`/`writeSnapshot`, `lock`) from 573's `lib/spec-store/`. Existing callers (`persistEntityEvents`, `entity.js`, `feature-close.js`, `nudge.js`, `quota-mid-run-detector.js`, `agent-resume.js`, `commands/research.js`) keep their current signatures and are not edited.
- [ ] The local adapter preserves the current on-disk layout byte-for-byte: `.aigon/workflows/<feature|research>/<id>/events.jsonl` (append-only JSONL) and `snapshot.json`, produced via the same `paths.js` helpers (`getFeatureWorkflowPaths` / `getEntityWorkflowPaths`).
- [ ] Existing file-lock behavior (`.lock` file, retry/backoff in `withFeatureLockRetry`) is wrapped behind the adapter's `lock` method with identical retry and busy semantics; concurrent persist still serializes per spec.
- [ ] Migrated engine paths import the adapter, not the raw helpers: a grep over the migrated engine code finds no direct `event-store`/`snapshot-store`/`lock` file-helper imports outside the `SpecStore` local backend itself. Where a non-engine path cannot migrate in this feature, it routes through a documented compatibility barrel rather than re-importing raw helpers.
- [ ] Feature and research lifecycle commands (`feature-start`, `feature-do`, `feature-close`, `research-start`, `research-do`, `research-close`) continue to work with no storage config changes; existing `.aigon/workflows` state is read without migration.
- [ ] Tests cover local adapter reads, appends, snapshot writes, missing-file (returns empty/initial, not throw), duplicate/idempotent append, and lock/serialization behavior.
- [ ] **Dashboard sync reads (resolves Open Question):** the local adapter exposes synchronous read methods (`readEventsSync`/`readSnapshotSync`) for the hot read paths in `lib/dashboard-status-collector.js` and `lib/workflow-read-model.js`; those collectors call the adapter rather than `fs` directly, or carry an explicit `// SpecStore-exempt:` comment naming why. No collector regresses to direct `fs.readFileSync` on workflow files without such a comment.

## Validation
```bash
node -c aigon-cli.js
npm run test:core
```
This is non-browser engine work; `test:core` (lint + integration + workflow) is the right gate. The suite must include the adapter read/append/snapshot/lock cases listed above and a workflow round-trip proving `.aigon/workflows` layout is unchanged.

## Technical Approach
- Start with the write path: `persistEntityEvents`, feature persistence, and research persistence.
- Keep snapshots as derived local files for now.
- Keep spec markdown files in `docs/specs/...`; this feature does not move documents into another store.
- Make the smallest possible engine change: replace path/file helper calls with adapter calls while preserving semantics.
- Leave a compatibility barrel for old helpers where migration cannot be completed in one feature.

## Dependencies
- depends_on: repo-wide-spec-identity-keys (575) — set-chain ordering.
- **Real technical prerequisite: 573 (`specstore architecture foundation`).** This feature routes live persistence through the `lib/spec-store/` adapter and its `readEvents`/`appendEvent`/`writeSnapshot`/`lock` methods, which 573 creates. 573 is satisfied transitively via the linear set chain (573 → 574 → 575 → 576), so `depends_on` stays `[575]`; do not start 576 until 573 has shipped the adapter. Note: 575 (identity keys) is not a functional input to this feature.

## Out of Scope
- Git refs, remote sync, leases, and cross-machine conflict handling
- Removing `.aigon/workflows`
- Changing feature/research lifecycle states

## Open Questions
- ~~Which dashboard sync reads must remain synchronous, and should the local adapter expose sync read methods for those hot paths?~~ **Resolved in Acceptance Criteria:** the adapter exposes `readEventsSync`/`readSnapshotSync`; `dashboard-status-collector.js` and `workflow-read-model.js` use them (or carry a `// SpecStore-exempt:` comment). No async conversion of those hot paths in this feature.

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="2068" height="132" viewBox="0 0 2068 132" role="img" aria-label="Feature dependency graph for feature 576" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-576" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-576)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
