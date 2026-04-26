---
recurring_slug: weekly-agent-matrix-benchmark
complexity: low
recurring_week: 2026-W17
recurring_template: weekly-agent-matrix-benchmark.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T03:08:03.367Z", actor: "recurring/feature-prioritise" }
---

# agent-matrix-benchmark-2026-W17

## Summary

Run the canonical implement benchmark against a freshly reset Brewboard seed repo
to populate the agent-matrix with real performance data for the current agent and model.
Each weekly run covers one (agent × model) cell. Fleet mode runs multiple cells in parallel.

## Acceptance Criteria

- [ ] Check the matrix via `node -e "const m=require('./lib/agent-matrix'); console.log(JSON.stringify(m.buildMatrix()))" | jq '[.[] | select(.score.implement == null or .lastRefreshAt == null)]'` to confirm this cell is stale
- [ ] Run `aigon seed-reset brewboard --force` to restore Brewboard to canonical state
- [ ] Implement the task defined in `~/src/brewboard/docs/benchmarks/implement.md` in the Brewboard repo (cwd: `~/src/brewboard`); confirm `npx tsc --noEmit` exits 0
- [ ] Write a benchmark report to `docs/reports/agent-matrix-benchmark-2026-W17.md` with sections: Agent/Model, Task, Outcome (pass/fail), TypeScript clean (yes/no), Approach summary (2–3 sentences), Notable issues
- [ ] Commit the report: `git add docs/reports/ && git commit -m "chore: agent-matrix benchmark {{YYYY-WW}}"`
- [ ] Close this feature (no eval step needed)

## Technical Approach

1. The implementing agent works in the Brewboard repo (`~/src/brewboard`) as its own self.
2. Implement the style-filter task from `~/src/brewboard/docs/benchmarks/implement.md` directly — read that file for acceptance criteria.
3. Run `npx tsc --noEmit` in `~/src/brewboard` to validate TypeScript.
4. Write the benchmark report to `docs/reports/agent-matrix-benchmark-{{YYYY-WW}}.md` (in the aigon repo, not brewboard).
5. Commit and close. The `feature-close` path records cost/tokens/model in `stats.json`; `lib/stats-aggregate.js` rolls this into `perTriplet`, and `lib/agent-matrix.js` picks it up automatically on the next dashboard load.

## Pre-authorised

- Skip eval step: this is a benchmark recording task; quality judgement comes from the written report, not a separate eval agent
- May run `aigon seed-reset brewboard --force` without additional confirmation

## Related

- Fixtures: `~/src/brewboard/docs/benchmarks/implement.md` (and spec-review / code-review / draft siblings)
- Matrix collector: `lib/agent-matrix.js`
- Stats pipeline: `lib/stats-aggregate.js` → `lib/agent-matrix.js`
- Set: agent-matrix (features 370–376)
