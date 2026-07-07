---
complexity: very-high
set: quota
depends_on: [615]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T00:47:50.719Z", actor: "cli/feature-prioritise" }
---

# Feature: unified-agent-quota-state

## Summary

Consolidate today's split **budget** (F322 subscription-window scrapes → `.aigon/budget-cache.json`) and **quota** (F444 headless probes → `.aigon/state/quota.json`, plus F615 provider wallet polls) into **one agent-quota capability**: a single background poller, one durable state file, one dashboard/API surface, and one manual refresh path. The split produced duplicate 30-minute timers, redundant agent CLI launches on every server restart (notably Antigravity opening multiple Chrome login tabs), and a UI that already looks unified (F457) but is fed by two independent backends. This feature keeps the distinct *measurement techniques* (usage scrape vs PONG probe vs provider HTTP) but orchestrates them sequentially under one scheduler with shared cache-age gating, rate limits, and auth-failure backoff.

## User Stories

- As an operator, I want the dashboard to show agent quota health from **one API and one cache file** so I am not debugging two pollers when something misbehaves.
- As an operator, I want **one ↻ refresh** (and one background schedule) to update subscription bars, probe verdicts, and provider balances together — without launching the same CLI twice in the same minute.
- As an operator, I want **server restarts to not trigger immediate agent polls** when on-disk cache is still fresh; stale data should be served until the next scheduled tick.
- As a user starting a feature, I want `feature-start` and the agent picker to read the **same canonical state** for "can run" (probe verdict) and "should warn" (budget % low) without reconciling two files.
- As a maintainer, I want a **single schema version** and `aigon doctor --fix` migration from `budget-cache.json` + `quota.json` so upgrades are one path.

## Acceptance Criteria

