# Implementation Log: Feature 03 - arena-research

## Plan

1. Create `research-setup` command to support arena mode with agents parameter
2. Create `research-conduct` command for agents to write findings
3. Create findings file template
4. Extend `research-done` to detect arena mode and show summary
5. Update agent command templates to be arena-aware
6. Add feature suggestion support
7. Add interactive feature selection with deduplication

## Progress

- [x] Extended `research-setup <ID> [agents...]` to create findings files in arena mode
- [x] Created `templates/specs/research-findings-template.md` with Suggested Features section
- [x] Extended `research-done` to auto-detect arena mode and display findings summary
- [x] Updated `research-done` to collect and display all suggested features from agents
- [x] Created `research-setup.md` template for setting up research (solo/arena)
- [x] Created `research-conduct.md` template for agents to conduct research
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

2. **Two-command pattern (like features)**: Created `research-setup` and `research-conduct` to mirror `feature-setup` and `feature-implement`:
   - `research-setup 05` = solo mode setup
   - `research-setup 05 cc gg` = arena mode setup
   - `research-conduct 05` = agent writes findings (detects mode)

3. **Feature suggestions**: Added `## Suggested Features` section to findings template. The `research-done` command aggregates all suggestions and displays them with agent attribution.

4. **Interactive selection**: User chooses how to combine features from multiple agents:
   - Can select all from one agent (prefer one agent's research)
   - Can combine all with auto-deduplication
   - Can select individually (y/n for each feature)
   - Can skip entirely

5. **Auto-deduplication**: Features with the same name (e.g., `research-export`) are merged, showing all agents that suggested it (e.g., `[cc, gg]`). First agent's description is used.

6. **Two-step completion in arena mode**: First `research-done` call shows summary + interactive selection, second call with `--complete` moves to done.

## Files Changed

- `aigon-cli.js` - Added research-setup and research-conduct commands, extended research-done, added readline for interactive prompts
- `templates/specs/research-findings-template.md` - New template for agent findings with Suggested Features section
- `templates/generic/commands/research-setup.md` - New template for setting up research (solo/arena)
- `templates/generic/commands/research-conduct.md` - New template for agents to conduct research (arena-aware)
- `templates/agents/*.json` - Updated command lists to include research-setup and research-conduct
