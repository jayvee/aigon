# Implementation Log: Feature 05 - command-metadata-improvements

## Plan

Three incremental improvements to CC slash command UX, identified by research-03:
1. Subdirectory grouping — move commands to `.claude/commands/aigon/`
2. Argument hints — add `argument-hint` frontmatter per command
3. Safety frontmatter — add `disable-model-invocation` for destructive commands

## Progress

- [x] Updated `cc.json`: `commandDir` to `.claude/commands/aigon`, removed prefix, added frontmatter fields
- [x] Updated `CMD_PREFIX` from `/aigon-` to `/aigon:` and `implementPrompt` to match
- [x] Added `COMMAND_ARG_HINTS` map with per-command hints (18 commands)
- [x] Added `COMMANDS_DISABLE_MODEL_INVOCATION` set (feature-done, feature-cleanup, worktree-open)
- [x] Updated `formatCommandOutput()` to emit `argument-hint` and `disable-model-invocation` for CC, per-command `args` for CX
- [x] Added `migrateOldFlatCommands()` to clean up old flat commands during upgrade
- [x] Verified all 4 agents install correctly (`cc`, `gg`, `cx`, `cu`)
- [x] Verified `aigon update` works with new directory structure
- [x] User tested and confirmed working

## Decisions

- **CC commands use `/aigon:` prefix** (colon separator from subdirectory nesting), matching Gemini's existing `/aigon:` pattern
- **Migration cleanup is automatic** — `migrateOldFlatCommands()` detects and removes old `aigon-*.md` files from `.claude/commands/` when installing to the new subdirectory
- **CX args improved as bonus** — replaced hardcoded `args: feature_id` with per-command hints from the same `COMMAND_ARG_HINTS` map
- **Commands with empty hints** (`help`, `feature-list`) correctly omit `argument-hint` frontmatter / emit `args: none`
