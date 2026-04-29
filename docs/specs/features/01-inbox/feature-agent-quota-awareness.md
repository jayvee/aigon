---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: agent-quota-awareness

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Continuously sense each agent's API quota state so the dashboard, CLI, and scheduler can refuse to start work that has no chance of running, and proactively suggest a scheduled run for after the next quota reset. Server-side cron probes each (agent, model) pair via a tiny hello command at a tunable interval (default 5 minutes; longer when a known reset time is in the future), classifies stdout/stderr against per-agent regex packs in templates/agents/<id>.json:quota.errorPatterns[], extracts a reset timestamp where the provider exposes one, caches the verdict at (agent, model) granularity, and rolls the per-model verdicts up to an agent-level enabled flag (agent disabled iff every model is depleted). The dashboard greys the agent picker, shows a 'next reset at HH:MM' tooltip, and offers a 'schedule for after reset' action; feature-start refuses to launch an out-of-quota pair with a clear error and a one-line 'aigon schedule …' suggestion. Pattern packs are JSON-data, not code, so adding a new error-message variant when a vendor changes copy is a one-line edit followed by aigon update. English-only at first; multi-language deferred. Out-of-band probe results emit quota.refreshed events so the dashboard can re-render without polling. Triggered by 2026-04-29 release-prep where 13 of 24 benchmark runs predate F438, op runs are clearly broken, and we need to re-run safely without burning quota on agents that can't run.

## User Stories

- As a user picking an agent in the dashboard, I want depleted (agent, model) combinations greyed out with a tooltip explaining when they reset, so I never start work that will fail in the first 5 seconds.
- As a user whose preferred model is depleted, I want a one-click "schedule for after reset" action that creates a cron entry firing 1 minute past the known reset time.
- As a user running `aigon feature-start <id> <agent>` from the CLI, I want the command to refuse with a clear "out of quota until HH:MM, run `aigon schedule …` to retry" message — not start an agent that immediately errors.
- As a maintainer who notices a vendor changed the wording of "rate-limit exceeded", I want to add a new regex line to `templates/agents/<id>.json:quota.errorPatterns[]` and have it pick up after `aigon update` — no engine code change.
- As a Pro user benchmarking the matrix, I want `aigon perf-bench --all` to skip depleted pairs by default (with `--skip-quota-check` to override) so a 3-hour sweep doesn't waste 40 minutes failing on a single depleted agent.

## Acceptance Criteria

### Probe + classifier
- [ ] **Reuse `scripts/probe-agent.js`** as the probe primitive — it already sends a "PONG" prompt via the right CLI invocation per agent and captures stdout/stderr/exit code/elapsed time. New module `lib/quota-probe.js` wraps it and adds classification.
- [ ] **Per-agent regex packs** in `templates/agents/<id>.json` under a new top-level `quota` key:
      ```json
      "quota": {
        "errorPatterns": [
          { "id": "rate-limit-exceeded",
            "match": "rate.{0,3}limit.*exceeded|429|too many requests",
            "verdict": "depleted",
            "confidence": "high",
            "resetExtractor": "(reset|retry).{0,20}(\\d{1,2}:\\d{2}|in (\\d+) (hour|min|second)s?)" },
          ...
        ],
        "successPatterns": [ "PONG", "pong" ],
        "unknownPolicy": "permit"
      }
      ```
      `unknownPolicy: 'permit'` means an unclassified output does NOT block feature-start (better to let the user try than block falsely).
- [ ] **Verdict per (agent, model) pair**: one of `available` / `depleted` / `unknown` / `error`. Stored under `.aigon/state/quota.json` with `lastProbedAt`, `resetAt`, `probeMethod`, `lastProbeOutput` (truncated to 500 chars for debug), `unit` (`requests` | `tokens` | `usd` | null), `remaining` (number | null).
- [ ] **Agent-level rollup**: `agentEnabled = models.some(m => m.verdict === 'available' || m.verdict === 'unknown')`. Agent disabled iff every model is depleted.

