---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T10:38:09.307Z", actor: "cli/feature-prioritise" }
---

# Feature: monthly-benchmark-refresh-with-model-discovery

## Summary

Running benchmark sweeps manually is error-prone and easy to neglect — the matrix goes stale as new model releases appear and old results age out. This feature adds an `aigon bench-refresh` command that does two things: (1) **model discovery** — fetches the current model catalogue from OpenRouter, Gemini, and Anthropic APIs, diffs against each agent's `modelOptions` in the template JSONs, and appends genuinely new models (not yet present by `value`); and (2) **smart staleness-based re-run** — instead of always sweeping all 21 pairs, only benchmarks pairs whose last result is older than a per-agent threshold (default 30 days for gg/op; 60 days for cc/cx, since those providers release less frequently). A `--dry-run` flag previews what would be discovered and what would run without changing anything. The command is designed to be called by the Pro recurring-feature scheduler monthly, but works standalone today.

## User Stories

- As John running the monthly benchmark pass, I want to run `aigon bench-refresh` and have it automatically append any new OpenRouter/Gemini models to the agent JSONs, then run only the pairs whose data is stale — so I never need to hand-edit model lists or figure out which runs are missing.
- As John previewing what will happen, I want `aigon bench-refresh --dry-run` to print: new models that would be added per agent, pairs that are already fresh (skipped), and pairs that are stale (would run) — without touching any files or spawning any agents.
- As John with the Pro scheduler enabled, I want a monthly recurring-feature entry that calls `bench-refresh --all-seeds --judge` on the first of each month — so the benchmark matrix is never more than ~35 days stale without any manual action.

## Acceptance Criteria

- [ ] `aigon bench-refresh` discovers new models for `gg` (Gemini API) and `op` (OpenRouter API) and appends any not currently in `modelOptions` (matched by `value`) to the respective agent JSON, printing `+ added: <model-value>` for each addition. Anthropic and Codex model lists are not fetched (no public enumerate endpoint; managed manually via `aigon config models`).
- [ ] `aigon bench-refresh` reads the latest `all-{seed}-*.json` summary files from `.aigon/benchmarks/` (newest file wins per seed) to determine the last-run timestamp for each `{agentId, modelValue}` pair. A pair with no prior result is treated as stale (last run = epoch 0).
- [ ] Staleness thresholds: `gg` and `op` default to 30 days; `cc` and `cx` default to 60 days. Both are overridable via `--gg-days N`, `--op-days N`, `--cc-days N`, `--cx-days N` flags or a `benchRefresh.stalenessThresholdDays` map in `.aigon/config.json`.
- [ ] After discovery, `bench-refresh` calls the existing `runAllBenchmarks` function filtered to only stale pairs (using the `--agents` filter and a new `--models` filter on `modelValue`), with `--judge` on by default and `--skip-baseline` when all stale pairs belong to a single agent.
- [ ] `aigon bench-refresh --dry-run` exits 0 and prints three sections: `NEW MODELS (would add)`, `STALE PAIRS (would run)`, `FRESH PAIRS (skip)` — no files written, no agents spawned.
- [ ] `aigon bench-refresh --force` ignores staleness thresholds and treats all non-quarantined pairs as stale (equivalent to a full sweep, but still skips quarantined models).
- [ ] Newly discovered models that are subsequently quarantined via auto-quarantine (bench-monitor feature) do not get re-added on the next discovery pass (the quarantine block is present in the JSON; discovery skips models where `quarantined` is set).
- [ ] The command is wired in `aigon-cli.js` dispatch and in `lib/commands/misc.js` (or a new `lib/commands/bench.js`) consistent with existing command patterns.
- [ ] A Pro recurring-feature definition `bench-monthly` is added to `templates/workflows/` (or wherever Pro reads recurring-feature templates) that schedules `aigon bench-refresh --judge` on a monthly cadence. This template is a stub if Pro is not installed — the command still works standalone.
- [ ] `npm run test:quick` passes. A unit test verifies the staleness-filtering logic (mock `allResults`, assert which pairs are selected at different thresholds).

## Validation

