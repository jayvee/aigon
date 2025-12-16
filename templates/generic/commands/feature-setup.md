<!-- description: Setup feature <ID> [agents...] - prepare workspace for implementation -->
# aigon-feature-setup

Prepare your workspace to implement a feature in either solo or arena mode.

## Usage

```bash
# Solo mode (single agent, creates branch)
aigon feature-setup {{ARG1_SYNTAX}}

# Arena mode (multiple agents, creates worktrees)
aigon feature-setup {{ARG1_SYNTAX}} <agent1> <agent2> [agent3...]
```

## Mode Selection

The mode is determined automatically based on parameters:
- **No agents**: Solo mode - creates a git branch
- **2+ agents**: Arena mode - creates worktrees for each agent

## Solo Mode

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

## Arena Mode

Creates separate worktrees for multiple agents to implement in parallel.

Example:
```bash
aigon feature-setup 55 cc gg cx
```

This will:
- Move spec to in-progress
- Create worktrees:
  - `../feature-55-cc-description` (Claude Code)
  - `../feature-55-gg-description` (Gemini)
  - `../feature-55-cx-description` (Codex)
- Create `.env.local` in each worktree with agent-specific PORT
- Create implementation logs for each agent

Next steps:
1. Open each worktree in a separate editor window
2. In each worktree, run `{{CMD_PREFIX}}feature-implement 55`
3. After all implementations complete, return to main repo
4. Run `{{CMD_PREFIX}}feature-eval 55` to compare

## Important Notes

- **Solo mode**: You'll work in your current repository on the feature branch
- **Arena mode**: Each agent works in isolation in their own worktree
- Arena mode requires at least 2 agents
- Worktrees are created in parallel directories (`../feature-ID-agent-desc`)
