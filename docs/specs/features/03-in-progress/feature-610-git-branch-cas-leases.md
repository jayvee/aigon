---
complexity: very-high
set: git-branch-storage
depends_on: [609]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-05T13:12:20.877Z", actor: "cli/feature-prioritise" }
---

# Feature: git-branch-cas-leases

## Summary
Turn leases from advisory into **authoritative mutual exclusion** on the `git-branch` backend. Today a lease is an event appended to the same union-merged stream as lifecycle events, so two machines can acquire "the same" lease concurrently and both survive the merge — conflicts are discovered after both users started work. This feature moves the *current* lease to a per-spec file (`leases/<KEY>.json`) on the `aigon-state` branch, written only via **fast-forward-only push (compare-and-swap)**: the remote accepts exactly one writer per race, and the loser's rejected push is the conflict signal, delivered before any worktree is created. Acquisition becomes **online-mandatory** — a lock you can take offline is not a lock. Lease *history* (acquired/renewed/released/taken_over) is still appended to the spec's `events.jsonl` as an audit trail, but the file is the authority.

## User Stories
- [ ] As user A on machine X, when I run `feature-start` on a spec that user B on machine Y already started, the command fails immediately with who holds it, on which machine, with which agent, and until when — before any workspace is created.
- [ ] As two users who run `feature-start` on the same spec within the same second, exactly one of us wins; the other gets a clear conflict error naming the winner, never a silent double-start.
- [ ] As a user whose laptop died mid-feature, my teammate can take over after the lease TTL expires (or immediately with `--takeover`, which records an auditable takeover), without any manual state surgery.
- [ ] As a user with no network, I get a hard, explanatory error when I try to claim a spec — not a claim that silently didn't coordinate.

## Acceptance Criteria
- [ ] Branch layout gains `leases/<KEY>.json` holding the current lease per role, e.g. `{"impl": {"holderId": "machine-y", "user": "b@team.com", "agentId": "cc", "acquiredAt": "...", "expiresAt": "...", "renewCount": 2}}`. Absent file or absent role key = no lease. Roles reuse `LEASE_ROLES` (`impl`, `research`, `eval`, `close`).
- [ ] Acquire protocol: fetch branch → read `leases/<KEY>.json` from the fetched tip → if an unexpired lease for the role is held by another holder and `--takeover` is not set, throw the existing `LeaseConflictError` (message includes holder, user, agent, expiry) → otherwise build a commit on the fetched tip writing the new lease → push fast-forward-only.
- [ ] Push rejection handling distinguishes two cases after re-fetch: (a) the lease file for this key changed → `LeaseConflictError` (lost the race); (b) only other paths changed (e.g. someone pushed events) → rebuild the lease commit on the new tip and retry, bounded (3 attempts) with short jittered backoff; exhausting retries surfaces a distinct retryable error.
- [ ] Renew, release, and takeover use the same CAS discipline. Renew preserves existing TTL/checkpoint semantics (default TTL 30 min, checkpoint at most every 10 min — `DEFAULT_LEASE_TTL_MS` / `DEFAULT_RENEW_INTERVAL_MS` unchanged). Release clears the role entry. Takeover overwrites and records `priorHolderId`/`priorAgentId`.
- [ ] Every successful CAS transition also appends the matching `lease.*` event to `specs/<KEY>/events.jsonl` (same commit) so audit history and existing lease-derivation code paths keep working. The file, not the derived events, is what acquire/renew/release consult on this backend.
- [ ] **Online-mandatory claims**: on the `git-branch` backend, `acquireLease` (and takeover) with the remote unreachable, or under `--offline`/`AIGON_STORAGE_OFFLINE=1`/`storage.git.offline`, fails with a new `LeaseUnavailableError` whose message explains that claiming requires reaching the remote and names the remote. Event writes retain today's offline tolerance. `coordinateMutatingCommand` in `lease-coordination.js` enforces this in one place; `renewLease` failures due to network are surfaced as warnings, not hard stops, while the lease is still within TTL. **`releaseLease` is not online-mandatory**: when the remote is unreachable, release logs a warning and returns (TTL still covers safety); `feature-close` must not block on release failure.
- [ ] Lease file shape is **one `leases/<KEY>.json` per spec key** with a roles map (not per-role files). Concurrent impl vs eval on the same key serializes through one CAS blob — acceptable because roles are rarely contested simultaneously and the read path stays one `cat-file`.
- [ ] Lease records gain a `user` field resolved from `git config user.email` (fallback `user.name`, then null); `holderId` remains the machine id from the existing `resolveHolderId()` chain; `agentId` behaviour unchanged.
- [ ] The local backend's lease behaviour is completely unchanged (single-machine advisory, as today). The lease strategy is backend-provided: `createLeaseApi` remains the default; the git-branch backend supplies the CAS implementation behind the same five-method surface (`readLeases`, `acquireLease`, `renewLease`, `releaseLease`, `assertLeaseAllowed`).
- [ ] Integration test on a local bare remote: two clones race `acquireLease` for the same key/role concurrently; assert exactly one `ok: true` and one `LeaseConflictError`, and the branch ends with exactly one lease record. (The fuller matrix lives in `git-branch-two-clone-race-harness`.)
- [ ] All existing callers of `coordinateMutatingCommand` (`feature-start`, `feature-do`, `feature-close`, research equivalents) behave correctly with zero call-site changes beyond error rendering for `LeaseUnavailableError`.
- [ ] `npm run test:core` passes.

