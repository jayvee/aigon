# Feature: auto-failover agent on token exhaustion

## Summary

When an implementation agent stops mid-feature because it has hit a token / quota / cost limit, the work currently sits dead with the user having no signal until they manually check. This feature makes Aigon detect token-exhaustion termination (distinct from a normal stop or crash) and either auto-switch to a different agent on the same feature, or surface a one-click "switch agent" affordance with the previous context preserved. Triggered by today's incident: F306 stopped silently when cx exhausted its token budget — no commits, no warning, no continuation.

## User Stories

- [ ] As a user running a feature autonomously, when my primary agent runs out of tokens mid-implementation, Aigon either continues with a configured fallback agent or sends me a desktop notification with a one-click switch button — I never discover hours later that nothing has happened.
- [ ] As a user, the failover preserves the work-in-progress: any commits the original agent made stay on the branch, and the new agent picks up from the current state with the same spec, the same partial context, and the same review cycle.
- [ ] As a user, I can configure per-repo or global fallback agent chains (e.g. "cx → cc → gg") and per-agent token/cost limits before failover triggers.
- [ ] As an operator, when failover happens it's logged as a workflow event so I can audit how often each agent runs out of budget.

## Acceptance Criteria

- [ ] **Detection.** Aigon distinguishes token-exhaustion from other session-end causes (crash, user kill, normal completion). Detection signals to evaluate: agent CLI exit code, stderr text patterns ("rate limit", "quota exceeded", "context window full"), supervisor heartbeat going silent without a submit signal, telemetry showing tokens > limit.
- [ ] **Workflow event.** A new event type (`agent.token_exhausted` or similar) is appended to the workflow events log when detected, with `{agentId, lastCommit, tokensConsumed, limit, source}`.
- [ ] **Failover policy.** Three configurable behaviours per repo:
  - `notify` (default) — surface dashboard badge + desktop notification, no auto-action
  - `switch` — automatically launch the next agent in the configured chain on the same worktree/branch
  - `pause` — kill the session, mark feature as `paused-token-limit`, surface in dashboard
- [ ] **Fallback chain config.** `~/.aigon/config.json` and `.aigon/config.json` accept `agentFailoverChain: ['cx', 'cc', 'gg']` (global) and per-feature override via `--failover-chain` on `feature-start`.
- [ ] **Continuation context.** When auto-switching, the new agent gets the spec, the partial commits already on the branch, AND a primer that says "Previous agent <id> stopped at <commit-sha> due to token limit. Continue from current state."
- [ ] **Dashboard surface.** A token-exhausted card shows an amber badge "⚠ <agent> token-exhausted" with a one-click "Switch to <next>" button.
- [ ] **No false positives.** A clean submit must not trigger failover. A user-initiated stop (sessions-close) must not trigger failover.

## Validation

```bash
node -c lib/supervisor.js
node -c lib/commands/feature.js
npm test 2>&1 | grep -i "failover\|token-exhausted" | head -20
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +80 LOC if regression tests for detection + failover require it.
- May add new fields to `~/.aigon/config.json` schema as needed.

## Technical Approach

### Detection sources

1. **Agent CLI exit code + stderr.** Each agent (cc, cx, gg, cu) has its own quota error format. Catalogue the exit-code-and-stderr-text combinations in `templates/agents/*.json` so the supervisor can recognise them.
2. **Supervisor liveness gap.** F293 added the agent idle detector. Extend it: when a session goes silent AND the last process exit was non-zero AND last stderr line matches a token-exhaustion pattern → emit `agent.token_exhausted`.
3. **Cost telemetry threshold.** F288 added per-turn token telemetry. When billable tokens exceed a configured per-feature or per-session limit, pre-emptively warn or trigger failover before the agent CLI itself errors out.

### Failover write path

The hard part is making this safe. The current agent's worktree must be left in a clean state (no uncommitted scratch), the new agent must claim the same worktree path or a sibling, and the workflow snapshot must record both the original and new agents in the agents map (so reviews can attribute correctly).

Reuse `feature-start` infrastructure where possible — the failover is essentially "stop agent A, start agent B on the same branch, pass spec+commits+context primer".

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
- Token limits: per-session, per-feature, per-day, or all three?
- For Codex specifically: does the CLI exit cleanly with a recognisable error, or does it just stop streaming output? Detection mechanism depends on this.

## Related

- F293: agent-idle-detector-and-spec-preauth (provides the liveness signal we extend)
- F288: per-turn token telemetry (provides the cost data)
- Today's F306 incident: cx ran out of tokens during implementation, session died silently, no commits, no signal, user discovered manually
