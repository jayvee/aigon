---
complexity: medium
set: simulate-agents
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T13:10:59.698Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-e2e-fleet-lifecycle

## Summary
Add `tests/dashboard-e2e/fleet-lifecycle.spec.js`, a Playwright spec that drives the real dashboard through a full Fleet lifecycle using two `MockAgent` instances. Today only the solo lifecycle is e2e-covered (`tests/dashboard-e2e/solo-lifecycle.spec.js`); the staggered-finish constants `FLEET_CC_DELAYS` / `FLEET_GG_DELAYS` already exist in `tests/dashboard-e2e/_helpers.js` but no spec consumes them. The Fleet path — concurrent implement → both submit → eval session → winner pick → `feature-close <winner>` — is the largest gap flagged by both research agents.

## User Stories
- [ ] As a workflow maintainer editing Fleet-mode code (`feature-eval`, `AutoConductor` fleet branch, winner-pick, `feature-close <winner>`), I get a fast deterministic e2e that catches regressions without needing real CC + GG runs.
- [ ] As a release engineer, the pre-push test gate (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`) covers the Fleet lifecycle, not just solo.

## Acceptance Criteria
- [ ] `tests/dashboard-e2e/fleet-lifecycle.spec.js` exists and runs under the same harness as `solo-lifecycle.spec.js` (real `aigon server start`, brewboard fixture, tmpdir HOME).
- [ ] Two `MockAgent` instances (cc + gg) run concurrently with the existing `FLEET_CC_DELAYS` / `FLEET_GG_DELAYS` from `_helpers.js`; the constants are now consumed, not dead.
- [ ] The spec exercises: feature-start with both agents → both implement → both submit → eval session spawns → winner is picked → `feature-close <winner>` → dashboard reflects closed state.
- [ ] Asserts at each milestone: dashboard `currentSpecState`, agent status badges, `validActions` payload, and final closed state.
- [ ] Total runtime under 20s with `MOCK_DELAY=fast` (research target).
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
MOCK_DELAY=fast npx playwright test tests/dashboard-e2e/fleet-lifecycle.spec.js
```

## Pre-authorised

## Technical Approach
- Mirror the structure of `tests/dashboard-e2e/solo-lifecycle.spec.js`. Reuse `_helpers.js` (`gotoPipelineWithMockedSessions`, fixture setup, port allocation).
- Use `mock-agent-tmux-mode` (depends_on) so both mock agents run inside real tmux via `buildAgentCommand`, exercising the shell-trap and heartbeat sidecar paths in the Fleet variant too.
- Drive the eval phase through whatever Fleet-mode entrypoint the AutoConductor or the dashboard uses today; if the eval winner is determined by agent output, mock the winner declaration through the `MockAgent` write of `**Winner:**` text in the eval log file (the contract `AutoConductor` polls for).
- Stay within the 2,500-LOC test ceiling — budget ~80–120 LOC. Before adding, audit whether any current solo helper duplicates logic that could be extracted to `_helpers.js` to keep both specs DRY.
- Includes a `// REGRESSION:` comment naming the specific Fleet-path regression class this spec guards (e.g. winner-pick → close transition).

## Dependencies
- depends_on: mock-agent-tmux-mode

## Out of Scope
- Solo lifecycle changes.
- Fleet-mode product changes — this is a test-only feature.
- Multi-winner / no-winner edge cases — covered by failure-modes spec (F#3).

## Open Questions
- Does `AutoConductor` need to be running for this test, or can the spec drive winner-pick directly through the dashboard UI? Confirm during implementation; both paths are valid.

## Related
- Research: 42 — simulate-agents
- Set: simulate-agents
- Prior features in set: mock-agent-tmux-mode
