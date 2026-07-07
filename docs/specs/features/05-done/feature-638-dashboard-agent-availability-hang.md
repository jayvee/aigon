---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T12:36:37.148Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-agent-availability-hang

## Summary
The dashboard HTML page (`GET /`) and `aigon server status` hang indefinitely
because `getDashboardAgents()` (in `lib/agent-registry.js`) never returns. Every
`/` request builds the page via `buildDashboardHtml → getDashboardAgents`, which
calls `getAgentAvailability(id)` (`lib/agent-availability.js`) for each launchable
agent. That path spins/loops, firing an unbounded stream of `command -v claude`,
`command -v codex`, `command -v agent` probes (hundreds within seconds — a
100%-CPU busy pattern). Because the server builds the page on its own event loop,
a single `/` request can wedge the whole server until it is restarted. The data
API (`/api/health`, `/api/status`) is unaffected — only paths that call
`getDashboardAgents` hang.

**Impact:** the browser dashboard shell cannot load, and any `getDashboardAgents`
caller (the `/` route, `aigon server status`) hangs and can hard-wedge the server.
This is separate from F637 (the status-poll perf fix), which is done and works.

### Evidence (captured 2026-07-07)
- Isolated call: `getDashboardAgents({...})` never returns (killed at 8–12s).
- Trace of `getAgentAvailability('ag')`: emits an endless repeating sequence of
  `execSync command -v claude` / `command -v codex` / `command -v agent` — the
  same binaries re-probed over and over (not once-per-agent). Two leftover test
  processes were observed pegging ~100% CPU each, confirming a busy-loop rather
  than a blocked spawn.
- **Not agent-specific.** Per-agent probe of every launchable agent
  (`am, cc, cu, cx, km, op`) hangs identically. `ag` only appeared first because
  it sorts first alphabetically. Setting `ag.active = false` (excluding it from
  launchable agents) did NOT fix `/` — another agent's probe still hangs.
- **Disabling via `aigon agent disable` does NOT help**: `getAgentAvailability`
  runs `readQuotaAnnotation()` (line ~179) — which calls
  `quota-probe.isPairDepleted(repoPath, agentId, modelValue)` — *before* the
  `userPreference`/`disabled` early-return (line ~195). So the loop is reached
  regardless of the agent's disabled state.

### ✅ CONFIRMED ROOT CAUSE (verified 2026-07-07 on a clean, freshly-rebooted machine)
It is a **genuine unbounded mutual recursion**, not environmental slowness.
Measured **4,870 `command -v` spawns in 12s** (~400/sec) from a single
`getAgentAvailability('cc')` call with the probe enabled — a real infinite loop.

The cycle (no re-entrancy guard anywhere in it):
```
getAgentAvailability(agentId)                       lib/agent-availability.js
  → readQuotaAnnotation(agentId)                    (line ~179, runs BEFORE the disabled early-return)
    → quota-probe.isPairDepleted(agentId)           lib/quota-probe.js:196
      → readQuotaState()                            lib/quota-probe.js  (= projectQuotaApi(readAgentQuotaState()))
        → agentQuotaRead.projectQuotaApi(state)     lib/agent-quota-read.js  — loops over EVERY agent in state
          → isAgentQuotaPanelVisible(agentId)       lib/agent-availability.js
            → getAgentAvailability(agentId)          ← RE-ENTERS. loop never terminates.
```
Every re-entry runs `isAgentCliInstalled → isBinaryAvailable → execSync("command -v <cli>")`
for cc/cx/cu, which is the `command -v claude/codex/agent` flood.

**Regression introduced by:** `efd665a13` — *"feat: unify agent quota state under
single poller and cache"* (2026-07-07). That commit made `projectQuotaApi`
availability-aware (it now filters agents via `isAgentQuotaPanelVisible →
getAgentAvailability`), closing the loop with `getAgentAvailability`'s existing
quota annotation. Before it, the quota projection didn't call back into
availability.

**Why the whole server wedges:** the `/` route (`buildDashboardHtml →
getDashboardAgents`) calls `getAgentAvailability` synchronously on the server's
event loop; one `/` request enters the loop and never returns → hard wedge until
restart. `/api/health` / `/api/status` don't call it, so they stay responsive.

## User Stories
- [ ] As an operator, opening `http://localhost:4100/` loads the dashboard shell
      quickly (sub-second) instead of hanging.
- [ ] As an operator, `aigon server status` returns promptly.
- [ ] As an operator, a `/` request can never wedge the server's event loop.

## Acceptance Criteria
- [ ] Reproduce the hang deterministically in a clean environment (a failing
      test or a timed script showing `getDashboardAgents` / `getAgentAvailability`
      not returning within, say, 1s).
- [ ] Root-cause the loop (confirm it is `quota-probe.isPairDepleted` or name the
      actual offender) and fix it so `getAgentAvailability(id)` returns in
      **< 50ms** per agent with no repeated `command -v` probes.
