---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T14:29:17.470Z", actor: "cli/feature-prioritise" }
---

# Feature: poll-perf-dedupe-interval

## Summary

Two immediate, low-risk changes to reduce dashboard cost and contention without changing the **JSON contract** the Kanban already consumes:

1. **Dedupe read-model work inside one poll** — today `collectFeatures` / `collectResearch` in `lib/dashboard-status-collector.js` call `getFeatureDashboardState` / `getResearchDashboardState` **twice** per entity (first with empty agents to discover stage, then again with built agent rows). Each call re-enters `getBaseDashboardState`, which re-reads **snapshot** and **filtered workflow events** (`readFeatureEventsSync` / `filterAgentSignalEvents`). Collapse to **one full read-model pass per feature/research row** while preserving identical rendered fields (`validActions`, `agents`, eval/review/auxiliary payloads).

2. **Stretch active polling cadence** — raise `POLL_INTERVAL_ACTIVE_MS` in `lib/dashboard-server.js` from **10s → 20s** and align the browser **`POLL_MS`** in `templates/dashboard/js/state.js` so the dashboard does not request **`/api/status`** twice per server poll cycle while `getLatestStatus()` is still refreshed by `pollStatus()` half as often. **Immediate relief** on aggregate CPU/event-loop contention; does **not** shorten a single **`collectDashboardStatusData()`** run (that's what (1) targets).

Together this locks quick wins documented in discussions after **F459** (done-folder enumeration trim). **Deeper** work — lazy summaries, split APIs, narrower rows — stays **out of scope**.

## User Stories

- [ ] As an operator with large conductor workspaces (`Poll complete ~2–3s+`), I see **meaningfully lower average poll cost** without changing card behaviour or action buttons.
- [ ] As a dashboard user, I accept Kanban/auto-refresh fidelity on the order of **~20s** when work is actively **in-flight** (`active` poll interval), matching server refresh timing (manual Refresh unchanged).

## Acceptance Criteria

- [ ] **No HTTP contract change**: `collectDashboardStatusData()` output shape consumed by **`GET /api/status`** stays compatible — same keys for feature/research rows; **`validActions`** still derived exclusively via existing workflow/rules + adapter path (never a second heuristic).
- [ ] **`getFeatureDashboardState` / `getResearchDashboardState`**: per workflow-backed entity in the collector, **snapshot + events stream are not read twice** solely to bridge “empty agents → full agents” — implement via optional **`baseState` reuse / internal helper** in `lib/workflow-read-model.js` (exact API left to implementer; must preserve current semantics for inbox `currentStage === 'inbox'` folder authority per `getBaseDashboardState`).
- [ ] **`POLL_INTERVAL_ACTIVE_MS === 20000`** where it lives today (`lib/dashboard-server.js`); **`POLL_MS === 20000`** in `templates/dashboard/js/state.js` (adjust nearby comments referencing 10s where they describe poll cadence).
- [ ] Idle interval (`POLL_INTERVAL_IDLE_MS`, 60s) **unchanged** unless adjusting both is mechanically required — prefer **leave idle as-is**.
- [ ] **`dashboard.log`** (or timing hook): after deployment on a comparable workspace, document **before/after median `Poll complete (… Xms)`** in the implementation log paragraph or commit message body (baseline need not live in-repo).
- [ ] **`npm test`** passes; **`npm run test:iterate`** passes. **`npm run test:ui`** if this iteration touches `templates/dashboard/**` ( **`state.js` yes** ) per project gate — or cite Pre-authorised skip only if untouched.
- [ ] Regression test naming the dual-call removal: **`// REGRESSION: ...`** — e.g. stub/metric that `readFeatureSnapshotSync` / snapshot read helpers are invoked once per collector feature pass, OR integration equivalence test mirroring today's outputs on a canned fixture repo (pick one; avoid flaky tests).

## Validation

```bash
npm run test:iterate
```

Pre-push (operator / feature-close): `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`

## Pre-authorised

- May skip `npm run test:ui` mid-iteration **only** when an iteration touches **no** dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, **including** dashboard route aggregators touching server). **This feature touches `state.js`** — assume **Playwright / test:ui** runs at least once before merge unless a later iteration avoids `templates/` entirely after the POLL_MS lands.

## Technical Approach

### A. Dedupe (core)

**Current shape** (`dashboard-status-collector.js`, workflow feature branch):

```
initialState = getFeatureDashboardState(repo, id, null, [])
agents = buildFeatureAgentsFromSnapshot(...)
featureState = getFeatureDashboardState(repo, id, stage, agents)
```

**Problem**: second call repeats `getBaseDashboardState` I/O documented in `lib/workflow-read-model.js:540+` (nested `readFeatureEventsSync`/filter pipeline).

**Direction**:

- Add a **narrow extension** such as **`getFeatureDashboardState(repo, featureId, currentStage, agents, { baseStateHint })`** — when callers pass **`baseStateHint`** equal to output of **`getBaseDashboardState`** from the preliminary pass-with-null-stage-without-full-enrichment**, skip re-reading snapshot/events **inside** full feature state derivation **once** agents are assembled.

Prefer **implementer refactors internals** (`getFeatureDashboardState` + `getResearchDashboardState`) so callers stay readable; duplication between feature/research should be symmetrical.

Mirror the same pattern for **research** collector path calling **`getResearchDashboardState` twice** with `[]` vs built `agents`.

**Verify**: run existing integration tests touching workflow read-model / collector; grep for **`getFeatureDashboardState`** call count patterns in collector.

### B. Interval (config)

- **`lib/dashboard-server.js`**: set **`POLL_INTERVAL_ACTIVE_MS`** to **`20_000`**. Preserve **`POLL_INTERVAL_IDLE_MS`** at **`60_000`** unless ergonomics dictate both align (default: no).
- **`templates/dashboard/js/state.js`**: **`POLL_MS = 20000`**; grep **`templates/dashboard/**/*.js`** and **`lib/dashboard-status-helpers.js`** /**`workflow-snapshot-adapter.js`** for stale “every 10s” copy and fix **comment-only**.
- **No new user-facing knob** required for v1 — a follow-on feature could read `pollIntervalActiveMs` from `~/.aigon/config.json` if demanded.

### C. Operational

- **`aigon server restart`** after **`lib/**/*.js`** edits per project rules.

## Dependencies

- **F459** (`feature-459-dashboard-status-collector-skip-done-reads`) — complements that work; this feature assumes F459 landed (done-folder fast path unchanged).

## Out of Scope

- Lazy-loaded Kanban summary payloads, **`/api/status/split`**, narrower row DTOs.
- Changing **idle** (60 s) interval unless mechanically bundled.
- **Configurable poll** via project settings UI — deferred.
- Fixing **duplicate reads** wholly outside **`getFeatureDashboardState`** unless discovered by profiling during implementation (narrow scope creep only with spec amendment).

## Open Questions

- Should **client** **`POLL_MS`** stay strictly equal server active interval forever, or use **`max(POLL_MS, serverHint)`** if we later expose config? **v1**: match constants explicitly.

## Related

- **F459** — done enumeration filename-only (`collectDoneSpecs`).
- **F454** — fingerprint / render skip / quota mid-run sequencing (don't regress event-loop unblock patterns).
- Operational context: **`Poll complete (… Xms)`** user telemetry ~**2.3–3.1 s** at ~**666 F / 7 repos** prior to this work.
