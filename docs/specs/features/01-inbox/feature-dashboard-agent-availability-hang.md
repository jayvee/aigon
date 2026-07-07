---
complexity: high
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

### Prime suspect
`readQuotaAnnotation` → `require('./quota-probe').isPairDepleted(repoPath, agentId,
modelValue)`. The repeated `command -v <cli>` probes point at CLI/binary
availability resolution inside the quota-probe (or a helper it calls) that
re-enters without terminating — likely a memoization/cache miss causing repeated
rebuilds, or a circular resolution across agents/providers. **Confirm by
profiling `quota-probe.isPairDepleted` in isolation** (it was not fully isolated
before because the debugging environment was under heavy load — see caveat).

### Caveat on the investigation environment
Diagnosis happened on a machine under heavy load (26-day uptime, load avg ~4.7,
plus runaway debug processes from the investigation, since cleaned up). That
load muddied timing signal. A **clean-environment reproduction is the first
step** — confirm `getDashboardAgents` / `getAgentAvailability` / `isPairDepleted`
genuinely infinite-loop (vs. merely slow) before fixing. The busy-loop trace
(hundreds of identical `command -v` in seconds) strongly indicates a real loop,
but verify deterministically.

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

## Technical Approach
1. **Reproduce cleanly.** Timed harness around `agent-availability.getAgentAvailability`
   and `agent-registry.getDashboardAgents`; assert bounded return. Trace
   `child_process` to capture the exact repeated command and its caller stack.
2. **Locate the loop.** Start at `readQuotaAnnotation → quota-probe.isPairDepleted`.
   Inspect any per-agent/per-provider CLI-presence resolution (the `command -v`
   source — likely `getAgentBinMap` / `isBinaryAvailable` / a provider→agent
   crosswalk) for a missing memo or circular re-entry.
3. **Fix the loop** at its source (terminate the recursion / add the missing
   cache), and **memoize CLI-presence detection** so `command -v <cli>` runs at
   most once per binary per collect pass (thread a small cache like F637 did for
   `git rev-parse HEAD`).
4. **Add a hard safety bound** in the availability path so it cannot spin
   indefinitely even if a future change reintroduces a cycle — this is what keeps
   a bug here from hard-wedging the whole dashboard.

**Invariant:** `getDashboardAgents` output shape must not change — this is a
correctness/termination fix, not a data change.

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
