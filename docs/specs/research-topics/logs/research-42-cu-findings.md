# Research Findings: simulate agents

**Agent:** Cursor (cu)
**Research ID:** 42
**Date:** 2026-04-26

---

## Key Findings

### Fake agent design

- **Simplest implementation:** The repo already has a concrete pattern: `tests/integration/mock-agent.js` (`MockAgent`). It sleeps (configurable `delays`), writes a trivial JS file scoped by `agentId` + `featureId`, commits, sleeps again, then runs **`node aigon-cli.js agent-status submitted`** from the worktree with explicit env (`AIGON_TEST_MODE`, `AIGON_ENTITY_TYPE`, `AIGON_ENTITY_ID`, `AIGON_AGENT_ID`, `AIGON_PROJECT_PATH`). The file comment documents why raw `writeAgentStatus` was rejected: the real CLI path must fire so both legacy status files and workflow signals stay aligned — a useful invariant for any “fake agent” v2.
- **New `templates/agents/fa.json` vs script:** For lifecycle testing, a **bash/node harness** is enough; registering `fa` as a first-class agent mainly matters if you want the **dashboard picker**, prompts, and shell-trap wrappers to match a “real” slot. MockAgent deliberately runs **outside** tmux and compensates with env — so “fake” does not require a new agent JSON unless the goal is UI parity with named slots.
- **Lifecycle shape:** Today’s happy path is effectively `sleep → commit → sleep → agent-status submitted → optional empty commit`. Adding `agent-status implementing` (or equivalent) would better mirror real sessions if any read path depends on ordering; worth checking against `lib/commands/misc.js` behaviour for `implementing`.
- **Configurable failure modes:** `MockAgent` already has `abort()`. Natural extensions: never call `submitted`, call `agent-status error`, exit non-zero before commit, or `kill` a child process — each maps to a different dashboard/supervisor path without LLM involvement.
- **Commits vs signals-only:** Current tests use **real trivial commits** (and branch-mode solo uses commits on the main fixture repo path). That exercises merge/close paths. A signal-only mode could be faster but might miss branch hygiene gates (`agent-status submitted` can interact with security scan / branch checks — see `misc.js`).

### Dashboard integration

- **Detection:** The dashboard API/collector derives state from **engine snapshot + agent status files + (when applicable) tmux/liveness** — not from “which binary is Claude.” Anything that writes the same artefacts the CLI writes should look like a real agent from the read model’s perspective.
- **tmux vs background:** `MockAgent` proves **non-tmux** processes can drive `submitted` if env is set correctly. Playwright e2e uses **`gotoPipelineWithMockedSessions`** so the UI does not require live agent panes for the scenarios covered in `solo-lifecycle.spec.js`. Full fidelity for heartbeat/session-lost would still want a real tmux pane or a deliberate test hook.
- **Same code paths:** Shell traps and heartbeats come from **`buildAgentCommand`** / real agent launches. Fake harness will **not** automatically exercise those unless it runs inside the same wrapper or you add a thin “stub launcher” that uses the trap script with a no-op inner command.

### Test orchestration

- **Runner shape:** Existing flow: fixture server + Playwright → prioritise/start from UI (or `feature-start` CLI) → run `MockAgent` (or inline `runSoloBranchMock`) in parallel → refresh UI → assert badges → `feature-close`. A dedicated **node test runner** could do the same without Playwright by polling **`/api/...`** or reading `.aigon/` snapshots if you want sub-second feedback loops.
- **Assertions:** Today’s e2e asserts **DOM** (`status-submitted`, valid action buttons). Deeper assertions would snapshot **workflow events** / `snapshot.json` at milestones — stronger for engine regressions, still fast if driven by MockAgent with `MOCK_DELAY=fast`.
- **Speed:** `_helpers.js` uses `{ implementing: 600, submitted: 300 }` when `MOCK_DELAY=fast` or CI — so solo-style timing is already **under ~1s** of intentional delay plus server/UI polling. Targets of 10s/20s are conservative; the bottleneck is usually **Playwright + dashboard refresh**, not MockAgent itself.

### Failure simulation

- **Crash mid-work:** Kill tmux (or the mock child) and assert liveness / session-lost presentation — orthogonal to LLM.
- **Never signals:** Omit `agent-status submitted` or stall in `implementing`; idle/stale semantics are documented as **display-only** in `AGENTS.md` — tests should assert **badges/UI**, not expect automatic engine transitions from idle alone.
- **Error signal:** Run `aigon agent-status error` with the same env discipline as `submitted`; then assert recovery actions from `validActions`.

### Existing patterns (spec correction)

- The research doc references `test/e2e-mock-solo.test.js` / `test/e2e-mock-fleet.test.js`. In this repo the analogue is **`tests/integration/mock-agent.js`** plus **`tests/e2e/solo-lifecycle.spec.js`** and **`tests/dashboard-e2e/solo-lifecycle.spec.js`**. **`FLEET_CC_DELAYS` / `FLEET_GG_DELAYS`** exist in `tests/dashboard-e2e/_helpers.js` but there is no mirrored `fleet-lifecycle.spec.js` in the grep snapshot — **fleet mock e2e looks under-developed** relative to solo; salvage by extending the same `MockAgent` pattern with two agent IDs and staggered delays, then add eval/close steps.

### External references (lightweight)

- General industry pattern: **synthetic actors** / **contract tests** / **chaos** (kill -9, network partitions) — same idea as “non-deterministic actor” without building a mini-LLM. No single OSS project maps 1:1 to “tmux + aigon CLI,” so the bespoke harness remains appropriate.

## Sources

- `tests/integration/mock-agent.js` — `MockAgent` implementation and `AIGON_*` env contract
- `tests/e2e/solo-lifecycle.spec.js` / `tests/dashboard-e2e/solo-lifecycle.spec.js` — orchestration + assertions
- `tests/dashboard-e2e/_helpers.js` — `SOLO_DELAYS`, `FLEET_*_DELAYS`, `MOCK_DELAY=fast`
- `lib/commands/misc.js` — `agent-status` behaviour and gates
- `AGENTS.md` — heartbeat/idle display-only rules, write-path contract

## Recommendation

1. **Treat `MockAgent` as the v1 “fake agent”** and extend it (failure profiles, optional `implementing` signal, faster defaults) rather than inventing a parallel harness.
2. **Add a fleet mock e2e** (or integration test) that runs two `MockAgent` instances with different `agentId`/`delays`, then drives eval — closes the biggest gap vs the research questions.
3. **Keep two tiers:** (A) fast headless tests that assert snapshots/events; (B) thinner Playwright tests that only sanity-check UI wiring. Avoid duplicating both for every scenario.
4. **Only add `templates/agents/fa.json`** if product requirement is “pick Fake Agent from dashboard like cc/gg”; otherwise a **`aigon test-agent-run`** style CLI or npm script is simpler and avoids registry churn.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| mock-agent-failure-profiles | Extend `MockAgent` (or sibling) with explicit profiles: `happy`, `never-submit`, `error-mid`, `abort-after-commit` for targeted dashboard/engine assertions | high | none |
| fleet-mock-lifecycle-e2e | Playwright (or integration) scenario: two-slot fleet → both submit → eval → close using existing `MockAgent` + staggered delays | high | none |
| workflow-snapshot-assertions | Helper that diffs workflow `events.jsonl` / snapshot at milestones for engine regressions without full browser | medium | mock-agent-failure-profiles |
| optional-fa-agent-template | Register `fa` agent JSON + minimal install hooks only if dashboard-first fake selection is required | low | mock-agent-failure-profiles |
