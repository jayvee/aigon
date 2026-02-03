# Development Workflow

This project uses **Aigon**, a spec-driven development workflow for AI agents.

## Overview

Aigon enforces a structured **Research → Specification → Implementation** loop:

1. **Research Topics** explore the "why" before building
2. **Feature Specs** define the "what" to build

For feature implementation, Aigon can be used in "Solo mode" or "Arena mode".
1. "Solo mode" - use one agent to implement the feature based on the spec to completion.
2. "Arena mode" - use multiple agents to implement a feature in parallel, then evaluate solutions and select a winner.

## Directory Structure

All workflow state lives in `./docs/specs/`. Folders are numbered for visual ordering:

```
docs/specs/
├── research-topics/
│   ├── 01-inbox/        # New research ideas
│   ├── 02-backlog/      # Prioritised research
│   ├── 03-in-progress/  # Active research
│   ├── 04-done/         # Completed research
│   └── 05-paused/       # On hold
├── features/
│   ├── 01-inbox/        # New feature ideas (feature-description.md)
│   ├── 02-backlog/      # Prioritised features (feature-NN-description.md)
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

### Feature Commands (Unified for Solo and Arena modes)
| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec |
| `aigon feature-prioritise <name>` | Assign ID and move to backlog |
| `aigon feature-setup <ID> [agents...]` | Setup for solo (no agents) or arena (with agents) |
| `aigon feature-implement <ID>` | Implement feature in current branch/worktree |
| `aigon feature-eval <ID>` | Create evaluation (code review for solo, comparison for arena) |
| `aigon feature-review <ID>` | Code review with fixes by a different agent |
| `aigon feature-done <ID> [agent]` | Merge and complete (specify agent in arena mode) |
| `aigon feature-cleanup <ID>` | Clean up arena worktrees and branches |

## Key Rules

1. **Spec-Driven**: Never write code without a spec in `features/03-in-progress/`
2. **Work in isolation**: Solo mode uses branches, arena mode uses worktrees
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **State-as-Location**: A task's status is determined by which folder it's in

## Solo Mode Workflow

1. Run `aigon feature-setup <ID>` to create branch and move spec to in-progress
2. Run `aigon feature-implement <ID>` to begin implementation
3. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `aigon feature-done <ID>`

## Arena Mode Workflow

1. Run `aigon feature-setup <ID> cc gg cx cu` to create worktrees for each agent
2. **STOP** - Tell the user to open each worktree in a separate session
3. In each worktree session:
   - Run `aigon feature-implement <ID>`
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `aigon feature-eval <ID>`
5. Merge winner: `aigon feature-done <ID> cc`
6. Clean up losers: `aigon feature-cleanup <ID> --push` (to save branches) or `aigon feature-cleanup <ID>` (to delete)

## Cross-Agent Code Review (Optional)

After implementation but before completing, you can have a different agent review the code and commit fixes:

1. Agent A implements the feature and commits (using `/aigon-feature-implement`)
2. Agent A stops and tells the user implementation is complete
3. User opens a session with Agent B (ideally a different model)
4. Agent B runs `/aigon-feature-review <ID>` to:
   - Read the spec and implementation log
   - Review `git diff main...HEAD`
   - Make targeted fixes (bugs, security issues, missing edge cases)
   - Commit fixes with `fix(review):` prefix
   - Update the implementation log with review notes
5. User (or Agent A) reviews Agent B's commits
6. User runs `/aigon-feature-done <ID>` to merge

**Benefits**:
- Cross-model review catches different types of issues
- Fix commits are clearly labeled and easy to inspect
- Implementation log documents who reviewed and what was found

**When to use**:
- Critical features where quality matters
- Complex implementations with security implications
- When you want a second opinion before merging

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)