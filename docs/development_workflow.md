# Development Workflow

This project uses **Aigon**, a spec-driven development workflow for AI agents.

## Overview

Aigon enforces a structured **Research → Specification → Implementation** loop:

1. **Research Topics** explore the "why" before building
2. **Feature Specs** define the "what" to build

For feature implementation, Aigon can be used in "Solo mode" or "Multi-agent mode".
1. "Solo mode" - use one agent to implement the feature based on the spec to completion.
2. "Multi-agent backeoff mode" - use multiple agents to implement a feature in parallel, use a different agent to run a "bake off" and evaluate solutions and propose a winner.

## Directory Structure

All workflow state lives in `./docs/specs/`. Folders are numbered for visual ordering:

```
docs/specs/
├── research-topics/
│   ├── 01-inbox/        # New research ideas
│   ├── 02-backlog/      # Prioritized research
│   ├── 03-in-progress/  # Active research
│   ├── 04-done/         # Completed research
│   └── 05-paused/       # On hold
├── features/
│   ├── 01-inbox/        # New feature ideas (feature-description.md)
│   ├── 02-backlog/      # Prioritized features (feature-NN-description.md)
│   ├── 03-in-progress/  # Active features
│   ├── 04-in-evaluation/# Features awaiting review
│   ├── 05-done/         # Completed features
│   ├── 06-paused/       # On hold
│   ├── logs/            # Implementation logs
│   │   ├── selected/    # Winning agent logs
│   │   └── alternatives/# Other agent attempts
│   └── evaluations/     # LLM Judge reports
├── templates/           # Spec templates
└── README.md
```

### Solo Mode
| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec |
| `aigon feature-prioritise <name>` | Prioritize a feature draft |
| `aigon feature-implement <ID>` | Implement feature (branch, code, complete) |
| `aigon feature-eval <ID>` | Evaluate feature implementations in a bake-off, propose winner |
| `aigon feature-done <ID>` | Complete and merge feature |

### Multi-Agent Mode
| Command | Description |
|---------|-------------|
| `aigon bakeoff-setup <ID> <agents>` | Create worktrees for multiple agents to implement feature  |
| `aigon bakeoff-implement <ID>` | Implement feature (branch, code) in current worktree |
| `aigon bakeoff-cleanup <ID> --push` | Clean up losing worktrees and branches |

## Key Rules

1. **Spec-Driven**: Never write code without a spec in `features/03-in-progress/`
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **State-as-Location**: A task's status is determined by which folder it's in

## Solo Mode Workflow

1. Run `aigon feature-implement <ID>` to create branch and move spec
2. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
3. Implement the feature according to the spec
4. Test your changes and wait for user confirmation
5. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
6. Update the implementation log in `./docs/specs/features/logs/`
7. **STOP** - Wait for user to approve before running `aigon feature-done <ID>`

## Bakeoff Mode Workflow

1. Run `aigon bakeoff-setup <ID> cc cx gg` Create worktrees for each agent in the bakeoff
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run  `aigon bakeoff-implement <ID>`
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `aigon feature-eval <ID>`
5. Merge winner: `aigon feature-done <ID> cx`
6. Clean up losers: `aigon cleanup <ID> --push` (to save branches) or `aigon cleanup <ID>` (to delete)

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)