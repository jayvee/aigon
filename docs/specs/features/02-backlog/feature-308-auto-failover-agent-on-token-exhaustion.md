# Feature: auto-failover agent on token exhaustion

## Summary

When an implementation agent stops mid-feature because it has hit a token / quota / cost limit, the work currently sits dead with the user having no signal until they manually check. This feature makes Aigon detect token-exhaustion termination (distinct from a normal stop or crash) and either auto-switch to a different agent on the same feature, or surface a one-click "switch agent" affordance with the previous context preserved. Triggered by today's incident: F306 stopped silently when cx exhausted its token budget — no commits, no warning, no continuation.

## User Stories

- [ ] As a user running a feature autonomously, when my primary agent runs out of tokens mid-implementation, Aigon either continues with a configured fallback agent or sends me a desktop notification with a one-click switch button — I never discover hours later that nothing has happened.
- [ ] As a user, the failover preserves the work-in-progress: any commits the original agent made stay on the branch, and the new agent picks up from the current state with the same spec, the same partial context, and the same review cycle.
- [ ] As a user, I can configure per-repo or global fallback agent chains (e.g. "cx → cc → gg") and per-agent token/cost limits before failover triggers.
- [ ] As an operator, when failover happens it's logged as a workflow event so I can audit how often each agent runs out of budget.

## Acceptance Criteria

- [ ] **Detection.** The detection write path lives in the existing session-observation stack (`lib/supervisor.js` / `lib/workflow-core/` effect path), not in the dashboard and not in a read-side collector. Aigon distinguishes token-exhaustion from other session-end causes (crash, user kill, normal completion) using agent-specific rules sourced from `templates/agents/*.json` or another single shared owner module. Detection must require a positive exhaustion signal (exit/stderr/telemetry) and must not infer exhaustion from heartbeat silence alone.
- [ ] **Workflow event.** A new event type (`agent.token_exhausted` or similar) is appended to the workflow events log when detected, with `{agentId, role, lastCommit, tokensConsumed, limit, source}`. `source` records which detector fired (`stderr_pattern`, `exit_code`, `telemetry_limit`, or equivalent).
- [ ] **Failover policy.** Three configurable behaviours per repo:
  - `notify` (default) — surface dashboard badge + desktop notification, no auto-action
  - `switch` — automatically launch the next agent in the configured chain on the same worktree/branch
  - `pause` — kill the session, mark feature as `paused-token-limit`, surface in dashboard
- [ ] **Fallback chain config.** `~/.aigon/config.json` and `.aigon/config.json` accept a single shared config shape for failover policy and chain ordering (for example `agentFailover.policy` plus `agentFailover.chain`). If `feature-start` adds `--failover-chain`, the flag must write into workflow state or feature-local config through an existing write path; the implementation must not depend on dashboard-only state.
- [ ] **Continuation context.** When auto-switching, the new agent is launched through `lib/agent-launch.js` / the existing spawn path so per-feature `{model, effort}` overrides survive the respawn. The handoff prompt includes the previous agent id, the last reachable commit SHA (or explicit `none`), and an instruction to continue from the current branch state instead of resetting or re-planning the feature from scratch.
- [ ] **Dashboard surface.** The dashboard shows a token-exhausted status and a one-click switch action only when the central workflow action registry exposes that action in `validActions`. No action eligibility or fallback-chain logic is duplicated in frontend files.
- [ ] **No false positives.** A clean submit must not trigger failover. A user-initiated stop (`sessions-close`, `feature-reset`, operator nudge that ends the session) must not trigger failover. A generic non-zero exit without a matching exhaustion signal must remain a normal failure/crash path.
- [ ] **Slot-scoped behaviour.** In Fleet mode, failover applies only to the exhausted agent slot. Other agent sessions for the same feature continue unchanged, and the workflow snapshot preserves enough attribution to tell which agent started the branch and which agent resumed it.
- [ ] **Review separation.** If failover occurs during implementation, the eventual review agent must still be different from every implementation agent that touched the branch.

