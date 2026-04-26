# Research Findings: simulate agents

**Agent:** Claude (cc)
**Research ID:** 42
**Date:** 2026-04-26

---

## Key Findings

### 1. A simulator already exists — it's just under-leveraged

`tests/integration/mock-agent.js` (`MockAgent`) is exactly the primitive this research is asking
about. It lives in a worktree, sleeps to simulate "thinking", makes a real git commit, then
shells out to the **real CLI** (`node aigon-cli.js agent-status submitted`) with explicit
`AIGON_ENTITY_*` env vars. Its inline comment is load-bearing context:

> REGRESSION: invokes the real CLI path so that the legacy status file write AND
> `wf.emitSignal()` both fire — bypassing with `writeAgentStatus` once caused silent test rot
> where dashboards never saw 'submitted' and e2e failed quietly.

This already hits the "simulated agent must exercise the real signal path" criterion. The
`tests/dashboard-e2e/` Playwright suite (`solo-lifecycle.spec.js`) drives a real dashboard
(`aigon server start` on port 4119, brewboard fixture under tmpdir HOME), clicks through the
real Kanban UI, and uses `MockAgent` to provide the implementer side. With `MOCK_DELAY=fast`
the implement/submit delays drop to **600ms / 300ms** (`tests/dashboard-e2e/_helpers.js:11`),
so a full solo lifecycle can in principle run in under 10s. **This already meets target #3
in the research spec.**

A mock-tmux shim (`tests/integration/mock-bin/tmux`) exists for unit-level integration tests
(`AIGON_MOCK_LOG`, configurable exit code) — used to assert tmux invocations without launching
real panes. Mock-bin lives on `PATH` for those tests via `_helpers.js`.

### 2. What's actually missing

The research questions that aren't answered by current code:

| Question | Status | Gap |
|----------|--------|-----|
| Solo lifecycle simulation | ✅ Covered (`tests/dashboard-e2e/solo-lifecycle.spec.js`) | Could go faster with shorter `MOCK_DELAY=fast` defaults |
| **Fleet lifecycle simulation** | ❌ No fleet variant of the dashboard-e2e | **Real gap** — fleet eval/winner-pick/close path has no e2e |
| Failure modes (crash mid-work) | ❌ Not simulated | `MockAgent.abort()` exists but no test calls it then asserts dashboard recovery |
| Failure modes (heartbeat expiry) | ❌ Not simulated | Heartbeat is "display-only" per AGENTS.md but liveness rendering has no e2e |
| Failure modes (`agent-status error`) | ❌ Not simulated | No test runs `aigon agent-status error` then checks dashboard recovery actions |
| MockAgent inside real tmux | ❌ Bypasses tmux | `MockAgent.run()` runs in-process, so `buildAgentCommand` shell-trap, heartbeat sidecar, `_aigon_cleanup` paths are **not** exercised end-to-end |
| Reusable outside tests | ❌ Not a CLI command | If you want to debug a workflow bug locally without launching a real CC, you must hand-roll `agent-status` calls or write a one-off node script |

The shell-trap gap is the most important one. `lib/worktree.js:521` `buildAgentCommand` wraps
the real agent CLI in a bash heredoc that:
- exports `AIGON_ENTITY_TYPE`, `AIGON_ENTITY_ID`, `AIGON_AGENT_ID`
- sets up `_aigon_cleanup` EXIT trap that calls `aigon agent-status submitted/error`
- launches a heartbeat sidecar (`while kill -0 $$; do touch heartbeat-{id}-{agent}; sleep 30; done &`)

`MockAgent` calls `aigon agent-status submitted` directly, which means a real-tmux + real-trap
test would catch a different class of bug: a regression to the trap shell quoting, a heartbeat
sidecar that fails to start, or a teardown ordering bug between trap and `agent-status`.

### 3. Don't create an `fa.json` agent template

Tempting answer: register a "fake agent" via `templates/agents/fa.json` so it goes through
`agent-registry.js`, `agent-prompt-resolver.js`, and `agent-launch.js` like a real agent. **This
is the wrong shape**, for these reasons:

