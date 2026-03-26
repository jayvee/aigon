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
