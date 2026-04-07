# Feature: agent-attributed-token-analytics

## Summary
Add per-agent token attribution to the analytics pipeline. Every token record must be attributed to a specific agent (cc, cx, gg, mv, etc.) so users can see which agents consume the most tokens, how agent usage mix changes over time, and whether fleet mode is cost-effective vs solo mode. This builds on the existing telemetry infrastructure and fixes the solo-mode transcript attribution bug.

## User Stories
- [ ] As a user running fleet mode, I want to see a breakdown of tokens per agent for each feature so I can assess whether 3 agents is worth the cost vs 1 implementer + 1 reviewer
- [ ] As a user tracking costs over time, I want to see a stacked area/bar chart showing total token usage per day/week with each agent as a separate colored band, so I can see how my agent mix is evolving
- [ ] As a user comparing agents, I want summary stats (median tokens, median cost) per agent type so I can identify which agents are most efficient
- [ ] As a user reviewing a single feature, I want to see per-agent token breakdowns in the feature details (Tokens column or expandable row) rather than just a single total

## Acceptance Criteria
- [ ] `collectAnalyticsData()` returns `tokensByAgent: { [agentId]: { billableTokens, sessions, costUsd } }` per feature
- [ ] Telemetry records in `.aigon/telemetry/*.json` populate `tokenUsage.billable` correctly (fix session-end hook to capture actual token counts from transcript)
- [ ] For worktree/fleet mode: transcripts are scoped to the worktree dir, already agent-attributed — verify this works end-to-end
- [ ] For solo/Drive mode: the single transcript dir cannot be split by feature — `billableTokens` stays null (gap, not wrong data). Session-end telemetry (`.aigon/telemetry/`) is the attribution source
- [ ] `tokensByAgent` data is available downstream for the dashboard's insights view (out of scope here — this feature ships the data only)
- [ ] Top Token Consumers table shows per-agent breakdown (expandable or inline columns)
- [ ] `node -c lib/telemetry.js` passes (syntax check)
- [ ] Dashboard renders without JS errors after changes

## Validation
```bash
node --check lib/telemetry.js
node --check lib/utils.js
node -e "const t = require('./lib/telemetry'); console.log('telemetry OK')"
```

## Technical Approach

### Data pipeline fixes
1. **Fix `findTranscriptFiles` for solo mode** — already partially done (returns empty for solo to avoid wrong data). The real fix: `captureSessionTelemetry` (session-end hook) must write actual token counts from the transcript into `.aigon/telemetry/*.json` so that even solo features get per-agent data from the telemetry path.
2. **Fix 0-token telemetry records** — current session-end hook creates telemetry files with `billable: 0`. Trace `captureSessionTelemetry` → `parseTranscriptFile` to find why tokens aren't being extracted. Likely the transcript path isn't being passed or the JSONL parsing fails silently.

### Analytics aggregation
3. **Extend `collectAnalyticsData()`** in `lib/utils.js` to aggregate telemetry by agent per feature. The `byFeature` map from `readTelemetryRecords()` already groups records by feature — add a second pass that groups by `record.agent` within each feature.
4. **Return `tokensByAgent` on each feature object** in the API response so the frontend can render per-agent breakdowns.

### Top Token Consumers (OSS dashboard)
5. **Extend Top Token Consumers**: add per-agent columns or expandable rows showing agent breakdown

## Dependencies
- None — this feature is purely a data pipeline extension

## Out of Scope
- Real-time token streaming/live counters during agent execution
- Token budgets or alerts (separate feature)
- Retroactively fixing historical data for solo-mode features (gap is acceptable)
- Cost model configuration (per-model pricing) — use existing `resolveCostUsd()`

## Open Questions
- (None — scope finalized as data-pipeline-only)

## Related
- `lib/telemetry.js` — transcript parsing, session capture, `findTranscriptFiles`
- `lib/utils.js:collectAnalyticsData()` — analytics aggregation pipeline
- `templates/dashboard/js/logs.js` — base dashboard stats/details rendering
