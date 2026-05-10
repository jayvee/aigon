---
recurring_slug: monthly-model-refresh
complexity: medium
recurring_month: 2026-05
recurring_template: monthly-model-refresh.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T22:07:30.203Z", actor: "recurring/feature-prioritise" }
---

# model-refresh-2026-05

## Summary

Run the full agent-driven model registry refresh for 2026-05. This is not a CLI
task — it requires an agent to probe providers, benchmark new models, research any
failures, and update the registry with evidence-backed conclusions.

Follow the `aigon-model-refresh` slash command from start to finish.

## Acceptance Criteria

- [ ] `aigon model-refresh` run interactively — new candidates reviewed and approved/rejected
- [ ] Benchmarks run for any newly added models: `aigon perf-bench brewboard --all --agents op`
- [ ] Every timeout or error researched (web search) — classified as TRANSIENT INFRA, MODEL DEGRADED, DEPRECATED, or ROUTING BROKEN
- [ ] Registry updated: notes, scores, and quarantine entries reflect research findings
- [ ] Report written to `docs/reports/model-refresh-2026-05.md`
- [ ] Server restarted: `aigon server restart`
- [ ] Changes committed

## Technical Approach

Run the slash command:

```
/aigon-model-refresh
```

This drives you through the full workflow: discovery → benchmarking → failure research →
registry update. Do not shortcut the research step — a timeout without web research is
not sufficient evidence to quarantine or un-quarantine a model.

### Report template

Write `docs/reports/model-refresh-2026-05.md`:

```markdown
# Model refresh — 2026-05

## New models added

| Model | ID | Price (in/out /MTok) | Bench result |
|-------|-----|----------------------|--------------|

## Models researched (timeouts / errors)

| Model | Error seen | Classification | Evidence | Action taken |
|-------|-----------|----------------|----------|--------------|

## Models quarantined this month

| Model | Reason | Source |
|-------|--------|--------|

## Registry state after update

- op (OpenRouter): N active, N quarantined, N archived
- gg (Gemini): N active

---

> Run `aigon model-refresh` interactively to re-review any excluded ⚠️ candidates.
```

## Pre-authorised

- Run `aigon model-refresh` interactively (may modify `templates/agents/op.json`, `templates/agents/gg.json`)
- Run `aigon perf-bench brewboard --all --agents op` (will reset brewboard seed, run benchmarks)
- Run web searches to research model status
- Run `aigon server restart` after JSON edits
- Write `docs/reports/model-refresh-2026-05.md`
- Commit with message `chore(model-refresh): 2026-05 registry update`
