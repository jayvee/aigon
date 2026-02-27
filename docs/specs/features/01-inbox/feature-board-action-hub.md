# Feature: board-action-hub

## Summary
Enhance the `/aigon:board` command to append contextual, copy-pasteable action commands next to each item. The board becomes a launchpad — see the state, then immediately act on it without remembering command names.

## User Stories
- [ ] As a developer, I want to run `/aigon:b` and see suggested next actions inline with each item, so I can just copy-paste to act
- [ ] As a developer reviewing the board, I want each in-progress item to show the logical next step (submit, eval, done) based on its current state
- [ ] As a developer with inbox items, I want to see prioritise commands ready to run with letter shortcuts

## Acceptance Criteria
- [ ] Board output includes a "→ next action" line for each active item
- [ ] In-progress features show the appropriate next command (`feature-submit`, `feature-eval`, `feature-done`) based on mode (solo vs arena) and current state
- [ ] In-progress research shows `research-conduct` or `research-done` as appropriate
- [ ] Backlog items show `feature-setup <ID>` or `research-setup <ID>`
- [ ] Inbox items show `feature-prioritise <letter>` using existing letter-shortcut system
- [ ] Actions respect the `commandStyle` preference (short `/afs` vs long `/aigon:feature-submit`)
- [ ] Action suggestions are displayed via the agent's response text (not just in raw CLI output) so they're visible and clickable
- [ ] `--no-actions` flag suppresses action lines for a clean view
- [ ] `node --check aigon-cli.js` passes

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

### Option A: CLI-side (recommended)
Add action hint generation to the `board` command in `aigon-cli.js`:
- After rendering each item, append a `→ /aigon:fs` style hint based on item stage
- Detection logic: check for worktrees (`git worktree list`), check spec stage from directory location
- New `--no-actions` flag to suppress

### Option B: Prompt-side
Modify the `board.md` template to instruct the agent to:
1. Run `aigon board` as today
2. For each item in the output, determine the next action
3. Re-render the board with action hints appended

Option A is better because it's deterministic and doesn't require extra agent reasoning.

### Example output
```
FEATURES
┌──────────────────────┼──────────────────────┼──────────────────────┐
│ Inbox                │ Backlog              │ In Progress          │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ a) board-action-hub  │ #24 context-next     │ #23 cmd-aliases *    │
│   → /aigon:fp a      │   → /aigon:fse 24    │   → /aigon:fs        │
└──────────────────────┼──────────────────────┼──────────────────────┘
```

### Implementation steps
1. Add `getNextAction(item)` helper that returns the suggested slash command based on item type + stage
2. In the board rendering loop, append action line below each item name
3. Use short aliases when `COMMAND_ALIASES` map is available
4. Add `--no-actions` flag parsing

## Dependencies
- Command aliases feature (for short alias format in suggestions)
- Command display preference feature (for `commandStyle` config)
- Existing board letter-shortcut system (`board-map.json`)

## Out of Scope
- Making actions executable/clickable from the board (just copy-pasteable text)
- Evaluation or done-stage items (they don't need next actions)
- Dev server status integration

## Open Questions
- Should actions show in both kanban and list views, or only kanban? Recommend: both.
- Should the `--list` view show more detail per action (e.g., "submit: 3 files changed")? Defer to later.

## Related
- Feature: context-aware-next (complementary — next is branch-aware, board is overview-aware)
- Feature: command-aliases (prerequisite for short alias format)
- Feature: command-display-preference (controls short vs long in output)
- Research: research-03-simplify-command-parameters
