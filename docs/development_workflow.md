# Development Workflow

This project uses **Farline Flow**, a spec-driven development workflow for AI agents.

## Overview

Farline Flow enforces a structured **Research → Specification → Implementation** loop:

1. **Research Topics** explore the "why" before building
2. **Feature Specs** define the "what" to build
3. **Worktrees** isolate the "how" (implementation)

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

## Workflow Commands

### Solo Mode (single agent)

| Command | Description |
|---------|-------------|
| `ff init` | Initialize the specs directory structure |
| `ff feature-create <name>` | Create feature spec in inbox |
| `ff feature-prioritise <name>` | Move feature from inbox to backlog, assign ID |
| `ff feature-start <ID>` | Start feature (creates branch, moves spec to in-progress) |
| `ff feature-eval <ID>` | Submit feature for evaluation |
| `ff feature-done <ID>` | Merge feature branch and complete |

### Bakeoff Mode (multi-agent)

| Command | Description |
|---------|-------------|
| `ff feature-start <ID> <agents...>` | Setup bakeoff with multiple agents (creates worktrees) |
| `ff feature-eval <ID>` | Submit feature for evaluation |
| `ff feature-done <ID> <agent>` | Merge winning agent's branch, cleanup |
| `ff cleanup <ID>` | Remove remaining worktrees |

### Research

| Command | Description |
|---------|-------------|
| `ff research-create <name>` | Create research topic in inbox |
| `ff research-prioritise <name>` | Move research from inbox to backlog |
| `ff research-start <ID>` | Start research topic |
| `ff research-done <ID>` | Complete research topic |

## Key Rules

1. **Spec-Driven**: Never write code without a spec in `features/03-in-progress/`
2. **Worktree Isolation**: All code changes happen in worktrees, not the main repo
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **State-as-Location**: A task's status is determined by which folder it's in
5. **Research-as-Document**: Unlike features which have separate logs, research findings are written directly into the research topic file itself.

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will handle the merge and cleanup)

## Multi-Agent Bake-offs

Multiple agents can compete on the same feature using a single setup command:

```bash
# Setup bakeoff with multiple agents at once
ff feature-start 55 cc gg cx
```

This creates:
- `../feature-55-cc-description` (Claude's worktree)
- `../feature-55-gg-description` (Gemini's worktree)
- `../feature-55-cx-description` (Codex's worktree)

Each agent implements in their isolated worktree using `/ff-bakeoff-implement <ID>`.

After all agents complete, evaluate and merge the winner:

```bash
ff feature-eval 55       # Compare implementations
ff feature-done 55 cc    # Merge Claude's work, archive others' logs
ff cleanup 55            # Remove remaining worktrees
```
