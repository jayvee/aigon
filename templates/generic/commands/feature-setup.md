<!-- description: Setup feature <ID> [agents...] - prepare workspace for implementation -->
# aigon-feature-setup

Prepare your workspace to implement a feature in either solo or arena mode.

## Usage

```bash
# Solo mode (creates branch in current repo)
aigon feature-setup {{ARG1_SYNTAX}}

# Solo worktree mode (creates worktree for parallel development)
aigon feature-setup {{ARG1_SYNTAX}} <agent>

# Arena mode (multiple agents compete in separate worktrees)
aigon feature-setup {{ARG1_SYNTAX}} <agent1> <agent2> [agent3...]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature in the backlog:
1. List all files in `./docs/specs/features/02-backlog/` matching `feature-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Mode Selection

The mode is determined automatically based on parameters:
- **No agents**: Solo mode - creates a git branch in the current repo
- **1 agent**: Solo worktree mode - creates a worktree for parallel development
- **2+ agents**: Arena mode - creates worktrees for each agent to compete

## Solo Mode (branch)

Creates a feature branch for solo implementation.

Example:
```bash
aigon feature-setup 55
```

This will:
- Move spec to in-progress
- Create branch `feature-55-description`
- Create implementation log

Next steps:
```bash
{{CMD_PREFIX}}feature-implement 55     # Start implementing
```

## Solo Worktree Mode (parallel development)

Creates a worktree so you can work on multiple features simultaneously without conflicts.

Example:
```bash
aigon feature-setup 55 cc
aigon feature-setup 56 cc    # Work on both in parallel
```

This will:
- Move spec to in-progress
- Create worktree: `../<repo>-worktrees/feature-55-cc-description`
- Create `.env.local` with agent-specific PORT
- Create implementation log in the worktree

**After setup completes:** Ask the user if they want you to switch to the worktree and start implementing. If yes, `cd` to the worktree directory and run `{{CMD_PREFIX}}feature-implement` from there. Remember that `{{CMD_PREFIX}}feature-done` must be run from the main repo later.

## Arena Mode (competition)

Creates separate worktrees for multiple agents to implement the same feature in parallel.

Example:
```bash
aigon feature-setup 55 cc gg cx cu
```

This will:
- Move spec to in-progress
- Create worktrees in `../<repo>-worktrees/`:
  - `feature-55-cc-description` (Claude Code)
  - `feature-55-gg-description` (Gemini)
  - `feature-55-cx-description` (Codex)
  - `feature-55-cu-description` (Cursor)
- Create `.env.local` in each worktree with agent-specific PORT
- Create implementation logs for each agent

Next steps:
1. Open each worktree in a separate editor window
2. In each worktree, run `{{CMD_PREFIX}}feature-implement 55`
3. After all implementations complete, return to main repo
4. Run `{{CMD_PREFIX}}feature-eval 55` to compare

## Important Notes

- **Solo mode**: You'll work in your current repository on the feature branch
- **Solo worktree mode**: You'll work in an isolated worktree — ideal for parallel development of multiple features
- **Arena mode**: Multiple agents compete on the same feature in their own worktrees
- Worktrees are created in `../<repo>-worktrees/` to keep them grouped with the project
