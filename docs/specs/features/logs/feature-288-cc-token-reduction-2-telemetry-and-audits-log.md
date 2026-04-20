# Implementation Log: Feature 288 - token-reduction-2-telemetry-and-audits
Agent: cc

## Decisions

- `turns[]` added directly to parse functions (cc/gg/cx); Codex uses cumulative-delta tracking since its JSONL stores running totals, not per-event increments.
- `workflowRunId` carried via `AIGON_WORKFLOW_RUN_ID` env var (already-present env-var pattern in captureSessionTelemetry); fallback derives id from `featureId + startedAt` epoch at close time.
- `costByActivity` built at close time from the `activity` field already present on every normalized telemetry record — no schema change needed to existing records.
- Codex config audit: `~/.codex/config.toml`'s 679 `[project_trust]` entries are local permission data only — confirmed via session JSONL inspection; `base_instructions` field is the actual model-bound content.
- `aigon stats --feature <id>` added to existing stats command rather than a new subcommand; reads stats.json directly to avoid cache staleness.

## Code Review

**Reviewed by**: cu (Cursor agent)
**Date**: 2026-04-21

### Findings
- **workflowRunId wiring was incomplete**: `captureSessionTelemetry` read `process.env.AIGON_WORKFLOW_RUN_ID`, but nothing exported it before agent sessions; only the feature-close fallback populated `stats.json`. Per-turn files would stay unlinked until close.
- **Acceptance vs branch scope**: The diff includes substantial unrelated work (implementation-log policy rollback in `feature.js` / `profile-placeholders.js` / agent docs, deleted or moved other feature specs, `static-guards` test lines removed). That should not ship in the same PR as telemetry unless explicitly intended.
- **Codex parser fixture**: Integration test covers cc + gg `turns[]` / `contextLoadTokens`; cx delta parsing is implemented but not fixture-tested (spec asked for at least one agent — satisfied, but cx remains the riskiest path).
- **Test budget**: `bash scripts/check-test-budget.sh` fails on this branch (suite over ceiling); merge to `main` would need trims or an approved bump before push.

### Fixes Applied
- `fix(review): stamp telemetry env from Fleet agent launcher` — `buildAgentCommand` now exports `AIGON_ACTIVITY` (implement / review / evaluate) and `AIGON_WORKFLOW_RUN_ID` derived from `readStats(mainRepo).startedAt`, matching the `feature-close` `${featureId}-${epoch}` shape when stats exist.

### Notes
- Solo Drive sessions without Fleet `worktree.json` still depend on branch-name activity inference; `workflowRunId` appears once `stats.json` has `startedAt` (after engine start).
- Recommend splitting unrelated spec/doc churn into a separate change-set before `feature-close`.
