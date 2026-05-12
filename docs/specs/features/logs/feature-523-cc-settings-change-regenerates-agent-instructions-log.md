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
