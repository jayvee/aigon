---
complexity: very-high
set: git-branch-storage
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-05T13:12:20.614Z", actor: "cli/feature-prioritise" }
---

# Feature: git-branch-backend-core

## Summary
Add a new `git-branch` SpecStore backend that stores canonical spec state as a **file tree on an orphan branch** (default name `aigon-state`) instead of one custom ref per spec. This is the successor to the `git-ref` backend: same durability model (canonical append-only events, local `.aigon/workflows/**` projection cache), but state lives on an ordinary branch — browsable in the forge UI, immune to custom-ref namespace rulesets, and shaped so a follow-on feature can add per-spec lease files with compare-and-swap (CAS) write semantics. This feature delivers the backend core and event storage only; leases keep their current advisory behaviour (shared `lease-api.js` over `readEvents`/`appendEvent`) until `git-branch-cas-leases` lands. The `git-ref` backend remains untouched and selectable in this feature; its removal is a separate set member.

## User Stories
- [ ] As a developer on a team, I can enable `git-branch` storage so my repo's spec lifecycle events sync through the same remote everyone already uses, with no custom ref namespaces involved.
- [ ] As a developer, I can browse the `aigon-state` branch on GitHub/GitLab and see per-spec event logs as ordinary files, so I can inspect state without aigon installed.
- [ ] As a developer working across two machines, events I record on machine A appear on machine B after sync, and vice versa, with no lost or duplicated events.

## Acceptance Criteria
- [ ] `resolveStorageConfig` accepts `storage.backend: "git-branch"` with `storage.git.remote`, `storage.git.branch` (default `"aigon-state"`), and `storage.git.offline`; unknown backends still coerce to `local`.
- [ ] `createSpecStore` returns a `git-branch` backend that passes `assertSpecStoreInterface` (full `SPEC_STORE_METHODS` contract: listSpecs, readSpec, readEvents/readEventsSync, appendEvent, readSnapshot/readSnapshotSync, writeSnapshot, lock, sync, health, and the lease helpers via the existing shared `createLeaseApi`).
- [ ] Branch tree layout is exactly: `meta.json` (see below) and `specs/<KEY>/events.jsonl` (e.g. `specs/F42/events.jsonl`). A `leases/` directory is documented as reserved but not written by this feature. `meta.json` includes `{ schemaVersion, backend: "git-branch", branch, remote }`; `sync()` fails loudly when the branch's `schemaVersion` is newer than this aigon build understands (no silent downgrade).
- [ ] Canonical `events.jsonl` carries workflow, lease, and `stats.recorded` events in one stream per spec (same as git-ref). After every merge/append/sync rebuild, `rebuildStatsProjectionForKey` runs so `.aigon/workflows/**/stats.json` and the stats aggregate cache stay aligned with canonical events (F595 parity).
- [ ] `readSnapshot` / `writeSnapshot` / `lock` remain **local-projection-only** (delegate to the local backend, same as git-ref today). Snapshots are never written to the branch tree.
- [ ] The branch is created as an **orphan** (no parent from `main`) on first write and is **never checked out** into the user's working tree — all reads/writes go through git plumbing (`hash-object`, `mktree`, `commit-tree`, `ls-tree`, `cat-file`). `git status` in the user's worktree is unaffected by any storage operation.
- [ ] `appendEvent` follows the git-ref backend's discipline: pre-write fetch+merge unless offline, append to the spec's `events.jsonl` in a new commit on the branch tip, push. On push rejection: fetch, union-merge events by event id (reuse `event-merge.js`), create a merge commit, re-push.
- [ ] `sync()` fetches `refs/heads/<branch>` from the remote, union-merges any divergent event files, rebuilds the local `.aigon/workflows/**` projection (reuse `projection.js`), pushes, and records sync state (reuse `sync-state.js`). `readEventsSync`/`readSnapshotSync` never hit the network.
- [ ] Offline behaviour matches git-ref today: `storage.git.offline: true`, `--offline`, or `AIGON_STORAGE_OFFLINE=1` skips fetch/push for event writes; queued state pushes on next online sync.
- [ ] Two clones of the same remote, each appending distinct events to the same spec while the other is unsynced, converge to identical `events.jsonl` content (same ids, no duplicates) after both sync — covered by an integration test using a local bare remote fixture.
- [ ] `health()` reports backend name, branch, remote reachability, and last-sync info in the same shape the dashboard/status paths consume today.
- [ ] First-enable import: when the backend is enabled on a repo with existing local `.aigon/workflows/**` events, the first sync imports them into the branch before merging remote state (same behaviour as git-ref first-sync import).
- [ ] `npm run test:core` passes; new unit tests for tree plumbing helpers and merge-on-reject, plus the two-clone convergence integration test.

