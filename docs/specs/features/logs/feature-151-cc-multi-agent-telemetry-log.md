---
commit_count: 6
lines_added: 337
lines_removed: 63
lines_changed: 400
files_touched: 6
fix_commit_count: 2
fix_commit_ratio: 0.333
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---
# Implementation Log: Feature 151 - multi-agent-telemetry
Agent: cc

## Plan

Extend telemetry from cc-only to all agents using git-based stats as a universal fallback.

## Progress

- Added `captureGitTelemetry()` — extracts commit stats from git history for any agent
- Added `captureAgentTelemetry()` — unified per-agent entry: git stats (all) + transcript telemetry (cc only)
- Added `captureAllAgentsTelemetry()` — iterates all agents, returns map of agent → telemetry
- Fixed eval session misattribution: `findTranscriptFiles` now excludes main repo dir when worktree/agent context is present
- Rewrote feature-close telemetry section to iterate over all manifest agents instead of just the winner
- Non-cc agents get `model: "<agent>-cli"` and git stats only, no cost/token fields

## Decisions

- **Git stats as universal layer**: Rather than trying to parse transcripts from every CLI, git commit stats (lines changed, fix ratio, rework indicators) are available for all agents and provide meaningful signal.
- **Eval session fix approach**: Instead of filtering by timestamp or session content, we simply don't look in the main repo's Claude project dir when we know the agent works in a worktree. This is correct because worktree agents get their own Claude project dir under `~/.claude/projects/<worktree-path>`.
- **Kept `captureFeatureTelemetry` unchanged**: It remains the cc-specific transcript parser. The new `captureAgentTelemetry` wraps it with an agent-type guard.
- **Fallback records**: Every non-cc agent (or agents with no data) still gets a normalized telemetry record via `writeAgentFallbackSession` so the data pipeline always has at least one record per agent.

## Code Review

**Reviewed by**: gemini-cli
**Date**: 2026-03-26

### Findings
- Redundant branch resolution for 'solo' agent in lib/telemetry.js
- hasWorktree logic in findTranscriptFiles was too aggressive, excluding the main repo dir even in Drive mode for agents with an ID
- ReferenceError in lib/commands/feature.js for non-cc agents because telemetryData was scoped inside a conditional block
- Missing fallback session records for cc agents with no transcripts found

### Fixes Applied
- fix(review): correct hasWorktree logic and solo branch resolution in telemetry (668686b9)
- fix(review): properly scope telemetryData and handle fallback session recording (017ee277)

### Notes
- Implementation is otherwise solid and covers all acceptance criteria. Git hooks for attribution and secret blocking are a good addition.
