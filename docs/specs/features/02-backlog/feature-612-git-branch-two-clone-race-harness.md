---
complexity: medium
set: git-branch-storage
depends_on: [610]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-05T13:12:21.370Z", actor: "cli/feature-prioritise" }
---

# Feature: git-branch-two-clone-race-harness

## Summary
Extend the two-clone regression harness (F598) to prove the `git-branch` backend's concurrency claims, especially the one that matters: **concurrent claims have exactly one winner**. The CAS lease design's correctness rests on push-rejection races, expiry semantics, offline refusal, and event convergence under branch-level contention — none of which are exercised by unit tests. This feature makes those scenarios deterministic, repeatable tests against a local bare remote, so the mutual-exclusion guarantee is verified by CI rather than asserted in docs. It also gates the final set member: git-ref removal must not proceed until this matrix is green.

## User Stories
- [ ] As a maintainer, I can run one test command and get a pass/fail verdict on every multi-machine coordination property the git-branch backend promises.
- [ ] As a maintainer reviewing a storage change, CI failing this harness tells me precisely which coordination property regressed (race, expiry, offline, convergence, retry) rather than a generic sync error.

## Acceptance Criteria
- [ ] Harness builds on the existing F598 two-clone fixture (local bare repo as `origin`, two working clones with distinct `AIGON_MACHINE_ID` and isolated `HOME`), extended to the `git-branch` backend. No network, no real forge, fully deterministic.
- [ ] **Race — one winner:** both clones attempt `acquireLease` on the same key/role concurrently (genuine parallel processes, plus a deterministic interleaving variant that pre-positions clone B's push between clone A's fetch and push). Assert exactly one success, one `LeaseConflictError` naming the winner, and a final branch state with one lease record and a coherent audit trail.
- [ ] **Retry-on-unrelated-change:** clone B pushes an events-only commit between clone A's lease fetch and push; assert clone A's claim retries and succeeds (no false `LeaseConflictError` from branch-level contention).
- [ ] **Expiry + reclaim:** with an expired lease on the branch, a new claim from the other clone succeeds and the audit trail shows the supersession; TTL boundaries tested via injected clock, not sleeps.
- [ ] **Takeover:** `--takeover` against a live lease succeeds via CAS, records `priorHolderId`, and a concurrent renew by the prior holder loses cleanly (one of the two lands; the other errors and re-reads).
- [ ] **Offline refusal:** with the remote unreachable (and separately with `AIGON_STORAGE_OFFLINE=1`), `acquireLease` fails with `LeaseUnavailableError`; event append in the same conditions still succeeds locally and syncs later.
- [ ] **Event convergence under contention:** both clones append events to the same and different specs while trading pushes; after both sync, `events.jsonl` contents are identical across clones, union-complete, duplicate-free.
- [ ] **Crash-window integrity:** kill a clone's process between commit and push, and between push and local projection update; assert the next command self-recovers (no stuck state, doctor reports clean or auto-fixable).
- [ ] Runs inside `npm run test:core` (non-browser) within the existing test budget (`scripts/check-test-budget.sh`); parallel-process tests use bounded timeouts and leave no stray processes or temp dirs.
- [ ] Failure output names the violated property and dumps both clones' branch tips, lease file, and relevant event tails for diagnosis.

## Validation
```bash
```

## Technical Approach
- Reuse/extend the F598 harness fixture and helpers rather than a parallel harness (no-sidecar rule); factor the fixture only if git-ref and git-branch variants genuinely share setup.
- Deterministic interleavings via injectable hooks in the backend's claim path (e.g. an internal `beforePush` test hook or env-gated pause), preferred over timing-based races; keep one true-parallel smoke case for honesty.
- Clock injection for TTL tests via the existing time-source pattern in `leases.js` (`parseTime`/`computeExpiresAt`) — add an injectable now() if none exists, rather than sleeping.
- Isolated `HOME`/`USERPROFILE` per clone (per the manual-CLI-testing discipline) so global registry/config is never touched.

## Dependencies
- depends_on: git-branch-cas-leases

## Out of Scope
- Testing against real forges (GitHub/GitLab) — protocol behaviour is identical against a local bare remote; a manual real-forge checklist can live in the implementation log.
- Playwright/browser coverage (observability feature owns its own UI evidence).
- Load/scale benchmarks beyond the budget check.

## Open Questions
- Whether the deterministic interleaving hook should be a permanent internal test seam or stripped after this set — recommended: keep it, seams like this are how F598 stays useful.

## Related
- Research: —
- Set: git-branch-storage
- Prior features in set: git-branch-backend-core, git-branch-cas-leases
- Prior art: F598 (two-clone git-ref regression harness), `scripts/check-test-budget.sh`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="132" viewBox="0 0 1168 132" role="img" aria-label="Feature dependency graph for feature 612" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-612" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-612)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-612)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-612)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#609</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch backend core</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#610</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch cas leases</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#612</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch two clone race…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#613</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch convert and gi…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