## Validation
```bash
node -c aigon-cli.js
npm run test:related -- tests/integration lib/spec-store lib/commands/storage.js
```

## Technical Approach
- New module `lib/spec-store/git-branch-backend.js` implementing the SpecStore interface; registered in `lib/spec-store/index.js` factory and `storage-config.js`.
- Extend `lib/spec-store/git-plumbing.js` with tree-aware helpers: read a file from a commit (`cat-file`), list tree entries, and build a commit that replaces/adds one file path in the tree (`hash-object` → `mktree`/`update-index --index-info` against a temporary index → `commit-tree`). Never touch the user's index or worktree — use a throwaway `GIT_INDEX_FILE` under `.aigon/cache/`.
- Reuse unchanged: `event-merge.js` (union/dedupe by event id), `projection.js` (rebuild local workflows cache), `sync-state.js`, `sync-guard.js`, `lease-api.js`/`leases.js` (advisory path for now), `spec-key.js`.
- Push target is `refs/heads/<branch>` on the configured remote. Fetch uses an explicit internal tracking ref `refs/aigon-internal/state` (or `refs/aigon-internal/<branch>` when branch ≠ default) via `git fetch <remote> +refs/heads/<branch>:refs/aigon-internal/state` — never rely on the user's default fetch refspec. Document the ref in `docs/specstore-architecture.md` when that doc is updated by later set members.
- Update workflow-core's SpecStore cache key (`lib/workflow-core/engine.js`, `lib/workflow-snapshot-adapter.js`) to include `storage.git.branch` for git-branch backends so engine instances do not collide across branch names.
- Keep per-file event streams independent so concurrent writers to *different* specs merge trivially (different paths in the tree → trees merge cleanly during union-merge commit construction).
- Non-functional: a sync on a repo with ~200 specs must stay under a few seconds on a warm local clone; batch `cat-file` reads where possible.
- Follow AGENTS.md § Write-Path Contract: every write path (append, merge, import) must leave the branch tree and the local projection in the state the read paths assume; add the corresponding grep-discipline checks.

## Dependencies
- None (first member of the set).

## Out of Scope
- CAS lease files and online-mandatory claiming (`git-branch-cas-leases`).
- `aigon storage convert` support and any removal of the `git-ref` backend (`git-branch-convert-and-git-ref-removal`).
- Dashboard/doctor/report surfacing for the new backend beyond a truthful `health()` (`git-branch-observability`).
- Multi-clone race/regression harness beyond the single convergence test (`git-branch-two-clone-race-harness`).
- Contents-API (HTTPS) transport — git protocol only in this set.

## Related
- Research: —
- Set: git-branch-storage
- Prior features in set: — (first member)
- Prior art: F577 (git-ref backend), F578 (sync + leases), F595 (canonical stats sync), F598 (two-clone regression harness); `docs/specstore-architecture.md`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="240" viewBox="0 0 1168 240" role="img" aria-label="Feature dependency graph for feature 609" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-609" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-609)"/><path d="M 544 66 C 584 66, 584 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-609)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-609)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-609)"/><path d="M 844 174 C 884 174, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-609)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#609</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch backend core</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#610</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch cas leases</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#611</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch observability</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="156" font-size="14" font-weight="700" fill="#0f172a">#612</text><text x="636" y="178" font-size="13" font-weight="500" fill="#1f2937">git branch two clone race…</text><text x="636" y="198" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#613</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch convert and gi…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
