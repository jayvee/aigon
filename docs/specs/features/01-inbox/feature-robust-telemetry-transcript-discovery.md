# Feature: robust-telemetry-transcript-discovery

## Summary
Currently `feature-close` discovers CC transcripts by reconstructing the Claude project directory path from the worktree path using a brittle slug algorithm (`/` and `.` replaced with `-`). This must exactly match how Claude Code itself slugifies the path, which is an undocumented implementation detail that can break silently. The fix: the CC StopHook (`capture-session-telemetry`) already writes a normalized telemetry JSON record to `.aigon/telemetry/`. `feature-close` should consume these pre-written records directly instead of re-discovering transcripts via path guessing.

## User Stories
- [ ] As a user, feature cost and token counts are reliably shown after `feature-close`, even when worktrees are stored in unusual locations or the Claude project slug format changes

## Acceptance Criteria
- [ ] `feature-close` reads cost/token data from pre-written `.aigon/telemetry/feature-{id}-{agent}-*.json` records (written by StopHook) rather than re-parsing transcript files via path reconstruction
- [ ] `captureAgentTelemetry` / `captureAllAgentsTelemetry` are replaced or supplemented with a lookup that reads pre-written telemetry records first, falling back to transcript discovery only if none found
- [ ] If the StopHook ran correctly, cost data is always non-zero (no more fallback-zeroed records at close time)
- [ ] `resolveClaudeProjectDir` is still usable for `capture-session-telemetry` (StopHook path) but is no longer on the critical path for `feature-close` cost display

## Technical Approach
The StopHook already writes `writeNormalizedTelemetryRecord` to `.aigon/telemetry/feature-{id}-{agent}-{sessionId}.json`. `captureAllAgentsTelemetry` should:
1. Check for pre-written telemetry records for the feature+agent combination first
2. Aggregate multiple session records (StopHook fires once per session, there may be several)
3. Only fall back to `findTranscriptFiles` if no pre-written records found

This eliminates the dependency on `resolveClaudeProjectDir` slug matching for the close path, making the system robust to any worktree location or Claude Code version.

## Dependencies
-

## Out of Scope
- Changing the StopHook write path (it already writes correctly)
- Changing how CC transcript files are stored by Claude Code itself

## Open Questions
- Should pre-written records be preferred over transcript re-parse, or should we do both and take the max? (Pre-written should be authoritative if StopHook ran.)

## Related
- Research:
