---
complexity: medium
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
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T13:08:43.443Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-bench-health-signal

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Extend F444's quota state model with a benchVerdict dimension so the dashboard agent picker can distinguish 'API responds' from 'model can drive a multi-turn agent loop'. Triggered by 2026-04-29 op sweep where 5 of 11 models passed agent-probe (single-turn PONG) but failed the brewboard bench (10-min timeout): deepseek-chat-v3.1, deepseek-v4-flash, qwen3-next-80b-thinking, nemotron-3-super-120b, glm-5.1. Single-turn health is necessary but not sufficient. Concrete additions: (a) extend F444's per-(agent, model) state with benchVerdict (passed | failed | unknown), lastBenchAt (ISO timestamp), lastBenchSource (path to .aigon/benchmarks/<file>.json), benchTotalMs (number, optional). (b) hydrate from the most recent .aigon/benchmarks/brewboard-* per-pair JSON whose .agent and .model match — pick by timestamp desc, take .ok and .totalMs. (c) dashboard picker renders a third state alongside the existing probe states: green (probe ok + bench passed) → recommend; yellow (probe ok + bench failed OR no bench yet) → show 'never bench-tested' or 'last bench failed at <date>' tooltip; red (probe depleted/error) — unchanged from F444. (d) optional CLI flag aigon agent-probe --include-bench prints the bench column alongside the existing probe verdict. Out of scope: re-running bench from the dashboard (that's perf-bench's job); deciding when bench data is 'too old' to trust (heuristic, defer until needed); coupling bench to feature-start gate (probe gate already exists in F444; bench gate adds friction without obvious wins). Depends on F444 (shipped) and F441 (artifact policy). Pure data-model + read-path extension, no new event types.

## User Stories

- [ ] As an operator picking a model in the dashboard start modal, I want to see at a glance whether a model is fully validated (probe + bench) vs only probe-tested, so I don't accidentally assign one that will silently time out on real agentic work.
- [ ] As an operator reviewing health after a bench sweep, I want models that failed the brewboard bench to show a warning rather than green — the visual contract "green = safe to use" should hold end-to-end, not just for single-turn API reachability.
- [ ] As an operator running `aigon agent-probe`, I want an `--include-bench` flag that prints the bench verdict column alongside probe results, so I can confirm health from the terminal without opening the dashboard.

## Acceptance Criteria

**State shape**
- [ ] Each per-(agent, model) entry returned by the quota API gains three new optional fields: `benchVerdict: 'passed' | 'failed' | 'unknown'`, `lastBenchAt: <ISO string> | null`, `benchTotalMs: <number> | null`.
- [ ] Bench state is never written to `quota.json` — it is computed on read from `.aigon/benchmarks/` files and merged into the API response (pure read-path extension).

**Bench hydration**
- [ ] A `hydrateBenchVerdicts(repoPath)` helper builds an `(agentId, modelValue) → benchEntry` index from `.aigon/benchmarks/` on each call.
- [ ] All-pairs files (`all-brewboard-<timestamp>.json`) are read first; match on `pairs[].agentId` / `pairs[].modelValue`; the most-recent file by top-level `timestamp` wins.
- [ ] Per-run files (`brewboard-<featureId>-<timestamp>.json`) fill in any pair not covered by an all-pairs file; match on `.agent` / `.model`; most recent by `.timestamp` wins.
- [ ] All-pairs results take precedence over per-run for the same pair (sweep is more authoritative than a one-off run).
- [ ] Pairs with no matching bench file get `benchVerdict: 'unknown'`, `lastBenchAt: null`, `benchTotalMs: null`.

**Dashboard picker**
- [ ] The three visual states are:
  - **Green** — `probeOk: true` AND `benchVerdict: 'passed'`
  - **Yellow** — `probeOk: true` AND (`benchVerdict: 'failed'` OR `benchVerdict: 'unknown'`); tooltip reads "never bench-tested" or "bench failed <relative date>"
  - **Red** — `verdict: 'depleted'` or `probeOk: false` (unchanged from F444)
