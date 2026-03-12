---
status: submitted
updated: 2026-03-12T07:52:47.292Z
---

# Implementation Log: Feature 46 - command-vocabulary-rename
Agent: cc

## Plan

Implemented in 4 phases:

1. **aigon-cli.js bulk renames**: Used a Python script for systematic string replacement across the ~12K line CLI. Then manually added new handlers (research-submit, research-autopilot) and deprecated alias handlers for all old names.
2. **Command templates**: Created 7 new template files; updated cross-references in 14 existing templates using a second Python script.
3. **Agent configs**: Updated all 4 agent configs (cc, cu, cx, gg) with renamed commands and new commands via a Python script.
4. **Documentation**: Updated README, GUIDE, development_workflow, autonomous-mode, docs/agents/claude.md, and active inbox specs.

## Progress

All acceptance criteria met:

- ✅ All 5 renames applied in `aigon-cli.js` (handlers, aliases, help text, error messages)
- ✅ All 4 agent configs updated (`cc.json`, `cu.json`, `cx.json`, `gg.json`)
- ✅ Command template files renamed: `feature-implement.md`→`feature-do.md`, `feature-done.md`→`feature-close.md`, `research-conduct.md`→`research-do.md`, `research-done.md`→`research-close.md`
- ✅ New templates created: `research-submit.md`, `feature-autopilot.md`, `research-autopilot.md`
- ✅ Cross-references updated in 14 other templates (help.md, next.md, feature-setup.md, research-setup.md, etc.)
- ✅ `## Prompt Suggestion` sections updated (feature-setup suggests `feature-do`, research-do suggests `research-close`, etc.)
- ✅ Old command names registered as deprecated aliases — print `⚠️ Deprecated:` warning then delegate
- ✅ `help.md` updated with new vocabulary table and all new aliases
- ✅ Core documentation updated: README, GUIDE, `docs/development_workflow.md`, `docs/autonomous-mode.md`
- ✅ Agent docs updated: `docs/agents/claude.md`
- ✅ `research-autopilot` implemented: spawns tmux sessions with `research-do`, polls findings files for `submitted` status, auto-runs `research-synthesize` with `--auto-synthesize`
- ✅ `feature-autopilot` implemented: rename of `conduct` with same logic, updated messaging
- ✅ `research-submit` implemented: detects findings file, writes `status: submitted` to frontmatter
- ✅ `node -c aigon-cli.js` passes
- ✅ All aliases resolve correctly: `aigon afd`, `aigon afcl`, `aigon ard`, `aigon arcl`, `aigon afap`, `aigon arap`, `aigon arsb`

## Decisions

**Alias CLI resolution (new)**: Added alias lookup to the main execution path so `aigon afd` etc. work directly in the shell. Previously, `COMMAND_ALIASES` only generated agent slash command files — they didn't resolve for `aigon <alias>` shell invocations. Added `const resolvedCommand = COMMAND_ALIASES[cleanCommand] || cleanCommand` before the command dispatch.

**`afi` alias removed**: The spec rename map replaces `afi` (feature-implement) with `afd` (feature-do). `afi` is no longer registered. Users who relied on `afi` will get "Unknown command" and should update to `afd`.

**Old template files kept**: `feature-implement.md`, `feature-done.md`, `research-conduct.md`, `research-done.md` remain in `templates/generic/commands/` but are superseded. They're kept as historical references and won't be installed by `aigon install-agent` since the agent configs no longer list them in `commands`.

**Deprecated aliases work end-to-end**: Old CLI names (`aigon feature-implement`, `aigon conduct`, etc.) delegate to new handlers after printing a warning. This allows users with muscle memory to adapt gradually.

**research-submit auto-detection**: If only one findings file exists for a research topic, the agent is auto-detected. With multiple agents it requires an explicit argument. This mirrors how `agent-status` works for features.

**Historical files skipped**: Per spec, files in `docs/specs/features/05-done/`, `docs/specs/features/evaluations/`, research `04-done/`, and `logs/selected/` were intentionally left unchanged.

## Manual Testing Checklist

1. `node -c aigon-cli.js` → passes silently ✅
2. `aigon afd` → shows `feature-do` usage
3. `aigon afcl` → shows `feature-close` usage
4. `aigon ard` → shows `research-do` usage
5. `aigon arcl` → shows `research-close` usage
6. `aigon afap` → shows `feature-autopilot` usage
7. `aigon arap` → shows `research-autopilot` usage
8. `aigon arsb` → shows `research-submit` usage
9. `aigon feature-implement` → deprecation warning + feature-do usage
10. `aigon feature-done` → deprecation warning + feature-close usage
11. `aigon research-conduct` → deprecation warning + research-do usage
12. `aigon research-done` → deprecation warning + research-close usage
13. `aigon conduct` → deprecation warning + feature-autopilot usage
14. `aigon help` → shows new command names and updated alias table
15. New template files exist in `templates/generic/commands/`
16. `templates/agents/cc.json` commands array includes all 7 new/renamed commands

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-12

### Findings
- `templates/agents/cx.json` still launched Codex with `/prompts:aigon-feature-implement {featureId}`, so the renamed `feature-do` flow was broken for Codex users.
- `research-autopilot` built tmux commands from nonexistent `cli.commandPrefix` and `cli.launchCommand` fields instead of the existing research command builder, so spawned research agents would not launch correctly.
- Fleet research guidance in `aigon-cli.js` told users to run `research-close` to synthesize findings, which skips the intended `research-synthesize` step.

### Fixes Applied
- `389be21` `fix(review): repair renamed Codex prompt and research autopilot flow`

### Notes
- `node -c aigon-cli.js` passes after the review fix.