### Caching + scheduler
- [ ] **Default poll interval: 5 minutes**, configurable via `~/.aigon/config.json:quota.pollIntervalSeconds`.
- [ ] **Adaptive backoff**: when `resetAt` is known and in the future, skip probes until `resetAt - 30s`. When `resetAt` is unknown but verdict was `depleted` on last probe, double the next interval up to a `maxBackoffSeconds` (default 1 hour).
- [ ] **On-demand refresh** via `aigon agent-probe --quota [agent[/model]]` — extends the existing `aigon agent-probe` command rather than introducing a new top-level `quota` command. The dashboard's "Refresh quota" button calls the same path. Probe is the right framing — we are sensing the agent's health, of which quota availability is one dimension.
- [ ] **Server runs the cron** (existing scheduler — see `aigon schedule list`) — not a separate daemon. One job per agent; the job itself iterates that agent's models in sequence with a 1-second sleep so we never burst-probe a provider.

### Dashboard + CLI integration
- [ ] **Dashboard agent picker**: depleted models render greyed with a `🔒` icon and a tooltip showing `Out of quota — resets at HH:MM (in 23m)`. Hover reveals `Last probed 2 min ago`.
- [ ] **"Schedule for after reset" action** in the picker dropdown for any depleted entry. Clicking it pre-fills the schedule modal with `runAt = resetAt + 60s`.
- [ ] **`aigon feature-start <id> <agent>` gate**: if the chosen (agent, model) pair is depleted, refuse with a non-zero exit and print:
      ```
      ❌ <agent>/<model> is out of quota.
         Resets at 2026-04-29 15:00 UTC (in 23 minutes).
         Schedule for after reset: aigon schedule "feature-start <id> <agent>" --at "2026-04-29T15:01:00Z"
         Force start anyway: aigon feature-start <id> <agent> --skip-quota-check
      ```
- [ ] **`aigon perf-bench`** filters out depleted pairs in `--all` sweeps by default; `--skip-quota-check` opts back in.
- [ ] **New event type**: `quota.refreshed { agentId, modelValue, verdict, resetAt, probedAt }` emitted on every state change. Dashboard subscribes via existing SSE (no polling).
- [ ] **`aigon agent-probe --quota`** prints a summary table extending the existing PASS/FAIL probe output: agent, model, verdict (`available` / `depleted` / `unknown` / `error`), resets-at, last-probed-at. Exits non-zero if any agent is fully depleted. Existing `aigon agent-probe` output stays compatible — `--quota` adds the verdict + reset columns; without the flag, the legacy PASS/FAIL framing is preserved.

### Pattern maintenance
- [ ] **Patterns are JSON-data, not code** — adding a new variant for a vendor's changed copy is a single-line PR to `templates/agents/<id>.json`. No JS edits, no build step.
- [ ] **`aigon agent-probe --quota --debug <agent> --model <id>`** prints the raw probe output alongside the matched pattern (or "no match — please file a quota-pattern PR") so a maintainer hitting an unrecognised error can copy the actual output into a new pattern within minutes.
- [ ] **`tests/integration/quota-probe.test.js`** has one fixture per (agent, error-shape) tuple — recorded raw stdout/stderr from real depleted runs, one fixture per pattern. Tests load the fixture, run the classifier, assert verdict + resetAt extraction. Vendor-copy regressions get caught in CI.

