---
complexity: high
set: detail-fidelity
set_lead: true
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-12T04:40:57.462Z", actor: "cli/feature-prioritise" }
---

# Feature: close-cost-telemetry-race

## Summary

When a feature closes, `stats.json` is frozen by `snapshotFinalStats()` **before** the
real per-agent telemetry has finished being written to `.aigon/telemetry/`. The result is
that a feature with real, billable cost shows **$0** and model `cc-cli` in the dashboard
Stats tab, because the only telemetry record present at snapshot time is the zero
`feature-close-fallback` placeholder.

Observed on brewboard feature 09 (cc implement, cx review):
- Real telemetry `feature-09-cc-<uuid>.json` — `source: claude-transcript`,
  `costUsd: 0.5852`, 805k tokens, `workflowRunId: "09-1781237822913"` — file mtime **14:20:24**.
- Fallback telemetry `feature-09-cc-feature-09-cc-<ts>.json` — `source: feature-close-fallback`,
  model `cc-cli`, `costUsd: 0`, `workflowRunId: null` — file mtime **14:20:17**.
- `stats.json` written **14:20:17** with `sessions: 1`, `cc-cli`, `hasRealData: false`,
  `estimatedUsd: 0`. The real $0.5852 record landed 7s too late and was never re-aggregated.

The cost is recoverable from disk — it is purely a close-time ordering/aggregation defect.

## User Stories
- [ ] As an operator, when I close an autonomous feature, the Stats tab shows the real
      token usage and USD cost for each agent, not $0 / `cc-cli`.
- [ ] As an operator, if a fallback record was written but real telemetry later arrives,
      the dashboard reflects the real numbers rather than the placeholder.

## Acceptance Criteria
- [ ] `snapshotFinalStats()` does not freeze cost from a fallback-only telemetry set when
      real transcript telemetry for the same agent+run is expected. Either (a) the real
      transcript telemetry is captured synchronously before stats are snapshotted, or
      (b) aggregation dedupes by `workflowRunId`+agent and prefers the real-data record,
      treating a `feature-close-fallback` record as superseded when a real record exists.
- [ ] The zero `feature-close-fallback` placeholder is never summed alongside (or in place
      of) a real record for the same agent+run — `sessions` reflects real sessions.
- [ ] A feature closed with cc as implementer shows non-zero `estimatedUsd`, correct
      `model` (not `cc-cli`), and `hasRealData: true` in `stats.json` / Stats tab.
- [ ] Regression test: simulate fallback-written-first then real-telemetry-written-after,
      assert aggregation resolves to the real record.

## Technical Approach
Root cause is the interleaving in `lib/feature-close.js`:
- `recordCloseTelemetry()` (~`:669`) attempts transcript capture, then unconditionally
  writes the fallback via `telemetry.writeAgentFallbackSession()` (~`:684-694`) when the
  agent lacks transcript support **or** the capture hasn't returned cost yet.
- `snapshotFinalStats()` (`:1230-1334`) globs `feature-<num>-*` telemetry and **sums every
  file with no dedup** (`costUsd += fileCost` at ~`:1259`); `hasRealData` is computed but
  only flags the row, it does not gate which record wins.

Two viable fixes (pick during planning):
1. **Order fix** — await/settle the transcript-telemetry write before `snapshotFinalStats()`,
   and only write the fallback if no real record exists for that agent+run after settling.
2. **Aggregation fix** — in the scan, group records by `(agent, workflowRunId)`; when a
   group contains any non-fallback real-data record, drop the `feature-close-fallback`
   record from that group. Make this resilient to `workflowRunId: null` on the fallback
   by also matching on agent within the run window.

Prefer (1) if the async window is bounded; otherwise (2) is the robust backstop and also
self-heals already-written stats on the next read. Mirror any aggregation change into
`lib/feature-status.js` `collectCost()` (`:231-253`) which has the same logic.

## Dependencies
depends_on: none

## Out of Scope
- Capturing cost for codex/non-transcript agents (cx) — covered by
  `reviewer-surfacing-in-detail-view`.
- Any dashboard rendering changes.

## Open Questions
- Is the transcript-telemetry write reliably bounded in time, or must we treat it as
  best-effort and rely on the aggregation-dedup backstop?
- Should an already-frozen stats.json be re-snapshotted lazily on dashboard read when a
  newer real telemetry file is detected?

## Related
- Set: detail-fidelity
- Sibling features: reviewer-surfacing-in-detail-view, postclose-detail-panel-fallbacks
- Origin: brewboard feature 09 autonomous-run investigation (2026-06-12)
