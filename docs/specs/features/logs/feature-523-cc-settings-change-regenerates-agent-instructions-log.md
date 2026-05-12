---
commit_count: 5
lines_added: 205
lines_removed: 1
lines_changed: 206
files_touched: 6
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 88
output_tokens: 36217
cache_creation_input_tokens: 144837
cache_read_input_tokens: 5569943
thinking_tokens: 0
total_tokens: 5751085
billable_tokens: 36305
cost_usd: 13.7882
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 523 - settings-change-regenerates-agent-instructions
Agent: cc

Added `lib/agent-instructions-regen.js` (helper that spawns `install-agent --all` + commits via spawnSync) and wired it into PUT `/api/settings` and `aigon config set`; schema flag `affectsInstalledCommands` on `profile`/`devServer.enabled`, with a CLI-only key set covering `instructions.*`. Toast surfaced via existing `updateDashboardSetting` helper.

## Code Review

**Reviewed by**: cu  
**Date**: 2026-05-12

### Fixes Applied

- `951ac8c8` — prioritize `regenerateError` toast over success after partial regen failures; drop unused import in regen helper

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- None.

### Notes

- When `install-agent --all` succeeds but `git add`/`git commit` fails, the API correctly returns both `regenerated: true` and `regenerateError`; the dashboard toast logic must check errors first — fixed in `templates/dashboard/js/settings.js`.
- The feature spec Technical Approach mentions `lib/commands/setup.js` for `config set`; the implementation correctly hooks `aigon config set` in `lib/commands/infra.js` (likely where that handler lives now). Worth aligning the spec text on a docs pass — not escalated.
