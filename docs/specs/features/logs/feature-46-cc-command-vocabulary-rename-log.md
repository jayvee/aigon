---
status: submitted
updated: 2026-03-12T08:00:00.000Z
---

# Implementation Log: Feature 46 - command-vocabulary-rename
Agent: cc

## Plan

Implemented in 4 phases:
1. **aigon-cli.js**: Bulk renames via Python script, then added new handlers and deprecated aliases
2. **Command templates**: Created 7 new templates (feature-do, feature-close, research-do, research-close, research-submit, feature-autopilot, research-autopilot); updated cross-references in 14 existing templates
3. **Agent configs**: Updated all 4 agent configs (cc, cu, cx, gg) with new command names and new commands
4. **Documentation**: Updated README, GUIDE, development_workflow, autonomous-mode, docs/agents/claude.md, and inbox specs

## Progress

All acceptance criteria met:
- ✅ All 5 renames applied in aigon-cli.js (handlers, aliases, help text, error messages)
- ✅ All 4 agent configs updated
- ✅ Command template files renamed (old kept as deprecated) and new ones created
- ✅ New templates created: research-submit.md, feature-autopilot.md, research-autopilot.md
- ✅ Cross-references in other templates updated
- ✅ Prompt Suggestion sections updated to suggest new command names
- ✅ Old command names registered as deprecated aliases with warnings
- ✅ help.md updated with new vocabulary table and aliases
- ✅ Core documentation updated
- ✅ research-autopilot implemented (spawns tmux sessions, polls findings files, auto-synthesize option)
- ✅ feature-autopilot implemented (rename of conduct with same logic)
- ✅ research-submit implemented (writes status marker to findings file)
- ✅ node -c aigon-cli.js passes
- ✅ All aliases resolve correctly (aigon afd, afcl, ard, arcl, afap, arap)

## Decisions

**Alias CLI resolution**: Added alias resolution to main execution path so `aigon afd` etc. work in the shell (not just as agent slash commands). This was needed for the acceptance criteria requiring `aigon afd` to resolve correctly.

**`afi` alias removal**: The `afi` alias was replaced by `afd` per the spec rename map. `afi` is no longer registered as an alias.

**Python scripts for bulk replacements**: Used Python scripts for systematic string replacement across the ~12K line CLI file and template files. This was safer and more reliable than many individual Edit operations.

**Deprecated templates kept**: The old template files (feature-implement.md, feature-done.md, research-conduct.md, research-done.md) are kept in place as a reference but are superseded by the new named files. The CLI deprecated aliases will forward to new handlers with warnings.

**research-submit implementation**: Implemented as a CLI command that detects the agent's findings file and sets `status: submitted` in its frontmatter. Auto-detects agent if only one findings file exists; requires explicit agent argument if multiple.

**research-autopilot**: Modeled closely on feature-autopilot but polls findings files instead of feature log files. Uses `research-do` command to spawn agents. Auto-synthesize option available via `--auto-synthesize`.

## Manual Testing Checklist

1. `node -c aigon-cli.js` → should output nothing (passes)
2. `aigon afd` → should show feature-do usage
3. `aigon afcl` → should show feature-close usage
4. `aigon ard` → should show research-do usage
5. `aigon arcl` → should show research-close usage
6. `aigon afap` → should show feature-autopilot usage
7. `aigon arap` → should show research-autopilot usage
8. `aigon arsb` → should show research-submit usage
9. `aigon feature-implement` → should show deprecation warning then feature-do usage
10. `aigon feature-done` → should show deprecation warning then feature-close usage
11. `aigon research-conduct` → should show deprecation warning then research-do usage
12. `aigon research-done` → should show deprecation warning then research-close usage
13. `aigon conduct` → should show deprecation warning then feature-autopilot usage
14. `aigon help` → should show new command names (feature-do, feature-close, etc.)
15. Check templates/generic/commands/ contains: feature-do.md, feature-close.md, research-do.md, research-close.md, research-submit.md, feature-autopilot.md, research-autopilot.md
16. Check templates/agents/cc.json `commands` array contains feature-do, feature-close, research-do, research-close, research-submit, feature-autopilot, research-autopilot