## Validation

```bash
node -c lib/supervisor.js
node -c lib/agent-launch.js
node -c lib/config.js
npm test -- --grep "token exhausted|failover|feature-start"
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +80 LOC if regression tests for detection + failover require it.
- May add new fields to `~/.aigon/config.json` schema as needed.

## Technical Approach

### Detection sources

1. **Agent CLI exit code + stderr.** Each agent (cc, cx, gg, cu) has its own quota error format. Catalogue the exit-code-and-stderr-text combinations in `templates/agents/*.json` or one other canonical owner so the supervisor can recognise them. Do not scatter regexes across command modules and dashboard code.
2. **Supervisor liveness gap.** F293 added the agent idle detector. Extend it only as a corroborating signal: when a session goes silent AND the last process exit was non-zero AND the last stderr line matches a token-exhaustion pattern, emit `agent.token_exhausted`.
3. **Cost telemetry threshold.** F288 added per-turn token telemetry. When billable tokens exceed a configured per-session or per-feature limit, emit the same workflow event with `source=telemetry_limit` and then apply the configured policy. The telemetry path must reuse the same downstream failover code path as stderr/exit detection.

### Failover write path

The hard part is making this safe. The current agent's worktree must be left in a recoverable state, the new agent must reuse the same feature branch, and the workflow snapshot/event log must record both the exhausted agent and the replacement so later review/close flows can attribute work correctly.

Reuse `feature-start` infrastructure where possible. The failover is essentially "stop agent A, start agent B on the same branch, pass spec + branch state + context primer", but it should route through the canonical spawn helpers (`lib/agent-launch.js`, existing worktree/session setup) instead of creating a second respawn implementation.

Implementation order:

1. Add token-exhaustion signal detection with one canonical producer and tests for true-positive / false-positive cases.
2. Add workflow event + snapshot/state fields needed to expose the condition through existing read adapters.
3. Add failover policy/config resolution and respawn through the existing launch path.
4. Expose dashboard status/action from the central action registry after the write path exists.

### Edge cases to consider

- **Mid-review token exhaustion** — if the *reviewer* runs out, not the implementer, the failover target is a different reviewer (chain order may differ from impl chain).
- **Fleet mode** — multiple agents on the same feature; one running out shouldn't kill the others. Failover policy applies per-agent slot.
- **Autopilot mode** — failover should integrate with the conductor so the autonomous run doesn't terminate, just hot-swaps agents.
- **Reviewer disagreement** — if cx implements then runs out, and cc takes over, the eventual review must still be by a *different* agent than both impl agents.

## Dependencies

- F285 / F293 (awaiting-input + idle detector) — supervisor infrastructure already exists for emitting workflow events from session observation
- F288 (per-turn token telemetry) — already provides the cost data the threshold detector needs

## Out of Scope

- Auto-purchasing tokens / topping up account balances
- Cross-provider failover that requires API key management beyond what aigon already does
- Automatic spec rewriting if the new agent disagrees with the previous agent's approach (out of failover scope; may belong in a future "agent disagreement" feature)
- Real-time cost forecasting — this feature reacts to exhaustion, doesn't predict it
- Choosing the optimal next agent based on remaining budget across all agents — first-priority is "swap to next in configured chain"; smarter routing can come later

## Open Questions

- Should detection be opt-in (default `notify`) or opt-in to auto-switch? Probably notify-by-default given the safety cost of automated agent swaps.
- Token limits: per-session, per-feature, per-day, or all three? The initial implementation should choose one or two concrete scopes instead of introducing all three at once.
- For Codex specifically: does the CLI exit cleanly with a recognisable error, or does it just stop streaming output? Detection mechanism depends on this.

## Related

- F293: agent-idle-detector-and-spec-preauth (provides the liveness signal we extend)
- F288: per-turn token telemetry (provides the cost data)
- Today's F306 incident: cx ran out of tokens during implementation, session died silently, no commits, no signal, user discovered manually
