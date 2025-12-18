# Implementation Log: Feature 03 - arena-research

## Plan

1. Extend `research-start` to support arena mode with agents parameter
2. Create findings file template
3. Extend `research-done` to detect arena mode and show summary
4. Update agent command template to be arena-aware
5. Add feature suggestion support
6. Add interactive feature selection with deduplication

## Progress

- [x] Extended `research-start <ID> [agents...]` to create findings files in arena mode
- [x] Created `templates/specs/research-findings-template.md` with Suggested Features section
- [x] Extended `research-done` to auto-detect arena mode and display findings summary
- [x] Updated `research-done` to collect and display all suggested features from agents
- [x] Updated agent command template `research-start.md` with arena-aware instructions
- [x] Updated CLI help text with research arena examples
- [x] Tested solo and arena mode workflows
- [x] Added interactive feature selection with 4 options:
  - Use all from one agent
  - Combine all (deduplicated)
  - Select individually
  - Skip
- [x] Added auto-deduplication of features (shows which agents suggested each)
- [x] Updates main research doc's Output section with selected features

## Decisions

1. **Mode detection**: Arena mode is detected by checking for findings files (`research-{ID}-*-findings.md`) rather than storing state. This keeps the system stateless and allows mode to be inferred at runtime.

2. **No new CLI commands**: Extended existing `research-start` and `research-done` commands instead of adding new ones:
   - `research-start 05` = solo mode
   - `research-start 05 cc gg` = arena mode

3. **Feature suggestions**: Added `## Suggested Features` section to findings template. The `research-done` command aggregates all suggestions and displays them with agent attribution.

4. **Interactive selection**: User chooses how to combine features from multiple agents:
   - Can select all from one agent (prefer one agent's research)
   - Can combine all with auto-deduplication
   - Can select individually (y/n for each feature)
   - Can skip entirely

5. **Auto-deduplication**: Features with the same name (e.g., `research-export`) are merged, showing all agents that suggested it (e.g., `[cc, gg]`). First agent's description is used.

6. **Two-step completion in arena mode**: First `research-done` call shows summary + interactive selection, second call with `--complete` moves to done.

## Files Changed

- `aigon-cli.js` - Extended research-start and research-done commands, added readline for interactive prompts
- `templates/specs/research-findings-template.md` - New template for agent findings with Suggested Features section
- `templates/generic/commands/research-start.md` - Updated with arena-aware instructions and feature suggestion guidance
