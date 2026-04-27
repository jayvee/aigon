---
complexity: medium
set: simulate-agents
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T13:11:07.951Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-e2e-failure-modes

## Summary
Add `tests/dashboard-e2e/failure-modes.spec.js`, a Playwright spec covering the three failure modes called out in research-42: (1) agent crashes mid-work (tmux session killed), (2) agent never signals (heartbeat goes stale), and (3) agent signals `agent-status error`. Each sub-case drives a deliberately misbehaving `MockAgent` variant through the same harness as the solo-lifecycle spec, then asserts the dashboard renders the expected recovery state and `validActions`. This also folds in the `mock-agent-failure-profiles` work proposed in the cu finding — the profiles (`happy`, `never-submit`, `error-mid`, `abort-after-commit`) are added to `MockAgent` only as far as this spec consumes them, avoiding duplicate scaffolding.

## User Stories
- [ ] As a maintainer editing supervisor / heartbeat / `agent-status error` recovery code, I get a fast deterministic test that catches dashboard recovery-state regressions.
- [ ] As a workflow author, "what happens when an agent dies" is now an answered, tested behaviour rather than a hand-wavy "the dashboard shows something."

## Acceptance Criteria
- [ ] `tests/dashboard-e2e/failure-modes.spec.js` contains three sub-tests:
  - **crash mid-work**: spawn MockAgent in tmux mode, `tmux kill-session` partway through, assert dashboard shows session-lost / failed state and the right `validActions` (recovery options).
  - **never signals**: spawn a MockAgent variant that sleeps long without ever calling `agent-status`, let the heartbeat staleness threshold pass, assert `idleState` badge / display flag (display-only per AGENTS.md — do NOT assert engine transition).
  - **error signal**: spawn MockAgent variant that runs `aigon agent-status error`, assert dashboard renders error state and offers recovery `validActions`.
- [ ] `MockAgent` (or a sibling factory) gains the failure profiles needed to drive these three sub-tests. Profiles are minimal — extend only as far as the spec consumes.
- [ ] Each sub-test names its specific regression in a `// REGRESSION:` comment per AGENTS.md T2.
- [ ] Heartbeat assertion respects the display-only contract: badge / `idleState` only — no assertion that the engine auto-transitions.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
MOCK_DELAY=fast npx playwright test tests/dashboard-e2e/failure-modes.spec.js
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if three failure sub-tests genuinely require it after deduplication against `_helpers.js`.

## Technical Approach
- Reuse `_helpers.js` and the brewboard fixture pattern.
- Use `mock-agent-tmux-mode` so the crash sub-test actually has a real tmux session to kill, and so heartbeat sidecar files exist for the never-signals sub-test.
- For the heartbeat staleness sub-test, prefer faking time / lowering the staleness threshold via env (if one exists) over real wall-clock waits to keep the spec under a few seconds.
- Failure-profile additions to `MockAgent` should be a small enum/option, not a class hierarchy — keep it ~30 LOC.
- Audit the current test budget before adding; if needed, cite the Pre-authorised line in the commit footer when raising the ceiling.

## Dependencies
- depends_on: mock-agent-tmux-mode

## Out of Scope
- Changing the heartbeat display-only contract.
- Auto-recovery / engine-driven recovery features — only the dashboard render and `validActions` are asserted.
- Token-exhaustion failover (F308) — separate path with its own coverage.

## Open Questions
- Is there an existing knob to compress the heartbeat staleness threshold for tests, or do we need to add one? Check `lib/workflow-heartbeat.js` and `lib/supervisor.js` during implementation.

## Related
- Research: 42 — simulate-agents
- Set: simulate-agents
- Prior features in set: mock-agent-tmux-mode, dashboard-e2e-fleet-lifecycle
