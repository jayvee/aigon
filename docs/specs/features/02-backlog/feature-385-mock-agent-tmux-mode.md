---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T13:10:52.138Z", actor: "cli/feature-prioritise" }
---

# Feature: mock-agent-tmux-mode

## Summary
Extend `tests/integration/mock-agent.js` (`MockAgent`) to optionally run inside a real tmux session via the same `buildAgentCommand` wrapper that real agents use. Today `MockAgent` runs in-process and shells directly to `aigon agent-status submitted`, bypassing the bash `trap EXIT` cleanup, the heartbeat sidecar, and the `_aigon_cleanup` ordering. That means a regression in shell-trap quoting, heartbeat sidecar startup, or trap-vs-status teardown order would not surface in any test. This feature swaps the resolved agent binary in the wrapper for a deterministic behaviour script (sleep → commit → exit), gated by a `MOCK_AGENT_BIN` env var (mirroring the existing `tests/integration/mock-bin/tmux` shim pattern), so simulated agents exercise the full wrapper path.

## User Stories
- [ ] As a workflow-engine maintainer, when I edit `buildAgentCommand` in `lib/worktree.js`, an existing test fails if the shell-trap or heartbeat sidecar regresses, instead of needing a real-agent run to catch it.
- [ ] As a test author, I can write fleet/failure-mode e2e specs (F#2/F#3) on top of a MockAgent variant that goes through the same launch path as cc/gg/cx.

## Acceptance Criteria
- [ ] `MockAgent` accepts an opt-in mode (e.g. `tmux: true` or `useRealWrapper: true`) that launches the behaviour script via `buildAgentCommand` inside a real tmux session.
- [ ] In that mode, the bash `trap EXIT`, heartbeat sidecar (`heartbeat-{id}-{agent}` touch loop), and `_aigon_cleanup` paths execute and are verified by at least one assertion (e.g. heartbeat file appears, then trap fires `agent-status submitted`).
- [ ] A `MOCK_AGENT_BIN` env var (or equivalent swap mechanism) is honoured by the wrapper so the real agent binary is replaced by the behaviour script with no changes to `agent-registry.js`, `agent-prompt-resolver.js`, or `templates/agents/*.json`.
- [ ] No new agent registry entry (`fa.json` or similar) is introduced; the dashboard picker remains unchanged.
- [ ] Existing in-process `MockAgent` callers (current solo dashboard-e2e) keep working unchanged when the new mode is not requested.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
node -c tests/integration/mock-agent.js
```

## Pre-authorised

## Technical Approach
- Add a behaviour script under `tests/integration/mock-bin/` (sibling to the existing `tmux` shim) — e.g. `mock-agent-bin.sh` — that sleeps, makes a trivial commit, and exits 0. Configurable delays via env (reuse `MOCK_DELAY` envelope).
- In `lib/worktree.js:buildAgentCommand` (or `buildRawAgentCommand`), if `MOCK_AGENT_BIN` is set, substitute the resolved agent binary with that path. Keep this guarded so production code paths are untouched outside test runs.
- Extend `MockAgent` with a `tmux`/`useRealWrapper` option that spawns through the wrapper instead of running in-process. Reuse the existing `AIGON_ENTITY_*` env contract.
- Add one new test (or extend an existing one) that asserts the heartbeat sidecar file appears and the trap-driven `submitted` signal fires — names the regression with a `// REGRESSION:` comment per AGENTS.md T2.
- Stay within the 2,500-LOC test ceiling — likely add ~40 LOC, well under budget.

## Dependencies
-

## Out of Scope
- A new `templates/agents/fa.json` entry — explicitly rejected by both research findings.
- A user-facing `aigon dev simulate ...` CLI surface.
- Replacing or removing the in-process `MockAgent` mode.

## Open Questions
- Should `MOCK_AGENT_BIN` be the env var name, or should it piggy-back on `AIGON_TEST_MODE`? Lean toward a separate var for clarity.

## Related
- Research: 42 — simulate-agents
- Set: simulate-agents
- Prior features in set:
