# Feature: multi-agent-telemetry

## Summary

Extend telemetry capture to work for all agents (gg, cx, cu), not just Claude Code (cc). Currently `lib/telemetry.js` only reads Claude JSONL transcripts from `~/.claude/projects/`. Gemini and Codex don't produce compatible transcripts, and Cursor transcripts exist (`~/.cursor/projects/`) but lack usage/token fields. This feature adds git-based telemetry as a universal fallback: commit stats (lines changed, files touched, commit count, fix ratio) are available for every agent regardless of transcript format.

## User Stories

- [ ] As a user running Fleet mode with cc + gg, I want to see telemetry for both agents in their log frontmatter, not just the cc agent
- [ ] As a user, I want to see accurate cost data for cc agents and commit-based stats for all agents
- [ ] As a user, I want telemetry attribution to be correct — eval session data should not leak into implementation agent logs

## Acceptance Criteria

- [ ] `captureFeatureTelemetry()` writes git-based stats (commit_count, lines_added, lines_removed, files_touched, fix_commit_count, fix_commit_ratio) to every agent's log frontmatter, not just cc
- [ ] Token/cost telemetry is only written for cc agents (from Claude transcripts) — other agents get `model: "<agent-cli>"` and no cost fields
- [ ] Eval session transcripts are NOT attributed to implementation agent logs (fix the misattribution bug)
- [ ] `feature-close` calls telemetry capture for ALL agents that participated, not just the winner
- [ ] Rework metrics (thrashing, fix_cascade, scope_creep) are computed from git history for all agents

## Validation

```bash
node -c lib/telemetry.js
node -c lib/commands/feature.js
```

## Technical Approach

### 1. Git-based telemetry (universal, all agents)
Extract from the agent's branch/worktree using `git log` and `git diff --stat`:
- `commit_count`, `lines_added`, `lines_removed`, `lines_changed`, `files_touched`
- `fix_commit_count`, `fix_commit_ratio` (commits matching `fix:` prefix)
- Rework indicators from commit history patterns

This already partially exists in `captureFeatureTelemetry()` — it uses `git log` on the worktree. Extend it to run for every agent in the manifest, not just the one whose Claude transcripts are found.

### 2. Transcript-based telemetry (cc only)
Keep existing Claude JSONL parsing for cc agents. Add agent-ID filtering so transcripts from the eval session (which runs in the main repo dir) don't get attributed to implementation agents.

### 3. Telemetry capture per agent
In `feature-close`, iterate over `manifest.agents` and call telemetry capture for each agent's worktree/branch, writing to each agent's log file independently.

### 4. Cursor transcripts (future)
Cursor stores JSONL at `~/.cursor/projects/<path>/agent-transcripts/` but without usage/token fields. If Cursor adds usage data in the future, the same transcript-parsing approach can be extended. Out of scope for now.

## Dependencies

- `lib/telemetry.js` — main telemetry module
- `lib/commands/feature.js` — feature-close telemetry capture section
- `lib/manifest.js` — reading agent list from manifest

## Out of Scope

- Gemini CLI telemetry API (doesn't exist yet)
- Codex transcript parsing (no local transcripts)
- Cursor usage/token extraction (transcripts lack usage fields)
- Dashboard Insights visualisation changes (separate feature)

## Open Questions

- Should we store per-agent telemetry as separate frontmatter blocks or separate log files? (Current: one log file per agent, frontmatter at top — keep this pattern)

## Related

- `lib/telemetry.js` — current CC-only implementation
- Feature 01 brewboard deep-dive revealed the gaps (Mar 2026)