### Unified state + poller
- [ ] New canonical cache: `.aigon/state/agent-quota.json` with `schemaVersion: 1` (or `3` if continuing quota.json lineage — pick one and document). Shape merges:
  - per-agent **budget** windows (today's `budget-cache.json` cc/cx/km/ag tier objects + `polled_at`)
  - per-agent **models** probe verdicts (today's `quota.json` agents.*.models)
  - per-provider **wallet** blocks (today's F615 `providers` subtree when `depends_on` is satisfied)
  - top-level `lastPollAt`, `lastPollPhases` (budget|probe|provider timestamps) for observability
- [ ] New module `lib/agent-quota-poller.js` (or `lib/agent-quota/` package if split stays ≤3 files) owns **one** `setInterval` driven by `quota.pollIntervalSeconds` (default 1800). Phases run **in order** per tick: budget scrape → headless probe (default model only in background; all models on manual refresh) → provider HTTP. **One** `MIN_REFRESH_GAP_MS` and **no** duplicate startup timers.
- [ ] **Cache-age gating on startup:** when the server starts, **do not poll** if `lastPollAt` (or per-phase timestamps) is younger than `pollIntervalSeconds`. Serve existing file via API immediately. Optional env override `AIGON_QUOTA_POLL_ON_START=1` for maintainers.
- [ ] **Auth-safe Antigravity:** automated ticks never launch interactive `agy` (retain F615-incident guard). Budget scrape for `ag` only when `ANTIGRAVITY_TOKEN` is set or manual `force` refresh; otherwise budget section stays null/stale with explicit `probeMethod: 'skipped-interactive-auth'`.
- [ ] `aigon doctor --fix` migration merges legacy `budget-cache.json` + `quota.json` into `agent-quota.json` idempotently; legacy files may remain as read-only fallbacks for one release then are ignored.

### API + consumers
- [ ] `GET /api/agent-quota` returns the unified document (filtered by `agent-availability` as today).
- [ ] `POST /api/agent-quota/refresh` triggers one coordinated poll (`force: true`, all models, provider pass). Rate-limited (≥5 min gap unless `?force=1` for maintainer CLI).
- [ ] **Compatibility shims** for one release: `GET /api/budget` and `GET /api/quota` project slices from unified state (no separate writes). `POST /api/budget/refresh` and `POST /api/quota/refresh` delegate to the unified refresh handler. Deprecation comment in route modules.
- [ ] `feature-start`, `quota-mid-run-detector`, `agent-resume`, schedule-after-reset helpers read unified state via a single `lib/agent-quota-read.js` barrel — no direct `budget-cache.json` / `quota.json` reads in command or dashboard paths after cutover.
- [ ] `quota.refreshed` server events still fire when probe verdicts change (event shape unchanged for dashboard WS clients).

### Dashboard UI
- [ ] `templates/dashboard/js/budget-widget.js` (rename optional; behaviour required) fetches **only** `/api/agent-quota` and renders the existing collapsed/expanded Agent Quota Usage panel without requiring two fetches.
- [ ] Single ↻ control calls `/api/agent-quota/refresh` once.
- [ ] Agent picker / autonomous modal annotations derive budget + probe rollup from the same payload.

### CLI + docs
- [ ] `aigon agent-probe --quota` writes through unified state (or documents that it updates the probe subsection only).
- [ ] Site docs (`site/content/guides/pipeline-quota.mdx`, `agent-quota-awareness.mdx`) describe one cache file and one poll loop.
- [ ] `AGENTS.md` module map updated; `lib/budget-poller.js` and `lib/quota-poller.js` deleted or reduced to thin re-exports with deprecation warnings.

### Tests
- [ ] Integration test: startup with fresh cache → poller does **not** spawn probe subprocess (mock `spawn` / inject clock).
- [ ] Integration test: manual refresh runs all phases once; second refresh within gap is no-op.
- [ ] Migration test: fixture legacy files → unified schema round-trip.
- [ ] REGRESSION test: Antigravity automated tick does not call `pollAntigravityBudget` without token/force.

## Validation

```bash
node -c lib/agent-quota-poller.js
npm run test:iterate
```

## Technical Approach

### Problem recap (incident class)

| Today | Issue |
|-------|-------|
| `startBudgetPoller` + `startQuotaPoller` both register on `dashboard-server.js` start | Two timers, two immediate (now: delayed) ticks |
| Budget `ag` uses interactive tmux `agy`; quota uses headless `agy -p` × N models | Duplicate browser login tabs when unauthenticated |
| `budget-cache.json` vs `quota.json` | F457 UI merges visually; write paths diverge |
| Restart polls despite disk cache | Unnecessary CLI churn |

### Target architecture

```
dashboard-server start
  └─ agentQuotaPoller.start({ repoPath, onRefresh })
        tick() every pollIntervalSeconds
          if cache fresh && !force → return
          phaseBudget()   // tmux/app-server scrapes; skip ag without token
          phaseProbe()    // probe-agent async; default model unless force
          phaseProvider() // F615 HTTP; no-op when no providers configured
          atomicWrite(agent-quota.json)
```

**Read path:** `lib/agent-quota-read.js` exports `readAgentQuotaState(repoPath)`, `getAgentBudgetSlice(agentId)`, `getAgentProbeSlice(agentId)`, `getProviderSlice(providerId)`, `isPairStartable(agentId, modelValue)` — all dashboard/CLI consumers use this.

**Write path:** only `agent-quota-poller.js` (+ `quota-mid-run-detector` merge helper for pane-derived depletion) writes the file.

**Schema sketch** (illustrative — implementer finalises):

```json
{
  "schemaVersion": 1,
  "lastPollAt": "2026-07-07T00:45:00.000Z",
  "agents": {
    "cc": {
      "budget": { "polled_at": "...", "session": { "pct_used": 32 }, "week_all": {} },
      "models": {
        "__default__": { "verdict": "available", "lastProbedAt": "...", "resetAt": null }
      },
      "agentEnabled": true
    }
  },
  "providers": {
    "openrouter": { "verdict": "available", "balanceUsd": 12.5, "lastPolledAt": "..." }
  }
}
```

### Cutover strategy

1. Implement unified read/write alongside legacy (dual-write one commit — **avoid**; prefer read-fallback then single write).
2. Migration in `doctor --fix` copies merged view to `agent-quota.json`.
3. Switch poller + API + dashboard to unified file.
4. Delete legacy pollers; keep API shims one release.
5. Remove shims + legacy file readers in follow-up housekeeping (can be same PR if test coverage is strong).

### Non-functional

- Background tick must not block the dashboard event loop (keep async probe path from F454).
- Total automated CLI invocations per agent per tick ≤ 2 (budget + one probe), never interactive `agy` without token.
- Preserve F444 adaptive backoff, F446 mid-run pane merge, F593 availability filtering.

## Dependencies

- **F615 `provider-quota-openrouter`** (done) — provider HTTP phase and `providers` subtree; unified schema must embed or reference it. `depends_on` ensures ordering if still in flight on other branches.
- **F444, F322, F457, F446, F593** (all done) — behaviour to preserve, not blockers.

## Out of Scope

- Changing probe regex packs or adding new agents/providers (data-only template edits stay as today).
- Replacing tmux budget scrape with pure HTTP where vendors don't expose APIs (cc/km still need tmux for subscription bars).
- Pro/OpenRouter billing dashboards beyond what F615 already ships.
- Removing `scripts/probe-agent.js` — it remains the probe primitive inside the unified poller.

## Open Questions

- **Schema version number:** bump quota.json `schemaVersion: 2` in place vs new filename `agent-quota.json`? Recommendation: new file + migration for clear break; avoid overloading v2 quota with unrelated budget keys.
- **Rename dashboard widget file** (`budget-widget.js` → `agent-quota-widget.js`)? Cosmetic; optional if behaviour is unified.
- **How long to keep `/api/budget` shim?** Recommendation: one OSS release, logged deprecation in CHANGELOG.

## Related

- Research: none
- Set: `quota`
- Prior features in set: F444 (agent-quota-awareness), F322 (agent-budget-awareness), F457 (agent-quota-overview-panel), F615 (provider-quota-openrouter)
- Incident context: 2026-07-07 Antigravity Chrome login spam from duplicate budget+quota polls on server restart

## Pre-authorised

- May delete `lib/budget-poller.js` and `lib/quota-poller.js` after unified poller ships with migration + shims.
- May raise `scripts/check-test-budget.sh` CEILING by up to +80 LOC for migration and poller integration tests.
- May skip full `test:browser` mid-iteration; smoke subset sufficient when only `lib/agent-quota*` and route shims change.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 616" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-616" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-616)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#615</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">provider quota openrouter</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#616</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">unified agent quota state</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
