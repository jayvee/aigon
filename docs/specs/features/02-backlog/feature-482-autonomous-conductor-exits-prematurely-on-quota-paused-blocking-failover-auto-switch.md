---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T00:55:08.132Z", actor: "cli/feature-prioritise" }
---

# Feature: Autonomous conductor exits prematurely on quota-paused, blocking failover auto-switch

## Summary

When a solo autonomous run's implementer hits quota, `feature-autonomous.js` (the conductor process) detects `quota-paused` on the agent status file and immediately calls `finishAuto('quota-paused') + stopAutoSession()`, killing its own tmux session. This happens **before** the supervisor has processed the token-exhaustion signal from the implementer's tmux pane. The supervisor's auto-failover path (`supervisor.js:567`) requires `isAutonomous = true`, which in turn requires a **live** conductor tmux session (`safeFeatureAutoSessionExists` checks the tmux session list, not persisted state). By the time the supervisor fires the failover, the conductor is dead → `isAutonomous = false` → manual failover only — even though `agentFailover.policy: switch` is configured and the chain has a next agent ready.

Observed in F480: conductor exited at 00:02 UTC, cx pane showed the terminal exhaustion message later, supervisor found no live auto session, dashboard showed "Failover now → cu" requiring a manual click.

The fix: the conductor should not unconditionally stop when it detects `quota-paused` on the implementer. If `agentFailover.policy === 'switch'` and a next agent exists in the chain, the conductor should stay alive (not call `stopAutoSession()`) so the supervisor's `isAutonomous` check passes and the pro failover handler can do its job. The conductor then resumes its loop once the agent slot transitions away from `quota-paused` (i.e. after the failover switches the runtime agent).

## User Stories

- As a user who starts a feature with `afs <id> cx --stop-after=close`, I expect that if cx hits its token quota, the next agent in the failover chain (e.g. cu) is automatically spawned without me needing to click "Failover now →" in the dashboard.
- As a user relying on overnight autonomous runs, I expect a quota exhaustion on agent N to transparently hand off to agent N+1 so the feature continues making progress without human intervention.

## Acceptance Criteria

- [ ] When a solo autonomous run's implementer transitions to `quota-paused` AND `agentFailover.policy === 'switch'` AND a next agent exists in the chain, the conductor does NOT call `stopAutoSession()` — it stays alive.
- [ ] The conductor's live tmux session remains present, so `safeFeatureAutoSessionExists` returns `{ running: true }` and `isAutonomous = true` when the supervisor fires the exhaustion handler.
- [ ] The conductor's live tmux session satisfies the supervisor's `isAutonomous` check, enabling the supervisor's exhaustion handler to invoke the pro failover path (`switchFeatureAgent`) automatically without requiring a manual dashboard click. (Full end-to-end verification requires aigon-pro; the OSS change guarantees the conductor stays alive so the supervisor *can* trigger it.)
- [ ] After the failover switches the runtime agent, the conductor resumes its run loop polling the implementer slot (now running the next agent in the chain) and continues to completion.
- [ ] If `agentFailover.policy !== 'switch'` (i.e. `pause` or `notify`), or no next agent exists in the chain, the conductor still exits immediately as before — no behaviour change for those cases.
- [ ] `npm run test:iterate` passes.

## Validation

```bash
node --check lib/feature-autonomous.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**Root cause (exact lines):** `lib/feature-autonomous.js:285-300` — the solo quota-blocked guard unconditionally calls `finishAuto + persistFinishState + stopAutoSession` when `quotaBlocked && agentIds.length === 1`.

**Fix:** Before stopping, read `resolveFailoverConfig(mainRepo, snapshot)` (already exported from `lib/agent-exhaustion-detect.js`). If `policy === 'switch'` and `chooseNextAgent(chain, currentAgentId)` returns a candidate, skip `stopAutoSession()` and instead fall through to continue the while-loop. The conductor should log a message like `"ℹ️  Agent quota-paused; failover policy=switch — staying alive for supervisor handoff (next: <agent>)"` and sleep for one poll interval before re-checking.

The supervisor will detect token exhaustion from the implementer's tmux pane independently (it already does), find `isAutonomous = true` (conductor still alive), and invoke the pro failover handler. The conductor's loop will then see the cx slot's `runtimeAgentId` change (or status transition away from `quota-paused`) and resume normal monitoring.

**Key invariant to preserve:** `persistFinishState + stopAutoSession` are still called if:
- `policy !== 'switch'`
- No next agent in chain
- Failover handler fails (add a timeout: if `quota-paused` persists for > N poll cycles with no runtime switch, give up and exit as before)

**Files to change:** `lib/feature-autonomous.js` only (OSS). No aigon-pro changes needed — the pro failover handler is already triggered by the supervisor's exhaustion detection path, which remains unchanged.

**Timeout guard:** To avoid the conductor looping forever if pro isn't installed or the failover silently fails, add a counter: after `MAX_FAILOVER_WAIT_CYCLES` (e.g. 4 × `pollSeconds` ≈ 120 s by default) of still seeing `quota-paused` on the slot, fall through to the original `finishAuto + stopAutoSession` path. Log a warning when this happens.

## Dependencies

- Requires aigon-pro installed for the auto-failover to actually switch agents (the conductor just stays alive; the switch is still pro's job via the supervisor's exhaustion handler).

## Out of Scope

- Fleet mode (the quota-blocked guard already has `if (!isFleet)` — fleet has different handling).
- Making the conductor itself trigger the failover directly (that logic lives in pro; this feature just keeps the conductor alive long enough for the supervisor to do it).
- Changing the `safeFeatureAutoSessionExists` fallback to use persisted state for `running: true` (that would be a broader change with other implications).

## Open Questions

- Should the conductor emit a `feature.agent_failover_pending` workflow event when it enters the "staying alive for handoff" state? Defer — useful for dashboard visibility but not strictly required for correctness in this iteration.

## Related

- Research: none
- Set: (standalone)
- Prior features in set: F446 (quota-paused detection), F308 (failover)