- [ ] `getDashboardAgents()` returns in **< 250ms** total for all launchable
      agents; add a regression test asserting a bounded call.
- [ ] `GET /` responds **< 1s** (page shell) and never blocks the event loop;
      `/api/health` stays responsive while `/` is served.
- [ ] Add a defensive bound so no availability/quota probe can spin unbounded
      (memoize the CLI-presence map per call/tick; and/or a hard iteration guard),
      so a future regression degrades gracefully instead of wedging the server.
- [ ] `npm run test:iterate` passes.

## Validation
```bash
npm run test:iterate
```

## Technical Approach (root cause now known — break the cycle)

**Primary fix — Option A (recommended): stop `isPairDepleted` from reading the
availability-filtered projection.** `isPairDepleted` only needs one agent's model
verdict: `state.agents[agentId].models[modelKey]`. It currently goes through
`readQuotaState()` = `projectQuotaApi(readAgentQuotaState())`, and `projectQuotaApi`
is the availability-aware VIEW that calls `isAgentQuotaPanelVisible →
getAgentAvailability`. Change `isPairDepleted` (and any other internal, non-API
consumer) to read the **raw** `agentQuotaRead.readAgentQuotaState(repoPath)`
instead of the projected `readQuotaState`. The projection filter is for
API/dashboard responses, not for the internal depletion lookup. This removes
`getAgentAvailability` from the `isPairDepleted` path entirely → no recursion.

**Complementary fix — Option B: make `isAgentQuotaPanelVisible` quota-free.** It
only needs `state !== 'disabled' && state !== 'retired'`, which derive from
`readRegistryPolicy` + `readUserAvailability` + `isAgentLaunchable` — none of which
read quota. Compute disabled/retired directly instead of calling the full
`getAgentAvailability`. Breaks the cycle at the other end and is defensive even if
another quota path re-introduces the annotation.

**Safety net — Option C: re-entrancy guard.** Add a per-repo in-progress `Set` (or
a synchronous recursion-depth guard) in `getAgentAvailability` so a re-entrant call
returns a quota-free result immediately instead of looping. Keeps a future
regression from ever hard-wedging the dashboard again.

**Recommended: do A + C.** A fixes this specific cycle at the correct layer; C is
cheap insurance. B is worth doing too if `isAgentQuotaPanelVisible` has other
callers that don't need quota.

**Remove the kill-switch.** Once the recursion is fixed, delete the
`AIGON_ENABLE_AGENT_AVAILABILITY` guard block at the top of `getAgentAvailability`
(commit `bf01e59db`) and restore real availability. Verify `GET /` loads (<1s) and
the agent picker again reflects real install/auth/quota state.

**Invariant:** `getDashboardAgents` output shape must not change — this is a
correctness/termination fix, not a data change.

**Regression tests to add:**
- `getAgentAvailability(id)` returns in <50ms and issues `command -v` at most once
  per binary (spy on `child_process`); no re-entry.
- `getDashboardAgents()` returns <250ms for all launchable agents.
- A direct assertion that `isPairDepleted` does NOT call `getAgentAvailability`
  (guards the layering so the cycle can't come back).

## Dependencies
- Independent of F637 (status-poll perf), though both are "dashboard hangs on the
  aigon repo" symptoms. F637 fixed the recurring poll blackout; this fixes the
  `/` page-load / `server status` hang.

## Out of Scope
- The Antigravity (`ag`) agent migration itself. `ag`'s `authCheck`/quota config
  runs `agy --dangerously-skip-permissions -p "…"` (an actual LLM invocation) as
  a probe — worth reviewing separately for whether that should ever run
  synchronously on a dashboard code path — but the hang is NOT ag-specific, so it
  is not the root cause here.
- Any change to the status-poll collector (F637 territory).

## Open Questions
- Is it a true infinite loop or severe slowness under load? (Reproduce clean.)
- Which exact function emits the repeated `command -v` — `quota-probe`,
  `getAgentBinMap`, `isBinaryAvailable`, or a provider crosswalk?
- Should availability/quota CLI probing ever be synchronous on the `/` request
  path at all, or should `getDashboardAgents` read only cached availability and
  let a background job refresh it?

## Related
- Prior work: F637 (dashboard-poll spec-review git cache) — sibling dashboard-hang
  fix from the same session.
- Files: `lib/agent-registry.js` (`getDashboardAgents`), `lib/agent-availability.js`
  (`getAgentAvailability`, `readQuotaAnnotation`), `lib/quota-probe.js`
  (`isPairDepleted`), plus CLI-presence helpers (`isBinaryAvailable`,
  `getAgentBinMap`).
- Context: Gemini→Antigravity migration (the `ag` agent) — related surface area,
  not the root cause.