## Validation
```bash
node -c aigon-cli.js
npm run test:related -- tests/integration lib/spec-store lib/commands/storage.js
```

## Technical Approach
- CAS primitive: build the lease commit with its parent set to the freshly fetched remote tip, then plain `git push <remote> <sha>:refs/heads/<branch>` — a non-fast-forward is rejected by the remote atomically, which is the compare-and-swap. Do not use `--force` anywhere in the lease path; `--force-with-lease` is acceptable as an explicitness belt-and-braces but plain FF-only push is sufficient and simpler.
- Retry-on-unrelated-change is essential to keep single-branch contention harmless: the branch serializes all pushes, so an events push from another machine must not masquerade as a lease conflict. Compare the lease file blob sha between the expected tip and the new tip to classify.
- `LeaseUnavailableError` lives in `lib/spec-store/leases.js` beside `LeaseConflictError`; `formatLeaseConflict` in `lease-coordination.js` grows a sibling formatter so CLI output stays consistent.
- TTL expiry stays wall-clock based (documented clock-skew caveat); a takeover is always a CAS write so even stealing is race-free.
- Do not regress the F294/F296 loud-path discipline: a claim failure must exit non-zero with actionable text, never leave partial worktree/session state behind. Claim happens before workspace creation in `feature-start`.
- Write-path contract: the same commit must update both the lease file and the audit event; never split them across two pushes.

## Dependencies
- depends_on: git-branch-backend-core

## Out of Scope
- Dashboard rendering of holder/user and background freshness polling (`git-branch-observability`).
- The full concurrency test matrix (`git-branch-two-clone-race-harness`).
- Conversion and git-ref removal (`git-branch-convert-and-git-ref-removal`).
- Any change to local-backend lease semantics.
- LAN/tailnet gossip or any real-time push channel.

## Related
- Research: —
- Set: git-branch-storage
- Prior features in set: git-branch-backend-core
- Prior art: F578 (advisory leases), `lib/spec-store/lease-api.js`, `lib/spec-store/lease-coordination.js`, `docs/specstore-architecture.md` § leases.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="240" viewBox="0 0 1168 240" role="img" aria-label="Feature dependency graph for feature 610" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-610" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-610)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-610)"/><path d="M 544 66 C 584 66, 584 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-610)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-610)"/><path d="M 844 174 C 884 174, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-610)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#609</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch backend core</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#610</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch cas leases</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#611</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch observability</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="156" font-size="14" font-weight="700" fill="#0f172a">#612</text><text x="636" y="178" font-size="13" font-weight="500" fill="#1f2937">git branch two clone race…</text><text x="636" y="198" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#613</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch convert and gi…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