- [ ] The five models from the 2026-04-29 sweep that passed probe but failed bench — `openrouter/deepseek/deepseek-chat-v3.1`, `openrouter/deepseek/deepseek-v4-flash`, `openrouter/qwen/qwen3-next-80b-a3b-thinking`, `openrouter/nvidia/nemotron-3-super-120b-a12b`, `openrouter/z-ai/glm-5.1` — render yellow (not green) after this change.

**CLI**
- [ ] `aigon agent-probe --include-bench` prints a bench column alongside the existing probe verdict: `passed`, `failed <date>`, or `not tested`.

**Non-regression**
- [ ] Models with no bench files at all continue to pass feature-start; bench verdict does not gate launch.
- [ ] Existing probe-only behavior is unchanged: running a probe does not write or clear bench data.

## Validation

```bash
node --check lib/quota-probe.js
node --check lib/perf-bench.js
npm test -- --grep "bench"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC for bench hydration unit tests.

## Technical Approach

**Bench hydration (`lib/quota-probe.js` or new `lib/bench-hydrate.js`)**

The hydration function is a one-pass scan:
1. Read all files in `.aigon/benchmarks/` that match `*.json`.
2. Classify each file: if it has a top-level `pairs` array → all-pairs format; otherwise per-run format.
3. For all-pairs files, extract `(agentId, modelValue, ok, totalMs, timestamp)` from each pair entry using the file's top-level `timestamp` as the run timestamp.
4. For per-run files, extract `(agent, model, ok, totalMs, timestamp)` directly.
5. Group by `(agentId, modelValue)`. For each group, pick the most recent entry (sort by `timestamp` desc, take first). All-pairs entries sort before per-run for the same timestamp (tiebreak).
6. Return an object keyed `"${agentId}::${modelValue}"` → `{ benchVerdict, lastBenchAt, benchTotalMs }`.

Hydration is called in the existing `/api/quota` (or equivalent) route handler, merged into each model entry before the response is sent. No disk writes.

**Dashboard picker (`templates/dashboard/js/pipeline.js`)**

The existing color classifier checks `entry.verdict` and `entry.probeOk`. Extend it with a `getBenchState(entry)` helper that returns `'passed' | 'failed' | 'unknown'` from `entry.benchVerdict`. Update the green condition to require both `probeOk` and `benchVerdict === 'passed'`; anything probe-ok but not bench-passed falls into yellow with a tooltip constructed from `lastBenchAt`.

**CLI (`lib/commands/misc.js` or wherever `agent-probe` output is formatted)**

Add `--include-bench` flag to `agent-probe`. When set, call `hydrateBenchVerdicts` after probing and append a `BENCH` column to the tabular output: `passed`, `failed <date>`, or `not tested`.

**Key constraint:** This is a pure read-path extension. No new XState transitions, no new event types, no writes to quota.json or bench files. The feature-start quota gate (F444) is untouched.

## Dependencies

- F444 (shipped) — provides the quota state model and `quota.json` schema this feature extends
- F441 (bench artifact policy) — bench files already exist in `.aigon/benchmarks/`; hydration reads them as-is

## Out of Scope

- Triggering new bench runs from the dashboard (that is `perf-bench`'s job)
- Deciding when bench data is "too old" to trust — no TTL or staleness heuristic in this feature
- Coupling bench verdict to the feature-start gate (probe gate already exists; bench gate adds friction without obvious wins)
- Migrating or reformatting existing bench files

## Open Questions

- Should `hydrateBenchVerdicts` be called on every `/api/quota` request (cheap I/O scan of ~37 files) or cached with a short TTL (e.g., 30s)? Start uncached; add TTL if profiling shows it matters.
- For the CLI `--include-bench` column: print bench data from the most recent *existing* files (no re-run), or run a fresh probe first then show bench? Start with existing files only; fresh probe is the default without the flag.

## Related

- Triggered by: 2026-04-29 op sweep — 5 of 11 models passed probe, failed brewboard bench (10-min timeout)
- F444 — quota probe state model this extends
- F441 — bench artifact policy