## Validation
```bash
node --check aigon-cli.js
node --check lib/quota-probe.js
node tests/integration/quota-probe.test.js
node aigon-cli.js agent-probe --quota   # smoke test the full path against real CLIs
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add new error-pattern entries to `templates/agents/<id>.json:quota.errorPatterns[]` without separate sign-off when the addition is a copy-paste from a real probe transcript captured in a fixture under `tests/fixtures/quota/<agent>-<error-shape>.txt`.

## Technical Approach

### Probe pattern (per provider, what we know going in)

Provider behaviour is wildly inconsistent. Anyone implementing this should treat the table below as a research starting point, not gospel — empirical validation lives in the prototype findings appended to this spec.

| Agent | Quota signal | Reset signal | Confidence |
|---|---|---|---|
| `cc` (Claude Code) | Anthropic API returns 429 with `error.type: "rate_limit_error"`; the CLI surfaces something like *"You've hit your rate limit"* / *"Try again at HH:MM"*. Pro/Max plan windows reset hourly + 5-hourly. | Anthropic API exposes `anthropic-ratelimit-tokens-reset` HTTP header on 429s; the CLI may print a wall-clock time. | High — well-documented, headers reliable. |
| `cx` (Codex) | OpenAI 429 → *"You exceeded your current quota"* or for ChatGPT-plan-backed Codex *"You've used X of your Y messages"*. | OpenAI exposes `x-ratelimit-reset-*` headers; ChatGPT plan reset is rolling 5-hour. Codex CLI may surface either. | Medium — split between API and ChatGPT-plan paths. |
| `gg` (Gemini) | `RESOURCE_EXHAUSTED` / *"Quota exceeded for…"* with daily and per-minute buckets. Free tier vs paid tier behave differently. | Sometimes shows a Unix timestamp in the error; otherwise inferred (daily reset at midnight Pacific). | Medium — multiple quota tiers, dailies are guessable. |
| `op` (OpenCode → OpenRouter) | OpenRouter free models: *"rate limit exceeded for free model"*. Paid models: pay-per-token, no quota wall — but per-model failure modes (auth, model-not-found, provider down) need separate classification. | OpenRouter exposes `X-Free-Models-Per-Day` and similar headers on 429s. | Medium — only meaningful for free models; paid models always "available". |
| `cu` (Cursor) | Cursor Premium quota is in-app, no headless CLI. **Out of scope** for v1 — `quota.errorPatterns` simply omitted; verdict is permanently `unknown` and `unknownPolicy: permit`. | N/A | N/A — flagged as not-probeable. |
| `km` (Kimi) | Moonshot API has rate limits; standard 429 shape. | Standard `x-ratelimit-reset` style headers. | Low — fewer real-world transcripts to draw from initially. |

### Data model

Single source of truth: `.aigon/state/quota.json` (gitignored — per-machine state).

```json
{
  "schemaVersion": 1,
  "agents": {
    "cc": {
      "agentEnabled": true,
      "lastRefreshedAt": "2026-04-29T14:53:00Z",
      "models": {
        "claude-opus-4-7": {
          "verdict": "available",
          "remaining": null,
          "remainingUnit": null,
          "resetAt": null,
          "lastProbedAt": "2026-04-29T14:53:00Z",
          "probeMethod": "cli-stdout-pattern",
          "probeOk": true,
          "lastProbeOutput": "PONG"
        },
        "claude-sonnet-4-6": {
          "verdict": "depleted",
          "remaining": 0,
          "remainingUnit": "requests",
          "resetAt": "2026-04-29T15:00:00Z",
          "lastProbedAt": "2026-04-29T14:53:00Z",
          "probeMethod": "cli-stdout-pattern",
          "probeOk": false,
          "lastProbeOutput": "Rate limit exceeded. Resets at 15:00 UTC."
        }
      }
    }
  }
}
```

Rollup rule (server-side derivation, not stored): `agentEnabled = Object.values(agents[id].models).some(m => m.verdict === 'available' || m.verdict === 'unknown')`.

### Caching strategy (the load-bearing call)

The user's core constraint: not every minute (too expensive), not every hour (too stale).

**Tiered policy:**
- **Healthy (verdict=available)**: re-probe every **5 minutes**. Cheap, keeps recent.
- **Depleted with known resetAt**: don't re-probe until `resetAt - 30s`. Then probe to confirm the lift.
- **Depleted with unknown resetAt**: exponential backoff starting at 5 min, doubling up to 1 hour, capped.
- **Error (probe itself crashed/timed-out)**: 30 second retry up to 3 times, then mark `unknown` and back off as above.
- **First-launch / never-probed**: probe immediately on dashboard load and on first `feature-start`.

This means a healthy account costs ~5 probes/agent/hour ≈ 30 trivial requests/hour across all agents — well below any rate ceiling.

**Probe cost note:** every probe burns a tiny amount of quota. We're sensing the quota by spending it, which is fine because the prompt is 1 token in / 4 tokens out. Over a day that's ~100 trivial requests per agent. Cheap relative to a single feature run.

### Pattern matching maintainability

Why JSON-data not code:
1. **Vendor copy churns** — Anthropic, OpenAI, Google all rephrase error messages periodically, often without notice.
2. **Per-locale variants** exist even within English (US "you've used" vs UK "you have used").
3. **Plan tier variants** — Free / Pro / Team / Enterprise often have different message strings.

Each pattern entry has:
- `id` — stable identifier for the pattern (used in events + debug)
- `match` — JS regex string (case-insensitive, multiline)
- `verdict` — what to conclude (`depleted`, `error`, ignore)
- `confidence` — `high` | `medium` | `low` (low patterns log a warning, don't gate)
- `resetExtractor` — optional regex with capture groups to pull a wall-clock or duration
- `resetUnit` — optional `iso8601` | `wallclock-utc` | `relative-seconds` to interpret the extracted value

Adding a new vendor message is a one-line append. The `aigon quota --debug` flag prints the raw output and the missing match, so a maintainer can craft the regex against actual evidence.

### Server-side hosting

Reuse the existing scheduler infra. One scheduled job per agent, fires at the agent's current backoff interval, iterates models with 1-second sleep, writes results to `quota.json`, emits `quota.refreshed` events. Dashboard subscribes via the existing SSE channel (no new transport).

### Why agent-level rollup is computed, not stored

Race condition: if we cached the rollup, a model becoming available wouldn't lift the agent flag until next probe. Computing on read is O(models) — trivial — and always reflects the current per-model verdicts.

## Dependencies
- F438 — token + judge axes — establishes the precedent for "the server runs probes against real provider CLIs". Same pattern, different goal.
- The existing `aigon agent-probe` / `scripts/probe-agent.js` — quota probe wraps it.
- The existing scheduler (`aigon schedule`) — quota cron is a job in this scheduler, not a new daemon.

## Out of Scope
- **Pricing / cost tracking.** Tokens consumed and dollars spent are observable via existing `lib/telemetry.js`, not via this probe path. This feature only gates on quota availability.
- **Local-model providers (Ollama, LM Studio, vLLM)** — when added, they have no quota concept and are always `verdict: available`. No work here yet.
- **Cursor (`cu`)** — no headless probe path. `quota` simply omitted from its agent JSON; verdict permanently `unknown`; never blocks feature-start.
- **Multi-language pattern matching.** English-only at v1. Multi-locale is a JSON-pack expansion later, not engine work.
- **Predicting provider outages** versus quota-depletion. If an agent CLI errors with a non-quota error (e.g., 503 Service Unavailable), classify as `error` (not `depleted`), log, and let the `unknownPolicy: permit` rule pass through.
- **Per-organisation / multi-account quota.** This feature reads the user's currently-configured CLI auth; if a user has multiple accounts they switch between, the quota state is whichever account is currently authenticated.

## Open Questions
- _(filled in after the prototype run; see "Prototype findings" appended at the bottom of this spec)_

## Prototype findings — live probe 2026-04-29

Ran `aigon agent-probe --all-agents --all` against the user's actual environment. Every agent received the existing PONG prompt; raw stdout/stderr/exit-code/elapsed time captured per pair.

### Result

```
23 passed  0 failed  2 skipped
```

| Agent | Models probed | Verdict | Notes |
|---|---|---|---|
| `cc` (Claude Code) | 5 (haiku-4-5, sonnet-4-6, sonnet-4-6[1m], opus-4-7, opus-4-7[1m]) | All `available` | 5.4–6.8 s; PONG. Anthropic quota healthy. |
| `cx` (Codex) | 5 (gpt-5.2 → gpt-5.5, plus 5.3-codex, 5.4-mini) | All `available` | 5.3–14.8 s; PONG. OpenAI / ChatGPT quota healthy. |
| `gg` (Gemini) | 3 (2.5-flash, 2.5-pro, 3-flash-preview) | All `available` | 5.9–11.6 s; PONG. Google quota healthy. |
| `op` (OpenCode → OpenRouter) | 7 (deepseek-v3.1, grok-code-fast-1, qwen3-235b, qwen3-next-80b-thinking, devstral-small-2507, nemotron-3-super-120b, glm-5.1) | All `available` | 2.7–6.8 s; PONG. All 7 models reachable. |
| `cu` (Cursor) | — | Skipped | No headless CLI — `buildCmd` returns null. Permanent `unknown` per spec design. |
| `km` (Kimi) | — | Skipped | **No headless CLI either.** `scripts/probe-agent.js` falls through to default for `km`, returns null. Same `unknownPolicy: permit` treatment as `cu`. Worth a follow-up to add Kimi's `kimi exec` (or whatever) invocation if the CLI supports headless. |

### What this tells us about the design

**(1) Binary "has quota" detection works cleanly.** A successful probe (PONG returned, exit 0) is unambiguous evidence of quota. No vendor weirdness — every agent returned PONG when probed.

**(2) Reset-time discovery is harder than the spec assumed.** None of these CLIs surface `x-ratelimit-reset` headers to stdout in the success case. We can only learn `resetAt` from error messages — i.e., only when an agent is actually depleted. Implications:
   - For a `verdict: depleted` pair, parse the error message (or `x-ratelimit-reset` if the CLI exposes it) for the reset time.
   - For a `verdict: available` pair, **we don't know the reset time** — and we don't need to. The dashboard only shows reset hints on greyed-out depleted entries.
   - Documented provider reset windows (Anthropic 5-hour rolling, Gemini daily-at-Pacific-midnight, etc.) can be hard-coded as **fallback estimates** in `quota.estimatedResetWindow` per agent JSON, used only when the error message provides no specific reset time.

**(3) No empirical error-pattern fixtures from this run** because nothing was depleted. Seed corpus must be drawn from:
   - Vendor documentation (well-known shapes).
   - Past incidents — recall: user has hit Gemini Pro quota before; that error string would be a useful first fixture.
   - The first time a real depletion occurs in the wild, the `--debug` mode of `aigon agent-probe --quota` captures the raw output for a maintainer to commit as a fixture in the same minute they hit it.

**(4) Probe overhead is small but not free.** Across 23 probes, total wall time was ~150 seconds (longest 14.8 s, mean ~6.8 s). At a 5-minute poll interval per agent, the server runs ~6 probes/agent/hour ≈ 30 trivial requests/hour for the user's full matrix. Cheap.

**(5) Two unprobeable agents, not one.** Spec was written assuming `cu` was the lone outlier. Add `km` to the same bucket: `quota.errorPatterns: []`, verdict permanently `unknown`, never gates feature-start.

### Concrete next steps inherited from this prototype

- The full `--all-agents --all` probe on this user's environment passed → **the upcoming benchmark re-run is fully unblocked from a quota perspective**. No agent needs to be skipped today.
- Fixture corpus is empty post-probe → the implementer of this feature should plant 5–10 fixtures from vendor docs as the v1 regex pack, and rely on the `--debug` capture path to grow the corpus organically.
- The "schedule for after reset" UX needs a graceful-degradation path for `resetAt: null` — fall back to a documented per-provider estimate and label it as such ("reset estimate, not measured") in the tooltip.

## Open Questions

- Should `km` (Kimi) get a quota-probe path? `kimi-cli` is installed via `uv tool install`; need to check whether it has a headless `exec` mode. Out-of-scope for v1 if not, but worth verifying.
- For agents where the CLI does not expose API headers to stdout, should we also experiment with a **direct API call** (bypass the CLI) for richer signal? E.g., a curl to Anthropic with `Authorization: Bearer $ANTHROPIC_API_KEY` would expose `anthropic-ratelimit-tokens-reset` even on a successful response. This would give us "remaining tokens" visibility today, not just binary state. Cost: each agent grows a second auth path to maintain. Probably v2.

## Related
- Research: F360 perf-bench harness — same probe primitive.
- F438 — token/judge axes — same "server runs trivial CLI calls" pattern.
- F441 — benchmark JSON artifact policy — surfaced the "we burned quota benchmarking depleted agents" pain that triggered this.