```bash
node --check lib/commands/bench.js 2>/dev/null || node --check lib/commands/misc.js
aigon bench-refresh --dry-run
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May read `https://openrouter.ai/api/v1/models` (public, no auth) to fetch the OpenRouter model catalogue.
- May read `https://generativelanguage.googleapis.com/v1beta/models` with the user's `GEMINI_API_KEY` env var to fetch the Gemini model catalogue.
- May write new model entries to `templates/agents/op.json` and `templates/agents/gg.json` as part of the model discovery path.

## Technical Approach

### Command entry point

Add `bench-refresh` to dispatch in `aigon-cli.js` (follow the `perf-bench` pattern). Implement in a new `lib/commands/bench.js` (keeps misc.js from growing further) or inline in misc.js if very small.

### Model discovery

**OpenRouter (`op`):**
```js
// GET https://openrouter.ai/api/v1/models — no auth required, returns { data: [{id, name, ...}] }
// Filter: model.id must start with one of the provider prefixes already in op.json
//         (openrouter/deepseek, openrouter/mistralai, openrouter/qwen, etc.)
// Avoid adding every model on OpenRouter — scope to providers already represented.
// Configurable via benchRefresh.opProviderPrefixes in .aigon/config.json.
```

**Gemini (`gg`):**
```js
// GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY
// Filter: model.name must match /^models\/gemini-/ and supportedGenerationMethods includes generateContent
// Convert name `models/gemini-2.5-flash` → value `gemini-2.5-flash`
```

For each agent JSON:
1. Load current `modelOptions`.
2. Build set of existing `value` strings.
3. For each discovered model not in the set (and not quarantined), append a minimal entry: `{ value, label, pricing: null }` — pricing fields left null since we don't have them from the API; notes/score left absent (populated on next `aigon config models` cycle).
4. Write the JSON back with `safeWrite`.

### Staleness filtering

```js
function stalePairs(seed, stalenessMap) {
    // Read all all-{seed}-*.json, find newest timestamp per {agentId, modelValue}
    // Return pairs where (now - lastRunMs) > stalenessMap[agentId] * 86_400_000
}
```

Then pass the stale set to `runAllBenchmarks` via a new `pairFilter` option that filters `collectAllPairs` output to only the specified `(agentId, modelValue)` tuples.

### Pro recurring template stub

Add `templates/recurring/bench-monthly.json`:
```json
{
  "id": "bench-monthly",
  "label": "Monthly benchmark refresh",
  "schedule": "0 8 1 * *",
  "command": ["bench-refresh", "--judge"],
  "description": "Re-runs stale benchmark pairs and discovers new models on the 1st of each month."
}
```

The Pro recurring-feature poller already reads from `templates/recurring/` (or equivalent path — verify before implementing; adjust path if Pro uses a different convention).

### Key files touched

- `lib/commands/bench.js` (new) or `lib/commands/misc.js` — command handler
- `lib/perf-bench.js` — add `pairFilter` option to `collectAllPairs` / `runAllBenchmarks`
- `aigon-cli.js` — dispatch entry
- `templates/agents/op.json`, `templates/agents/gg.json` — written by discovery
- `templates/recurring/bench-monthly.json` (new stub)
- `test/bench-refresh.test.js` (new) — staleness unit test

## Dependencies

- `bench-monitor` feature (inbox) — auto-quarantine and kill-on-timeout are strongly recommended before running unattended monthly sweeps, but not a hard gate. If bench-monitor is not yet shipped, the monthly template should default to `--agents gg,op` only (lower zombie risk than a full sweep).

## Out of Scope

- Dashboard UI panel for benchmark history (separate feature, tracked in bench-monitor set).
- Cost estimation before a run starts.
- Discovering models for `cc` or `cx` (no public enumerate endpoint).
- Automatic quarantine of newly-discovered models that fail immediately (that belongs in bench-monitor).
- Per-message token breakdown or per-model cost breakdown (summary totals are sufficient).

## Open Questions

- Where does the Pro recurring-feature poller look for template stubs — `templates/recurring/`? Verify the Pro integration path before naming the stub file.
- Should newly-discovered models be gated behind a `--add-models` flag (opt-in) rather than always appending? Pro: prevents accidental model sprawl on a cron run. Con: defeats the point of automation. Lean toward: always append but print a clear summary, and respect a `benchRefresh.autoAddModels: false` config escape hatch.

## Related

- Set: agent-benchmarks
