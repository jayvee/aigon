# Implementation Log: Feature 288 - token-reduction-2-telemetry-and-audits
Agent: cc

## Decisions

- `turns[]` added directly to parse functions (cc/gg/cx); Codex uses cumulative-delta tracking since its JSONL stores running totals, not per-event increments.
- `workflowRunId` carried via `AIGON_WORKFLOW_RUN_ID` env var (already-present env-var pattern in captureSessionTelemetry); fallback derives id from `featureId + startedAt` epoch at close time.
- `costByActivity` built at close time from the `activity` field already present on every normalized telemetry record — no schema change needed to existing records.
- Codex config audit: `~/.codex/config.toml`'s 679 `[project_trust]` entries are local permission data only — confirmed via session JSONL inspection; `base_instructions` field is the actual model-bound content.
- `aigon stats --feature <id>` added to existing stats command rather than a new subcommand; reads stats.json directly to avoid cache staleness.
