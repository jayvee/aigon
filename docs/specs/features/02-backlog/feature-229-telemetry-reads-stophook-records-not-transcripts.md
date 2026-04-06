# Feature: telemetry-reads-stophook-records-not-transcripts

## Summary
At feature-close time, `captureAllAgentsTelemetry` currently tries to re-parse Claude Code JSONL transcript files by reconstructing their directory path from the worktree path using a slug algorithm. This is brittle — if Claude Code changes its path encoding, or if path special characters differ, the dir won't be found and cost shows as 0. The CC StopHook already writes normalized telemetry records (`.aigon/telemetry/feature-{id}-{agent}-{sessionId}.json`) during each session. Feature-close should aggregate those existing records instead of re-parsing transcripts.

## Acceptance Criteria
- [ ] `captureAllAgentsTelemetry` reads existing normalized telemetry records from `.aigon/telemetry/` and aggregates them per agent
- [ ] `findTranscriptFiles` / `resolveClaudeProjectDir` slug matching is no longer used as the primary cost source
- [ ] Cost, tokens, and sessions show correctly in the dashboard for fleet mode features
- [ ] If no StopHook record exists for an agent, fall back gracefully (0 cost, not crash)
- [ ] Works for both Drive (solo) and Fleet (multi-agent) modes

## Technical Approach
- `captureAllAgentsTelemetry` scans `.aigon/telemetry/` for records matching `feature-{id}-{agent}-*.json` (already written by `captureSessionTelemetry` StopHook)
- Aggregate: sum tokens/cost, pick model, count sessions per agent
- Remove or demote `findTranscriptFiles` + `resolveClaudeProjectDir` to a fallback-only path (e.g. if no StopHook records exist at all — legacy sessions)
- `captureSessionTelemetry` StopHook already uses `AIGON_PROJECT_PATH` to write to the main repo (not the worktree) — this is the source of truth
- The `writeNormalizedTelemetryRecord` schema already has all fields needed: `tokenUsage`, `costUsd`, `model`, `sessionId`, `agent`, `entityType`, `featureId`

## Dependencies
-

## Out of Scope
- Changing the StopHook write path or schema
- Research telemetry (handled separately — `collectCost` in research.js)

## Related
- Context: `resolveClaudeProjectDir` slug-matching was a brittle workaround; this removes the need for it
