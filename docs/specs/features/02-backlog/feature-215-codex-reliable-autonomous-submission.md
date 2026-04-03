# Feature: codex reliable autonomous submission

## Summary

Codex can complete feature implementation successfully but still fail to emit the final `aigon agent-status submitted` signal. In normal work this creates confusing handoffs; in autonomous mode it is worse, because the AutoConductor waits on workflow readiness and never advances to evaluation. This feature makes Codex feature completion reliable by tightening prompts, aligning installed command surfaces, and adding stronger guardrails around the submit step so a finished Codex session either submits successfully or clearly fails instead of silently stalling the workflow.

## User Stories

- [ ] As a developer using Codex for feature implementation, I can trust that when Codex says it is done, it has already emitted the required submit signal.
- [ ] As a user running a feature autonomously, I do not get stuck in `implementing` because Codex finished coding but never marked itself submitted.
- [ ] As a maintainer, I have one clear completion contract for Codex feature runs and a visible failure mode when submission does not happen.

## Acceptance Criteria

- [ ] Codex no longer relies on `feature-submit` as a completion concept for feature implementation
- [ ] Codex feature implementation prompts make `aigon agent-status submitted` the required final step
- [ ] Codex prompts explicitly forbid claiming completion before `aigon agent-status submitted` succeeds
- [ ] If `aigon agent-status submitted` fails, Codex is instructed to report the exact failure and stop instead of improvising with other commands
- [ ] Installed Codex docs/prompts are aligned with the actual CLI surface and no longer imply a nonexistent submit command
- [ ] In an autonomous feature run, when Codex finishes implementation successfully, the feature workflow snapshot reaches `agents.cx.status = ready` without manual intervention
- [ ] AutoConductor can advance to eval after a successful Codex implementation without a human having to remind Codex to submit
- [ ] If Codex completes code changes but still fails to emit submission, the failure is surfaced clearly in the user-visible output instead of looking like a mysterious autonomous stall

## Validation

```bash
node -c lib/commands/misc.js
node -c lib/validation.js
node -c lib/templates.js
npm test
```

Manual validation:

- Run a Codex feature implementation flow in a worktree via `feature-do`
- Confirm Codex emits `aigon agent-status submitted` before claiming completion
- Run an autonomous fleet feature with Codex as one implementer
- Confirm the workflow snapshot reaches `cx: ready` and AutoConductor progresses once Codex finishes

## Technical Approach

### 1. Tighten Codex completion prompts

Update the Codex-facing feature implementation prompts so the completion contract is explicit and non-optional:

- implementation is not complete until `aigon agent-status submitted` succeeds
- do not say "done", "complete", or "ready" before that succeeds
- if submission fails, report the error and stop

### 2. Remove command-surface ambiguity

The Codex failure pattern has been amplified by the old `feature-submit` half-state. This feature should depend on, or land with, the removal of `feature-submit` from Codex-facing docs and installed command surfaces so there is only one valid completion path.

### 3. Verify the signal path used by Codex worktrees

Codex worktrees must resolve the correct main repo and successfully run `aigon agent-status submitted` from that context. If there are Codex-specific environment, trust, or launch-path issues that make submission brittle in worktrees, fix them here.

### 4. Make autonomous failures legible

If AutoConductor is waiting on Codex and the session ends without readiness being signaled, the system should expose that clearly rather than leaving the user to infer it from a stalled state. This can be prompt-level, status-level, or controller-level, but the outcome must be a visible reason for the stall.

## Dependencies

- [feature-remove-feature-submit-and-enforce-feature-do-submission.md](/Users/jviner/src/aigon/docs/specs/features/01-inbox/feature-remove-feature-submit-and-enforce-feature-do-submission.md)
- `templates/generic/commands/feature-do.md`
- `templates/generic/docs/agent.md`
- `docs/agents/codex.md`
- `lib/commands/misc.js`
- `lib/validation.js`

## Out of Scope

- Rewriting the entire autonomous controller design
- Non-Codex agent submission reliability unless the same fix naturally applies
- Automatic retries after a genuine implementation failure

## Open Questions

- Should AutoConductor eventually distinguish between "agent still running" and "agent finished but never submitted" as separate visible states?

## Related

- [feature-214-feature-automation-profiles.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-214-feature-automation-profiles.md)
- [feature-212-fix-autopilot-to-use-workflow-core-engine.md](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-212-fix-autopilot-to-use-workflow-core-engine.md)
