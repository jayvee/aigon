# Implementation Log: Feature 229 - telemetry-reads-stophook-records-not-transcripts
Agent: cc

## Approach

Added `aggregateNormalizedTelemetryRecords(featureId, agent, options)` to
`lib/telemetry.js` that scans `.aigon/telemetry/` for records matching
`feature-{id}-{agent}-*.json` (the schema written by `writeNormalizedTelemetryRecord`)
and aggregates them into the same shape returned by `captureFeatureTelemetry`.

`captureAgentTelemetry` now calls the aggregator first for any
transcript-capable agent. If records exist (the StopHook always writes
them), it returns immediately with that data and never touches
`findTranscriptFiles` / `resolveClaudeProjectDir`. Existing per-agent
transcript parsing branches (gg → Gemini chats, cx → Codex sessions,
cc → Claude JSONL) are kept as a fallback for sessions that pre-date
StopHook record writing.

## Decisions

- **Solo agent → wildcard**: When called with `agent: 'solo'` (legacy
  callers), the aggregator matches *any* agent for the given feature ID.
  In practice the StopHook writes records under the real agent code
  (`cc`/`gg`/`cx`) — never `solo` — because `AIGON_AGENT_ID` is set in
  the worktree shell.
- **`hasRealData` guard**: Sessions with all-zero usage and zero cost
  don't count toward the aggregation. This prevents fallback records
  (which carry zero usage) from short-circuiting the legacy transcript
  fallback path before real data exists.
- **No changes to feature-close.js**: The early-return inside
  `captureAgentTelemetry` is sufficient. The downstream
  `existingHasData` check that decides whether to write a
  `feature-close-transcript` record still does the right thing —
  StopHook records already exist, so it's a no-op.
- **Test budget**: Added a focused regression test in
  `lifecycle.test.js` covering the aggregator's three behaviors
  (multi-session sum, solo wildcard, missing-feature → null). To stay
  under the 2,000 LOC ceiling, deleted two thin lifecycle tests
  ("snapshotToDashboardActions returns correct format" — trivial field
  presence asserts; "implementing state has pause" — already covered by
  the pause-state test).

## Manual Testing Checklist

1. Close a Fleet feature where multiple cc sessions wrote records to
   `.aigon/telemetry/`. Verify the agent log frontmatter shows
   `cost_usd > 0` and `sessions = N`.
2. Close a feature where the worktree path uses unusual characters
   (e.g. dots). Previously this would silently produce `cost = 0` due to
   slug-mismatch in `resolveClaudeProjectDir`; now it should still report
   real cost from the StopHook records.
3. Close a legacy feature with NO `.aigon/telemetry/` records (e.g. one
   that ran before StopHook record writing was enabled) — verify it
   falls back to the old transcript-parsing path without crashing.
4. Inspect the dashboard: cost/tokens/sessions for closed Fleet features
   should match the sum of records under
   `.aigon/telemetry/feature-{id}-{agent}-*.json`.

## Verification

- `npm test` — 8 lifecycle tests + 4 other suites pass; new aggregator
  test green.
- `bash scripts/check-test-budget.sh` — 1990 / 2000 LOC.
- Spot-checked against a real telemetry record:
  `aggregateNormalizedTelemetryRecords('160', 'cc')` returned the same
  cost ($5.5307) that the record file holds.
