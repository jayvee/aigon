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
- [ ] **Builds on 577, does not re-introduce it.** 577 already ships `aigon storage sync` (on-demand fetch+push of `<refPrefix>/*`) and `aigon storage status`. This feature extends those: mutating Git-ref commands perform a backend sync before writes unless `--offline` (or `storage.git.offline: true`) is set, reusing 577's fetch/merge-by-event-ID/push path rather than adding a second sync mechanism.
- [ ] Active implementation/research sessions acquire renewable leases keyed by the **575 identity key + role** (e.g. `impl`, `research`, `eval`), stored as canonical append-only lease events in the Git-ref log (e.g. under `<refPrefix>/<key>/events`, type `lease.acquired` / `lease.renewed` / `lease.released` / `lease.taken_over`). Leases are advisory coordination, not hard locks — name the chosen TTL and renew interval (see Open Questions; default proposed below).
- [ ] Each lease event carries audit data: holder machine/host id, agent id, role, acquired-at, expires-at (TTL), and renew count. Expiry is derived from the latest unreleased event's `expires-at` versus wall clock — there is no separate "expiry" event.
- [ ] Mutating/start commands (`feature-start`, `feature-do`, `research-*`, close paths) on a Git-ref repo check for an active unexpired lease owned by another holder for the same key/role and **block with an actionable message**, or proceed under an explicit `--takeover` flag that appends a `lease.taken_over` event recording the prior holder. Stale/expired leases never block.
- [ ] `aigon storage doctor` validates ref reachability, duplicate/idempotent-violating events, stale or missing local projections, and lease health (expired-but-unreleased, orphaned, conflicting holders); it is **read-only/diagnostic by default** and only mutates state under an explicit `--fix`, consistent with `aigon doctor --fix`.
- [ ] A local, read-only reporting command (`aigon storage report`, also surfaced via the existing portfolio/`board` view where applicable) enumerates configured repos or bare mirrors, fetches `refs/aigon/*`, derives projections per repo, and produces a merged cross-repo report. It never mutates remote state and never requires an Aigon-hosted database.
- [ ] High-churn runtime data (heartbeats/lease renewals) is checkpointed/summarized into durable Git-backed state: heartbeats stay local/display-only, while lease renewals append only rate-limited `lease.renewed` checkpoints when the advertised expiry window changes. The event log must not grow per-heartbeat, and the chosen checkpoint cadence is documented.
- [ ] Documentation explains Git remote permission requirements (push access to `refs/aigon/*`), and that hosting UIs (GitHub/GitLab/Bitbucket) may not display custom refs.

## Validation
```bash
node -c aigon-cli.js
npm run test:core
```
This is non-browser engine work; `test:core` is the gate (matching 577). Tests must use a **local bare remote** and cover: lease acquire/renew/release round-trip, expiry-by-wall-clock, the block-vs-`--takeover` path on conflicting holders, idempotent lease events on re-push, `storage doctor` flagging an expired-but-unreleased lease, and a two-repo cross-repo report assembled from fetched `refs/aigon/*`.

## Technical Approach
- Add lease APIs to the `SpecStore` interface (e.g. `acquireLease`/`renewLease`/`releaseLease`/`readLeases`) so callers stay backend-agnostic; the Git-ref backend (577) implements them by appending lease events to the canonical log, and the local adapter (576) can implement same-machine semantics.
- Model leases as append-only events in 577's canonical log keyed by the 575 identity key + role — not as a separate mutable ref — so they ride the existing fetch/merge-by-event-ID/push path and stay auditable. Reserve a dedicated `<refPrefix>/leases/*` ref namespace only if event-log volume proves a problem; default to the unified log.
- Use optimistic, auditable coordination rather than pretending Git offers hard distributed locks; cross-machine conflicts resolve via the same push-rejection/merge/retry path 577 defines.
- Treat projections and cross-repo reports as rebuildable from canonical events.
- Use bare mirrors under `~/.aigon/remotes/` for cross-repo reporting so reports do not require every worktree to be checked out.

## Dependencies
- depends_on: git-ref-specstore-backend

## Out of Scope
- A hosted Aigon database
- Real-time collaboration UI
- Replacing Git provider auth or permissions

## Open Questions
- Default lease TTL and renew interval for interactive agent sessions. Proposed default: **TTL 30 min, renew at most every 10 min while the owning session is alive** so active work stays visible to other machines, a crashed/dead machine self-expires within one TTL, and renewals remain bounded instead of tracking heartbeat cadence. Confirm or revise during implementation.

## Related
- Set: specstore-git-backed-storage
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1768" height="132" viewBox="0 0 1768 132" role="img" aria-label="Feature dependency graph for feature 578" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-578" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1444 66 C 1484 66, 1484 66, 1524 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-578)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#573</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore architecture fo…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#574</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deprecate feedback into r…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#575</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">repo wide spec identity k…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#576</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore local adapter</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#577</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">git ref specstore backend</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1524" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="1536" y="48" font-size="14" font-weight="700" fill="#0f172a">#578</text><text x="1536" y="70" font-size="13" font-weight="500" fill="#1f2937">specstore sync leases and…</text><text x="1536" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
