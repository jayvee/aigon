# Implementation Log: Feature 215 - codex-reliable-autonomous-submission
Agent: cx

## Plan
- Remove `feature-submit` from Codex-facing command surfaces so completion guidance points to one path.
- Harden the `feature-do` completion step with explicit non-optional submit rules.
- Make autonomous auto-submit failures explicit in CLI output so stalled workflows are diagnosable.

## Progress
- Updated Codex-facing command docs and templates to remove `feature-submit` from feature command lists:
  - `templates/generic/docs/agent.md`
  - `docs/agents/codex.md`
  - `templates/agents/cx.json` (removed `feature-submit` from installed Codex commands)
- Strengthened `templates/generic/commands/feature-do.md` final step:
  - completion is not valid until `aigon agent-status submitted` succeeds
  - forbids claiming done/ready before successful signal
  - instructs reporting exact submission failure and stopping (no substitute commands)
- Updated guidance prompts to stop steering toward `feature-submit`:
  - `templates/generic/commands/next.md` now directs to commit + `aigon agent-status submitted`
  - `templates/generic/commands/help.md` no longer lists `feature-submit` in feature command/help shortcuts
- Hardened autopilot signal behavior in `lib/validation.js`:
  - no longer prints successful auto-submit when submit signaling fails
  - surfaces explicit failure details from `aigon agent-status submitted`
  - sets non-zero exit code and prints actionable next step on submission failure
  - replaces non-autonomous follow-up hint from `feature-submit` to explicit `agent-status submitted` flow
- Clarified wording in `lib/commands/misc.js` comment from feature-submit framing to generic submission signaling.
- Ran `node aigon-cli.js install-agent cx` to sync Codex-installed prompts and removed deprecated global prompt `aigon-feature-submit.md`.

## Decisions
- Kept the fix focused on Codex-facing reliability and autonomous legibility without broad command-system refactors.
- Treated submission signaling as the single source of completion truth in runtime messaging (`aigon agent-status submitted`), which directly addresses autonomous stalls where coding succeeded but readiness did not propagate.
- Preserved existing commit/log behavior; only success/failure reporting and operator guidance were tightened.

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-04-04

### Findings
1. **Critical regression**: `lib/dashboard-status-helpers.js` — the entire `_getCachedTmuxList()` cache (added in `dc35422b`) was removed and replaced with direct `runTmux()` calls in every function. This reverts a performance optimization unrelated to the feature scope, causing repeated `tmux list-sessions` spawns on every poll cycle.
2. **Minor**: `templates/generic/commands/help.md` — removing `/afsb` from the shortcut table left `/arsb` on an orphaned row with empty left columns instead of consolidating it.

### Fixes Applied
- `dff4876d` fix(review): restore tmux session list cache removed by mistake
- `954bcf79` fix(review): fix help.md shortcut table — merge orphaned arsb row

### Notes
- All other changes (validation.js error handling, feature-do.md completion contract, next.md guidance, cx.json/agent.md/codex.md command removal, misc.js comment) are well-aligned with the spec and correctly implemented.
- The validation.js reordering (submit signal after log commit) is a good improvement — ensures the log is committed before signaling readiness.
- The explicit failure path with `process.exitCode = 1` and actionable error messages directly addresses the autonomous stall problem described in the spec.
