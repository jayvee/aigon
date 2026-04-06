# Implementation Log: Feature 231 - per-agent-cost-breakdown-in-stats
Agent: cc

## Plan
Replace the single aggregated cost block on the Stats tab with a per-agent
breakdown table. Source from `.aigon/telemetry/feature-{id}-{agent}-*.json`
records. Distinguish "no telemetry" (n/a) from real $0 by checking
`source === 'feature-close-fallback'` (and `no-telemetry-*`).

## Progress
1. `lib/feature-status.js` — `collectCost` now builds `costByAgent` keyed by
   pure agent ID (across all activities for that agent). Each row carries
   `hasRealData`, set to true only when at least one record has non-zero
   tokens/cost AND its source is not a fallback. Added a participating-agents
   parameter so agents that started but produced no telemetry still get a
   placeholder row. Transcript-fallback path was rewritten to populate the
   per-agent map (instead of returning early with a flat shape).
2. `lib/feature-close.js` — `snapshotFinalStats` mirrors the new shape so
   `stats.json` written at close time carries `costByAgent` instead of the
   old `byAgent` object. Old features keep working because the cost section
   in the dashboard reads `cost.costByAgent` directly.
3. `templates/dashboard/js/detail-tabs.js` — `renderStats` cost section now
   renders a single per-agent table (Agent / Model / Input Tokens / Output
   Tokens / Estimated Cost). Rows with `hasRealData === false` show "n/a".
   Total row sums only agents with real data. Removed the old aggregate
   stats-grid block and the by-activity sub-table.
4. `templates/dashboard/styles.css` — added `.cost-na` (italic, muted) and
   `.cost-total-row` (top border) styles.

## Decisions
- **Per-agent, not per-agent-per-activity**: spec says "one row per agent",
  so implement+review costs roll up under each agent. Activity breakdown
  was a previous addition that the spec is replacing.
- **`hasRealData` flag**: cleanest way to differentiate fallback rows from
  real $0 records. Fallback records still get a row (so the user sees the
  agent participated) but show n/a for tokens/cost.
- **Backwards compatibility for closed features**: existing `stats.json`
  files written before this feature have `cost.byAgent` (with `agent:activity`
  keys) but no `costByAgent`. The dashboard now reads `cost.costByAgent` only
  — old closed features will fall back to `collectCost` live (since
  `stats.cost.totalTokens` will be present for newer ones). Acceptable per
  the "Out of Scope: historical backfill" line.
- **Testing exception**: per CLAUDE.md Rule T2 exception list, the
  cost-collection code is heavy filesystem-integration code. Test budget
  was at 1990/2000 LOC before this feature so a unit test would have
  required deleting an existing test. Verified the data shape via an
  inline `node -e` script that fed two telemetry fixtures (real CC,
  fallback GG) into `collectFeatureDeepStatus` and confirmed `hasRealData`
  is `true` for CC and `false` for GG.

## Conversation Summary
User invoked `/aigon:feature-do 231` directly with no further messages.
Implementation followed the spec verbatim.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-07

### Findings
- Fallback rows were rendering `n/a` in the Model column even though the spec only requires tokens and cost to be `n/a`.
- The Total summary row only summed estimated cost; it did not total the input and output token columns shown in the table.

### Fixes Applied
- `53e04552` — `fix(review): show fallback models and full cost totals`

### Notes
- Review stayed within the dashboard rendering path. No backend changes were needed.
