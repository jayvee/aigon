---
complexity: high
set: quota
depends_on: [444]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-06T23:56:02.919Z", actor: "cli/feature-prioritise" }
---

# Feature: provider-quota-openrouter

## Summary

Extend Aigon's quota system with a **provider quota** layer for upstream API wallets that agents route through but do not own. OpenRouter is the first provider: OpenCode (`op`) bills every model call through a shared OpenRouter key, yet today's dashboard only shows F444 per-model probe verdicts ("8 / 12 models available") — not dollar balance, key cap, or spend velocity. Credits can hit zero while probes still read `available` until the next PONG fails, which is how a 2026-04-30 GLM bench session burned the full OpenRouter balance for 10+ hours with no ambient warning (see `feature-bench-monitor`).

This feature polls OpenRouter's read-only HTTP APIs (`GET /api/v1/key` always; `GET /api/v1/credits` when the key has permission), caches provider state beside existing agent quota in `.aigon/state/quota.json` (schema v2), links agents via `quotaProviders` in agent JSON, surfaces balance/spend on the dashboard quota panel under the OpenCode card, and gates `feature-start op` when balance is depleted or below a configurable threshold. v1 is OpenRouter-only; the provider registry shape must generalise so a second router-backed agent (`am`) or future providers can reuse the same poller contract without another architectural pass.

## User Stories

- As an operator running OpenCode via OpenRouter, I want the dashboard quota panel to show my remaining OpenRouter balance and today's spend so I notice credit exhaustion before starting a long autonomous run.
- As an operator with a per-key monthly cap on OpenRouter, I want to see `limit_remaining` and when the cap resets so I understand why `op` suddenly fails mid-run.
- As an operator starting `aigon feature-start <id> op`, I want the command to refuse when OpenRouter balance is $0 (or below threshold) with a clear top-up message — not spawn a session that will error on turn one.
- As a maintainer adding a future router-backed agent, I want a `quotaProviders: ["openrouter"]` link on the agent JSON rather than duplicating HTTP poll logic per agent.
- As an operator refreshing quota from the dashboard, I want provider balance to update on the same refresh path as agent quota (no separate hidden poller).

## Acceptance Criteria

### Provider registry + data model
- [ ] Add `templates/providers/openrouter.json` (installed/maintained like agent templates — user-facing paths only; no `lib/` self-references) declaring: `id`, `displayName`, poll endpoints (`key`, optional `credits`), key resolution order, default `lowThresholdUsd` (default 5), poll interval (default 1800s, same as F444).
- [ ] Extend `.aigon/state/quota.json` to **schemaVersion 2** with a top-level `providers` object alongside existing `agents`. Migration on read: v1 files load as v2 with `providers: {}`; doctor `--fix` may bump schema harmlessly.
- [ ] Provider entry shape (minimum):
  ```json
  "openrouter": {
    "displayName": "OpenRouter",
    "verdict": "available",
    "balanceUsd": 12.34,
    "walletUsd": 12.34,
    "keyLimitUsd": 100,
    "keyLimitRemainingUsd": 74.5,
    "keyLimitReset": "monthly",
    "usageDailyUsd": 1.23,
    "usageWeeklyUsd": 4.56,
    "usageMonthlyUsd": 37.66,
    "remainingUnit": "usd",
    "remaining": 12.34,
    "lastPolledAt": "2026-07-07T00:00:00Z",
    "probeMethod": "openrouter-api",
    "lastError": null
  }
  ```
  `verdict`: `available` | `low` | `depleted` | `unknown` | `error`. `depleted` when `balanceUsd <= 0`; `low` when `0 < balanceUsd < lowThresholdUsd`; `unknown` when no key found or both endpoints unreachable.
- [ ] Add `quotaProviders: ["openrouter"]` to `templates/agents/op.json`. Agents without the field behave as today (agent-only quota).

