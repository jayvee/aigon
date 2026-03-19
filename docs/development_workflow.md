# Development Workflow

This project uses **Aigon**, a spec-driven development workflow for AI agents.

For codebase structure and CLI module boundaries, read `docs/architecture.md`.

## Overview

Aigon enforces a structured **Research → Specification → Implementation** loop:

1. **Research Topics** explore the "why" before building
2. **Feature Specs** define the "what" to build

For feature implementation, Aigon supports three modes:
1. **Drive (branch)** — single agent works on a branch in the main repo (CLI-only)
2. **Drive (worktree)** — single agent works in an isolated worktree
3. **Fleet** — multiple agents compete in separate worktrees, then an evaluator picks a winner

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
│   ├── 06-paused/       # On hold / archived
│   ├── logs/            # Implementation logs
│   │   ├── selected/    # Winning agent logs
│   │   └── alternatives/# Other agent attempts
│   └── evaluations/     # LLM Judge reports
├── feedback/
│   ├── 01-inbox/        # New feedback items
│   ├── 02-triaged/      # Assessed feedback
│   ├── 03-actionable/   # Ready to action
│   ├── 04-done/         # Resolved
│   ├── 05-wont-fix/     # Declined
│   └── 06-duplicate/    # Duplicates
├── templates/           # Spec templates
└── README.md
```

### Feature Commands
| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec in inbox |
| `aigon feature-prioritise <name>` | Assign ID and move to backlog |
| `aigon feature-setup <ID> [agents...]` | Setup: no agents = branch, 1 = drive worktree, 2+ = fleet |
| `aigon feature-do <ID>` | Implement the feature (run from worktree or branch) |
| `aigon feature-submit` | Signal implementation complete |
| `aigon feature-eval <ID>` | Run evaluation (code review for solo, comparison for fleet) |
| `aigon feature-review <ID>` | Code review by a different agent |
| `aigon feature-close <ID> [agent]` | Merge and complete (specify agent in fleet mode) |
| `aigon feature-pause <ID or name>` | Move to paused (works for inbox items without IDs) |
| `aigon feature-resume <ID or name>` | Move back from paused |
| `aigon feature-cleanup <ID>` | Clean up fleet worktrees and branches |
| `aigon feature-open <ID>` | Open worktree in terminal with agent |
| `aigon feature-now <name>` | Fast-track: create + prioritise + setup in one step |

## Key Rules

1. **Spec-Driven**: Never write code without a spec in `features/03-in-progress/`
2. **Work in isolation**: Drive branch uses branches, worktree/fleet uses worktrees
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **State-as-Location**: A task's status is determined by which folder it's in

## Drive Mode (Branch) — CLI Only

1. `aigon feature-setup <ID>` — creates branch, no worktree
2. `/aigon:feature-do <ID>` — implement on the branch
3. `aigon feature-close <ID>` — auto-commits, merges to main, deletes branch

## Drive Mode (Worktree) — Dashboard or CLI

1. `aigon feature-setup <ID> <agent>` — creates worktree for one agent
2. Agent implements in the worktree via `/aigon:feature-do <ID>`
3. Optional: `/aigon:feature-review <ID>` — different agent reviews the code
4. `aigon feature-close <ID>` — merges worktree to main, cleans up

## Fleet Mode — Dashboard or CLI

1. `aigon feature-setup <ID> cc gg` — creates worktrees for each agent
2. Each agent implements independently
3. `aigon feature-eval <ID>` — evaluator compares implementations
4. `aigon feature-close <ID> <winner>` — merges winner, optionally adopts from losers
5. `aigon feature-cleanup <ID>` — removes remaining worktrees

## Dashboard

The Aigon Dashboard (`aigon dashboard`) provides a visual Kanban board for managing features, research, and feedback across multiple repos.

### Dashboard Features
- **Pipeline view**: Kanban board with drag-and-drop between stages
- **Monitor view**: Real-time agent status across all repos
- **Sessions view**: Active tmux sessions
- **Console**: Action history with copy-to-clipboard
- **Paused column**: Toggle visibility for archived items
- **Create features**: Create specs with optional agent-assisted refinement
- **Agent picker**: Choose agents for setup, eval, and review
- **Close & merge modal**: Pick winner and adopt changes from fleet agents

### Dashboard Actions
- Drag features between columns to transition states
- Click "Start feature" to setup with agent picker
- Click "Run Evaluation" / "Run Review" to spawn agent sessions
- Click "Close & Merge" when winner is picked
- Click "Show Paused" to toggle the paused column
- Click "+ New Feature" to create a feature with agent refinement

## Before Completing a Feature

The `feature-close` command handles merging automatically:
- Pushes the feature branch to origin (best-effort)
- Switches to main and merges with `--no-ff`
- Moves spec to `05-done/` and organises logs
- Deletes the local feature branch
