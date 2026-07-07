---
complexity: high
---

# Feature: git-branch-lease-lifecycle-wiring

## Summary
The F609–F613 git-branch-storage set delivered authoritative CAS leases, but the lease *lifecycle* is only half-wired: `releaseLease` and `renewLease` exist (fully implemented and harness-tested in `lib/spec-store/git-branch-leases.js`) yet **no command ever calls either**. `feature-start`/`feature-do` acquire an `impl` lease and `feature-close` acquires a `close` lease via `coordinateMutatingCommand`, and then nothing renews during the session and nothing releases at close. Consequences: (1) the mutual-exclusion guarantee silently lapses 30 minutes (TTL) into any implementation session longer than the TTL — the exact multi-user scenario the set was built for; (2) closed/finished features keep showing as "held" on every machine's board until TTL expiry, and a teammate restarting a just-closed or just-reset feature within the TTL window hits a spurious `LeaseConflictError` requiring `--takeover`. This feature wires the existing release/renew surfaces into the command and session lifecycle. Found by the F609–613 implementation review, 2026-07-07.

## User Stories
- [ ] As user A, while user B's agent is actively implementing a feature (however long it takes), my `feature-start` on that feature is refused — the lease does not silently expire mid-session after 30 minutes.
- [ ] As user B, when I close (or reset) a feature, my `impl` and `close` leases are released in the same command, so teammates see the spec as unclaimed immediately and can start follow-up work without `--takeover`.
- [ ] As a user on a flaky connection, release and renew failures degrade to warnings (TTL still covers safety) — close and reset never block on the remote.

## Acceptance Criteria
- [ ] **Release on close:** `feature-close` (and `research-close`) call `releaseLease` for both the entity's work role (`impl`/`research`) and the `close` role after the close finalizes, on the git-branch backend. Failures print the existing warning result (`released_local` path) and never change the command's exit status — the non-blocking behaviour F610 already implemented inside `releaseLease` finally gets a caller.
- [ ] **Release on reset/pause:** `feature-reset` and the pause path release the work-role lease the same way (holder-checked; a non-holder reset does not steal — it surfaces the holder and requires `--takeover` as today).
- [ ] **Renewal driver:** while an agent session is alive, the work-role lease is renewed on the existing rate-limited checkpoint cadence (`DEFAULT_RENEW_INTERVAL_MS`, ≤ every 10 min; TTL unchanged at 30 min). Recommended host: the agent heartbeat sidecar loop in the shell-trap/heartbeat machinery (it already ticks every 30 s per agent) calling a new lightweight `aigon` renew entrypoint, throttled by `shouldRenewCheckpoint` so at most one CAS write per interval. Renewal failures are warnings (never kill or block the session), consistent with `renewLease`'s existing warning semantics.
- [ ] Renewal stops when the session ends (trap EXIT path) — no orphan renewers keeping a dead machine's lease alive past one TTL window.
- [ ] Local backend behaviour unchanged (renew/release stay advisory no-ops in practice there; no new chatter).
- [ ] Two-clone harness (`tests/integration/two-clone-git-branch-storage.test.js`) gains: close-releases-lease, renewal-extends-expiry-under-injected-clock, and reset-releases cases.
- [ ] Dashboard lease chip reflects release promptly (existing poller — no new UI work beyond what F611 shipped).
- [ ] `npm run test:core` passes.

## Validation
```bash
node -c aigon-cli.js
npm run test:related -- tests/integration lib/spec-store lib/commands/feature.js
```

## Technical Approach
- The five-method lease surface and its CAS semantics are done — this is call-site wiring only. Release: extend the close/reset command handlers (`lib/commands/feature.js`, `lib/commands/research.js`, `lib/feature-close.js` finalize path) after successful state transition. Renew: prefer the heartbeat sidecar (`buildAgentCommand` shell-trap machinery in `lib/worktree.js` / `lib/agent-status.js`) invoking a small `aigon storage lease-renew <type> <id> --role=<role>` (or an internal entrypoint) so renewal lives with session liveness, not with the dashboard (dashboard stays read-only — a poller must never write).
- Do not renew from the display-only supervisor/idle machinery — AGENTS.md display-only precedents apply.
- Keep `close`-role acquisition in `feature-close`, but release it in the same command's epilogue.

## Dependencies
- (F609–F613 all done — no ordering constraints.)

## Out of Scope
- Any change to CAS mechanics, TTL/interval defaults, or conflict classification.
- Dashboard-initiated lease mutations.
- LAN/gossip freshness.

## Open Questions
- Renew entrypoint shape: dedicated CLI subcommand vs piggybacking the existing `agent-status` heartbeat write path — pick whichever keeps the sidecar dependency-free.

## Related
- Research: —
- Set: — (follow-up to git-branch-storage set F609–F613)
- Prior art: F610 (`lib/spec-store/git-branch-leases.js` — implemented but uncalled release/renew), F612 harness, review findings 2026-07-07.