- The agent registry is the public contract the dashboard uses to pick agents in the start-modal.
  A user shouldn't see "Fake Agent" in the picker — and gating it with a `hidden: true` field
  introduces a per-consumer special case (the same pattern that bit `terminal-adapters` before
  F350's registry refactor — see AGENTS.md).
- Real-agent JSON files own things `fa` shouldn't: `cli.command` (binary name), trust dialog
  config, install hints, model lists. Half of those fields don't apply.
- A fake agent that runs through `buildAgentCommand` only differs from a real one in **two**
  places: which binary the wrapper exec's (real `claude` vs a sleep-and-commit script), and
  which prompt body it's handed (irrelevant to a fake). Conceptually it's one of the existing
  agents with a different binary on PATH.

Better shape: a `MOCK_AGENT_BIN` env var (or `AIGON_FAKE_AGENT=1`) that swaps the resolved
agent binary in `buildRawAgentCommand` for a deterministic shell script. The agent **still
appears in the dashboard as `cc` / `gg` / etc.**, the registry is unchanged, and the entire
trap/heartbeat/cleanup wrapper runs untouched. This mirrors the `mock-bin/tmux` pattern that
already works.

### 4. Speed targets are achievable but already mostly achieved

Solo target (under 10s): Already true with `MOCK_DELAY=fast` (600+300ms agent + ~2-3s for
dashboard refresh + close). Last solo-lifecycle Playwright run on this branch shows
~7-8s for the worktree variant.

Fleet target (under 20s): Plausible. `FLEET_CC_DELAYS = {3000, 1500}` and
`FLEET_GG_DELAYS = {8000, 1500}` in `_helpers.js` already encode the staggered-finish pattern,
but no fleet-lifecycle test consumes them. With `MOCK_DELAY=fast` overrides those could drop
to ~600ms / ~1500ms (fast cc, slow gg), so a full fleet lifecycle could land at ~15s.

### 5. Failure-mode simulation is mostly orthogonal to the simulator

Each failure mode maps to a tiny, separate test pattern, not to extending `MockAgent`:

- **Crash mid-work** → spawn `MockAgent`, immediately `tmux kill-session -t <name>`, assert
  dashboard `currentSpecState` and rendered status. (Real tmux required.)
- **Never signals** → spawn a script that `sleep 9999`s without ever calling `agent-status`,
  let heartbeat staleness threshold pass, check `idleState` and badge.
- **Signals error** → swap `agent-status submitted` for `agent-status error` in the script,
  check dashboard recovery actions.

These don't need a unified "fake agent harness" — they need a small library of "agent
behaviour scripts" (sleep+commit, sleep-then-die, sleep-forever, signal-error) plus a way to
spawn them inside real tmux via the existing `buildAgentCommand` path.

## Sources

- `tests/integration/mock-agent.js` — existing MockAgent primitive
- `tests/integration/mock-bin/tmux` — mock tmux shim pattern
- `tests/dashboard-e2e/solo-lifecycle.spec.js` — solo lifecycle test, real dashboard
- `tests/dashboard-e2e/_helpers.js:10-15` — `MOCK_DELAY=fast` envelope, fleet delay constants (unused)
- `tests/dashboard-e2e/setup.js` — pattern for spawning a real dashboard against a fixture repo
- `lib/worktree.js:521-661` `buildAgentCommand` — the shell-trap wrapper a fully realistic simulator must exercise
- `tests/integration/lifecycle.test.js` — engine-level lifecycle tests (no dashboard, no tmux)
- `tests/integration/submit-signal-loss.test.js` — pattern for shelling to real CLI with `AIGON_ENTITY_*` env

## Recommendation

**Don't build a new "fake agent" subsystem.** Build out three small, sharply-scoped extensions
to the existing `MockAgent` + dashboard-e2e harness:

1. **Promote `MockAgent` to optionally run inside real tmux via `buildAgentCommand`.** Add
   a small "behaviour script" the wrapper exec's (sleep, commit, exit cleanly) instead of
   the real agent binary, swapped in via `MOCK_AGENT_BIN`. This closes the shell-trap /
   heartbeat / cleanup coverage gap.

2. **Add `tests/dashboard-e2e/fleet-lifecycle.spec.js`** that runs two `MockAgent`s
   concurrently with the existing `FLEET_CC_DELAYS` / `FLEET_GG_DELAYS` (currently unused),
   exercises the eval session, the winner-pick, and `feature-close <winner>`. Reuses every
   helper from `_helpers.js`.

3. **Add a small `tests/dashboard-e2e/failure-modes.spec.js`** with one test per failure
   mode (crash, no-signal, error), each driving a deliberately misbehaving variant of
   `MockAgent` and asserting the dashboard renders the expected recovery state.

The unifying theme: keep simulation as testing infrastructure, never as a registered agent.
The dashboard, agent registry, and engine should be unaware of the difference. This protects
the F350-style invariant (one source of truth per consumer surface) and avoids the
maintenance tax of a `fa` agent type whose half the JSON fields would be `null`.

A `aigon dev simulate <featureId> <agentId>` CLI is **not recommended** as part of the
initial work — it's a manual debugging convenience, not a workflow-test enabler, and would
add a public command surface for an internal mechanism. If a need arises for one later it's
a 30-line wrapper around a behaviour script and can be added at zero cost.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| mock-agent-tmux-mode | Add an opt-in mode to `MockAgent` that runs the behaviour script inside a real tmux session via `buildAgentCommand`, exercising the shell-trap, heartbeat sidecar, and cleanup paths end-to-end. | high | none |
| dashboard-e2e-fleet-lifecycle | Add a Playwright fleet-lifecycle spec (start with cc+gg → both submit → eval → winner-pick → close) using two `MockAgent`s and the existing `FLEET_CC_DELAYS`/`FLEET_GG_DELAYS` constants that are currently unused. | high | mock-agent-tmux-mode |
| dashboard-e2e-failure-modes | Add a Playwright failure-modes spec covering crash-mid-work, never-signals, and `agent-status error` paths. Each test drives a deliberately misbehaving `MockAgent` variant and asserts dashboard renders the expected recovery state. | medium | mock-agent-tmux-mode |
| mock-delay-fast-default-in-ci | Default `MOCK_DELAY=fast` for CI runs (drop solo lifecycle from ~25s to ~7s) and audit any tests that would regress under fast delays. | low | none |
