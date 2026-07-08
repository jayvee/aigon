# Telemetry package (F634)

Per-agent transcript parsers registered by `runtime.telemetryStrategy` in `templates/agents/<id>.json`.

## Layout

- `core.js` — normalized record schema, read/write, aggregation
- `pricing.js` — model pricing from agent registry + legacy fallbacks
- `sqlite.js` — shared sqlite3 CLI query helper (ag + op providers)
- `capture.js` — git + agent capture orchestration (dispatches via registry)
- `providers/{cc,gg,ag,cx,op}.js` — one module per transcript format
- `providers/registry.js` — maps `telemetryStrategy` string → provider module

## Provider contract

Each provider exports:

- `strategyId` — matches `templates/agents/<id>.json` `runtime.telemetryStrategy`
- `parseTranscripts(worktreePath, options)` — legacy fallback parse; returns aggregated frontmatter shape or `null`

The cc provider additionally exports `captureFeatureTelemetry(featureId, featureDesc, options)` for the claude-transcript default path.

`getProviderByStrategy(id)` returns the provider or `null` (unknown → no telemetry, never throws).

Providers import `core` and `pricing` only — never `agent-registry` or sibling providers.