### Polling + key resolution
- [ ] New module `lib/provider-quota-poller.js` (or `lib/provider-quota/` if split stays minimal): HTTP GET poller, no tmux, no PONG burn.
- [ ] Key resolution order (document in provider JSON + code): `OPENROUTER_API_KEY` → `OPENCODE_API_KEY` → `~/.local/share/opencode/auth.json` field `openrouter.key` (same key OpenCode uses). Never log or persist the key; never commit it.
- [ ] Primary poll: `GET https://openrouter.ai/api/v1/key` with inference key. Parse `limit`, `limit_remaining`, `limit_reset`, `usage_daily|weekly|monthly`.
- [ ] Secondary poll (best-effort): `GET https://openrouter.ai/api/v1/credits`. On 403/401, set `walletUsd: null` and derive balance from key cap only — do not fail the whole poll.
- [ ] Balance precedence: `walletUsd` (account) when present, else `keyLimitRemainingUsd` when `limit` set, else `unknown` verdict with `balanceUsd: null`.
- [ ] Server poller started from `dashboard-server.js` alongside `quota-poller` / `budget-poller` (same process, not a new daemon). Default interval from `~/.aigon/config.json:quota.pollIntervalSeconds` unless provider JSON overrides.
- [ ] `POST /api/quota/refresh` triggers provider poll in addition to agent quota refresh (or shared `quotaPoller.triggerRefresh` path).
- [ ] Emit `quota.refreshed` server event with `{ scope: 'provider', providerId: 'openrouter', verdict, balanceUsd, polledAt }` on change (extend existing event shape; dashboard already ignores unknown fields).

### Dashboard
- [ ] OpenCode card in `templates/dashboard/js/budget-widget.js` shows a **provider sub-row** when linked provider data exists:
  - `OpenRouter · $12.34 remaining` (or `limit $74.50 / $100 monthly` when no wallet, key cap present)
  - Spend sub-line: `$1.23 today · $4.56 this week` when available
  - Dot colour follows provider `verdict` (`low` → amber, `depleted` → red)
- [ ] Collapsed quota panel worst-of rollup includes provider verdict for any agent that declares `quotaProviders` (so op-depleted wallet turns the header dot red even when per-model probes are green).
- [ ] Refresh button triggers provider poll; widget re-renders when `/api/quota` returns updated `providers`.

### CLI + gates
- [ ] `aigon feature-start <id> op` checks linked provider verdict before spawn: refuse when `depleted` (same UX pattern as F444 — message cites balance, suggests top-up URL, `--skip-quota-check` escape hatch).
- [ ] `low` verdict does **not** block start (warn only in dashboard tooltip); only `depleted` blocks.
- [ ] `aigon agent-probe --quota` (or new `aigon provider-quota [--refresh]`) prints OpenRouter row in summary table: provider, balance, verdict, last polled. Prefer extending `--quota` output for discoverability.
- [ ] `aigon doctor` reports: missing OpenRouter key when `op` is launchable; stale provider poll (>2× interval); `depleted`/`low` balance as warning (not auto-fix).

### Tests
- [ ] `tests/integration/provider-quota-poller.test.js` — mock `https` responses for `/key` and `/credits`; assert verdict, balance precedence, 403 on credits gracefully ignored. REGRESSION comment per test.
- [ ] Extend `tests/integration/quota-probe.test.js` or add schema test: v1 quota.json loads under v2 reader.
- [ ] Dashboard smoke: quota API response includes `providers` key (fixture or integration assert on route handler).

## Validation

```bash
node --check lib/provider-quota-poller.js
node tests/integration/provider-quota-poller.test.js
npm run test:iterate
```

Manual smoke (requires real key locally — not CI):
```bash
aigon agent-probe --quota op
# expect OpenRouter provider row with balance when key configured
```

## Pre-authorised

