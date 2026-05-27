---
schedule: monthly
name_pattern: model-refresh-{{YYYY-MM}}
recurring_slug: monthly-model-refresh
complexity: medium
---

# model-refresh-{{YYYY-MM}}

## Summary

Run the full agent-driven model registry refresh for {{YYYY-MM}}. This is not a CLI
task — it requires an agent to probe providers, benchmark new models, research any
failures, and update the registry with evidence-backed conclusions.

Follow the `aigon-model-refresh` slash command from start to finish.

## Acceptance Criteria

- [ ] `aigon model-refresh` run interactively — new candidates reviewed and approved/rejected per the inclusion policy
- [ ] Any pending queue entries from prior non-interactive runs drained: `aigon model-refresh --approve-pending`
- [ ] Benchmarks run for any newly added models: `aigon perf-bench brewboard --all --agents op`
- [ ] Every timeout or error researched (web search) — classified as TRANSIENT INFRA, MODEL DEGRADED, DEPRECATED, or ROUTING BROKEN
- [ ] Registry updated: notes, scores, and quarantine entries reflect research findings
- [ ] Report written to `.aigon/reports/model-refresh-{{YYYY-MM}}.md`
- [ ] Server restarted: `aigon server restart`
- [ ] Changes committed

> Inclusion policy: `docs/model-inclusion-policy.md` is the canonical contract for what models qualify. Any deviation from approve/reject defaults needs a one-line justification in the report.

## Technical Approach

Run the slash command:

```
/aigon-model-refresh
```

This drives you through the full workflow: discovery → benchmarking → failure research →
registry update. Do not shortcut the research step — a timeout without web research is
not sufficient evidence to quarantine or un-quarantine a model.

### Report template

Write `.aigon/reports/model-refresh-{{YYYY-MM}}.md`:

```markdown
# Model refresh — {{YYYY-MM}}

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
- Write `.aigon/reports/model-refresh-{{YYYY-MM}}.md`
- Commit with message `chore(model-refresh): {{YYYY-MM}} registry update`
