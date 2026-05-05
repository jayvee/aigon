---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-04T23:44:48.996Z", actor: "cli/feature-prioritise" }
---

# Feature: failover-integration-test

## Summary

Add an end-to-end integration test for the agent failover path that exercises the **whole** sweep loop — detection signal → engine event recorded → chain advance → tmux session respawned — against the current OSS implementation. The existing test at `tests/integration/agent-failover.test.js` covers detection signal shape, status-flag clearing, and the `chooseNextAgent` guard, but it does **not** drive the supervisor end-to-end. We need that coverage before the failover capability is moved to aigon-pro (see `feature-agent-failover-pro-tier` in the Pro repo) — without it, the move has no green baseline to migrate.

## User Stories

- [ ] As an Aigon maintainer, I want a single test that fails loudly if any link in the failover chain (detection, event recording, chain advance, session respawn) regresses, so the upcoming Pro-move refactor has a safety net.
- [ ] As a future operator who relies on auto-failover, I want the behaviour pinned by a real test so it doesn't quietly stop working between releases.

## Acceptance Criteria

- [ ] New test file `tests/integration/agent-failover-end-to-end.test.js`.
- [ ] Test runs under `AIGON_TEST_MODE=1` so MockAgent's `tail -f /dev/null` substitute is used and no real `claude` / `codex` / `gemini` binary is launched.
- [ ] Test scenario:
  1. Create a temp repo, init aigon, configure `agentFailover: { policy: "switch", chain: ["cc", "cx", "gg"] }`.
  2. Start a feature on slot `cc` (use existing test helpers — match the pattern in `tests/integration/agent-failover.test.js`).
  3. Forge a per-slot agent-status record via `writeAgentStatusAt` with `lastExitCode: 1, lastPaneTail: 'usage limit reached'`.
  4. Invoke one supervisor sweep cycle directly (export the inner sweep function from `lib/supervisor.js` if needed, or drive via `AIGON_SUPERVISOR_SWEEP_MS` + a brief wait — pick whichever is more deterministic).
  5. Read `.aigon/state/feature/<id>/events.jsonl`. Assert: contains exactly one `agent.token_exhausted` (source=`stderr_pattern`) and exactly one `agent.failover_switched` (previousAgentId=`cc`, replacementAgentId=`cx`).
  6. Read the snapshot via `workflowSnapshotAdapter.readFeatureSnapshotSync`. Assert: `agents.cc.currentAgentId === 'cx'`, `agents.cc.previousAgentId === 'cc'`, `agents.cc.tokenExhausted === null`.
  7. Assert: a tmux session for the cx replacement was created (in test mode this is just `tmux has-session` returning 0 — MockAgent keeps the session alive).
- [ ] Second scenario in the same file: chain end. Start chain at `gg`; forge exhaustion. Assert `agent.token_exhausted` is recorded but no `agent.failover_switched` is appended (chain has no successor).
- [ ] Third scenario: `policy: notify`. Forge exhaustion; assert `agent.token_exhausted` is recorded, no switch event, slot stays on `cc` with `tokenExhausted` set.
- [ ] Test completes in under 5 seconds locally.
- [ ] Test is wired into `npm test` (the standard runner already picks up files under `tests/integration/`).

## Validation

```bash
npm test -- --grep "agent-failover-end-to-end"
node --check tests/integration/agent-failover-end-to-end.test.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration — this feature touches no dashboard assets.

## Technical Approach

### Driving one sweep deterministically
Two viable paths:
1. **Export the sweep entry point.** `lib/supervisor.js` already has `sweepEntity(repoPath, entityType, entityId, snapshot, projConfig)` — if not exported, add it to `module.exports` for testability. Test calls it directly. Cleanest, most deterministic.
2. **Drive via the interval.** Set `process.env.AIGON_SUPERVISOR_SWEEP_MS = '50'` and `await new Promise(r => setTimeout(r, 200))`. Less deterministic, more flaky on CI.

Prefer (1). The export is harmless — `sweepEntity` has no side effects beyond the engine writes and the tmux call, both of which are intended.

### MockAgent contract
`AIGON_TEST_MODE=1` swaps the agent CLI invocation for `tail -f /dev/null`. The tmux session stays alive, exits cleanly when killed. This is exactly what we need — the failover code calls `kill-session` then `createDetachedTmuxSession` with a new command; both run for real, but no real LLM ever wakes up.

### Event-log assertions
`.aigon/state/feature/<id>/events.jsonl` is append-only newline-delimited JSON. Test reads the file, splits on `\n`, parses, filters by `type`. No engine internals needed.

### Why this is its own feature, not part of the Pro-move
1. The test must exist **before** the move so we have a regression catcher during the lift.
2. The test asserts current OSS file paths and module shapes; once code moves to Pro, the test moves with it (the Pro feature explicitly calls this out as a dependency).
3. Splitting keeps the move feature focused on the actual refactor and UI work, not on building infrastructure.

## Dependencies

- None. This unblocks `feature-agent-failover-pro-tier` (Pro repo).

## Out of Scope

- Testing the `policy: pause` path. Covered adequately by existing unit tests.
- Testing telemetry-based detection (`tokenLimits.perSessionBillableTokens`). Covered by existing unit tests; end-to-end coverage there would require a telemetry-aggregation fixture that isn't worth the complexity for this pass.
- Testing the manual `switch-agent` HTTP endpoint. That's covered (or will be covered) by the dashboard route tests in the Pro feature.

## Open Questions

- None.

## Related

- Set: agent-failover
- Prior features in set: F308 (auto-failover-agent-on-token-exhaustion, done) — landed the code under test.
- Successor (cross-repo): `feature-agent-failover-pro-tier` in aigon-pro inbox — this feature blocks that one.
