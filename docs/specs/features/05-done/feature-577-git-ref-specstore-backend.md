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
- [ ] Project config supports selecting `storage.backend: git-ref` with concrete keys: `storage.git.remote` (remote name or URL) and `storage.git.refPrefix` (default `refs/aigon/specs`). Absent config keeps the local adapter (576) as the default backend; no behavior change for repos that do not opt in.
- [ ] The Git-ref backend implements the **same `SpecStore` method set as 576's local adapter**: `readEvents`/`appendEvent`, `readSnapshot`/`writeSnapshot`, `lock`, and the synchronous reads `readEventsSync`/`readSnapshotSync`. It is selected at the same adapter seam, so migrated engine paths and dashboard collectors call it through the existing interface with no caller edits.
- [ ] **Sync reads never block on the network.** `readEventsSync`/`readSnapshotSync` are served from the local `.aigon/workflows` projection (the cache), never from synchronous fetch/network I/O. Remote `fetch`/`push` are explicit async operations; the dashboard hot read paths from 576 (`dashboard-status-collector.js`, `workflow-read-model.js`) keep working unchanged against the local projection.
- [ ] **Canonical vs derived boundary:** the append-only event log is canonical and lives in Git refs under `<refPrefix>/<key>/...` (e.g. `refs/aigon/specs/<key>/events`). Snapshots are derived locally from the event log and are not the canonical source; `<key>` is the 575 identity key (numeric ID remains valid via 575's resolver).
- [ ] Events are append-only and idempotent by event ID; replaying or re-pushing a known event ID is a no-op (no duplicate appended).
- [ ] Push rejection is handled as a normal optimistic-concurrency path: fetch, merge the remote and local event logs by **union/dedupe on event ID** (stable order preserved), re-derive the local snapshot, retry the push, then fail clearly with an actionable message if still unresolved after a bounded number of retries.
- [ ] The backend fetches and pushes explicit `<refPrefix>/*` refspecs; users do not need to run custom Git commands manually.
- [ ] The `lock` method retains 576's local file-lock serialization semantics (per-spec, retry/backoff) for same-machine concurrency; cross-machine concurrency is handled solely by the push-rejection/retry path above — there is no remote advisory lock in this feature (distributed leases are 578).
- [ ] **Sync trigger is explicit:** `aigon storage sync` performs an on-demand fetch+push for `<refPrefix>/*`, and the backend fetches/pushes at documented command boundaries (e.g. after a lifecycle command appends events). Automatic scheduling, lease coordination, and cross-repo reporting are out of scope (578).
- [ ] `aigon storage status` shows backend, remote, ref prefix, last successful sync time, and ahead/behind/health state. (Richer cross-repo reporting is 578.)
- [ ] Local `.aigon/workflows` files remain usable as the read cache/projection and as compatibility exports; they are rebuilt from the canonical refs and are safe to delete and regenerate.
- [ ] Tests cover, using a **local bare remote**: ref naming, event serialization round-trip, duplicate/idempotent event handling, the rejected-push → fetch → merge-by-event-ID → retry path, and that sync reads resolve from the local projection without network access.

## Validation
```bash
node -c aigon-cli.js
npm run test:core
```
This is non-browser engine work; `test:core` (lint + integration + workflow) is the right gate. The suite must include the local-bare-remote cases listed in the Acceptance Criteria (ref naming, round-trip, idempotent append, rejected-push/merge/retry, and sync-read-from-projection).

## Technical Approach
- Use Git plumbing (`hash-object`, `mktree`/`commit-tree`, `update-ref`, fetch, push) through focused helper modules.
- Keep commit/event format documented and versioned (include a format version in the event/commit payload so future migrations are detectable).
- Store large payloads as tree blobs when needed; small events may live in commit bodies if that remains inspectable and robust.
- After every successful fetch/merge/append, re-derive the local `.aigon/workflows` projection so sync reads stay correct; treat the projection as disposable and rebuildable from refs.
- Merge is deterministic: union the local and remote event logs, dedupe by event ID, preserve stable ordering, then re-derive the snapshot — no interactive Git merge of refs.
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
- Should the first implementation store one event per commit or batch multiple events per commit when a command appends several events atomically? (Either is acceptable provided idempotency and the merge-by-event-ID semantics in the Acceptance Criteria hold; batching is preferred when a single command appends several events atomically.)

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="3268" height="132" viewBox="0 0 3268 132" role="img" aria-label="Feature dependency graph for feature 577" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-577" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 1744 66 C 1784 66, 1784 66, 1824 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 2044 66 C 2084 66, 2084 66, 2124 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 2344 66 C 2384 66, 2384 66, 2424 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 2644 66 C 2684 66, 2684 66, 2724 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><path d="M 2944 66 C 2984 66, 2984 66, 3024 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-577)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1824" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="1836" y="48" font-size="14" font-weight="700" fill="#0f172a">#595</text><text x="1836" y="70" font-size="13" font-weight="500" fill="#1f2937">canonical stats sync for …</text><text x="1836" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="2124" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2136" y="48" font-size="14" font-weight="700" fill="#0f172a">#596</text><text x="2136" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard storage status …</text><text x="2136" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2424" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2436" y="48" font-size="14" font-weight="700" fill="#0f172a">#597</text><text x="2436" y="70" font-size="13" font-weight="500" fill="#1f2937">storage convert command f…</text><text x="2436" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="2724" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="2736" y="48" font-size="14" font-weight="700" fill="#0f172a">#598</text><text x="2736" y="70" font-size="13" font-weight="500" fill="#1f2937">git backed storage two cl…</text><text x="2736" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="3024" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="3036" y="48" font-size="14" font-weight="700" fill="#0f172a">#599</text><text x="3036" y="70" font-size="13" font-weight="500" fill="#1f2937">document specstore git re…</text><text x="3036" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