- May skip `npm run test:browser` mid-iteration when only `lib/provider-quota*.js` changes without dashboard edits; smoke runs automatically when `templates/dashboard/**` is in the diff.
- May read `~/.local/share/opencode/auth.json` read-only for key resolution during poll and doctor (same trust boundary as OpenCode itself).

## Technical Approach

### Architecture

```
provider-quota-poller.js
  → GET openrouter.ai/api/v1/key   (inference key)
  → GET openrouter.ai/api/v1/credits (optional; management key)
  → write quota.json providers.openrouter

templates/agents/op.json  quotaProviders: ["openrouter"]
  → feature-start gate reads providers via agent link
  → budget-widget.js renders sub-row on op card

/api/quota  →  { schemaVersion: 2, agents: {...}, providers: {...} }
```

### Files (expected touch set)

| Area | Files |
|------|-------|
| Provider template | `templates/providers/openrouter.json` |
| Agent link | `templates/agents/op.json` |
| Poller | `lib/provider-quota-poller.js` |
| State read/write | `lib/quota-probe.js` (schema v2 read, helpers) |
| Server wiring | `lib/dashboard-server.js`, `lib/quota-poller.js` |
| API | `lib/dashboard-routes/analytics.js` |
| Gate | `lib/commands/feature.js` or shared quota gate helper |
| Dashboard | `templates/dashboard/js/budget-widget.js` |
| Doctor | `lib/commands/setup/doctor.js` or setup-legacy doctor section |
| Tests | `tests/integration/provider-quota-poller.test.js` |

### Config

```json
// ~/.aigon/config.json (optional overrides)
{
  "quota": {
    "pollIntervalSeconds": 1800,
    "providers": {
      "openrouter": {
        "lowThresholdUsd": 5
      }
    }
  }
}
```

### Non-goals for implementation ergonomics

- Do not add OpenRouter as a fake agent id in the registry.
- Do not replace F444 per-model probes — provider balance and model reachability are complementary signals.
- Provider poll must not invoke `opencode run` (zero inference cost).

## Dependencies

- **F444 `agent-quota-awareness`** (done) — quota.json, `/api/quota`, dashboard widget, `feature-start` gate pattern, `quota.refreshed` events.
- **F457 `agent-quota-overview-panel`** (done) — op card in quota panel; extend, do not rewrite.
- Soft: **bench-monitor** (inbox) — auto-quarantine/zombie-kill is separate; this feature addresses the *proactive balance* gap that made that incident painful.

## Out of Scope

- Management API key creation/rotation UI.
- Multi-key OpenRouter accounts (poll the key OpenCode uses only).
- Other providers (Together, Fireworks, etc.) — follow-up features add JSON + poller module using the same `providers` block.
- `am` (Amp) provider linkage unless trivial once registry exists (acceptable stretch if `quotaProviders` is already generic).
- Spend forecasting, alerts/email, Pro scheduler integration.
- Mutating OpenRouter limits from Aigon.

## Open Questions

- Should `low` verdict surface in the start-modal as a non-blocking warning banner? (Recommend: yes, tooltip only in v1.)
- Cache provider responses in memory for 60s (OpenRouter docs note credits can be ~60s stale) — match or document?
- Install `templates/providers/openrouter.json` via `aigon install-agent` / `aigon apply`, or ship as repo-only maintainer template? (Recommend: repo template read directly like agent JSON — no install step in v1.)

## Related

- Research: —
- Set: `quota` (with F444, F446, F457)
- Prior features in set: F444 agent-quota-awareness, F457 agent-quota-overview-panel
- External: [OpenRouter limits / key endpoint](https://openrouter.ai/docs/api/reference/limits), [credits endpoint](https://openrouter.ai/docs/api/api-reference/credits/get-credits)
- Incident context: `docs/specs/features/01-inbox/feature-bench-monitor.md` (OpenRouter credit burn, 10h zombie)
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 615" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-615" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-615)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#444</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">agent quota awareness</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#615</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">provider quota openrouter</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
