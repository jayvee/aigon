# Implementation Log: Feature 360 - agent-perf-benchmarks
Agent: cc

Shipped `aigon perf-bench` (lib/perf-bench.js, registered in lib/commands/misc.js): seed-reset → bare `claude -p` baseline → feature-start → poll snapshot → write `.aigon/benchmarks/{seed}-{id}-{ts}.json` with totalMs/baselineMs/overheadMs/phases; `--check` compares to `baseline.json` and exits non-zero on >20% regression. Added `stripLightOptionalBlocks` helper (lib/templates.js) and wired it into install-agent so `docs/agents/{id}.md` and `docs/development_workflow.md` shed Fleet/Arena sections under `rigor: light`. Resolved orphan `{{AGENT_DEV_SERVER_NOTE}}` by anchoring it above the Critical Rules block in `templates/generic/docs/agent.md`.

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
