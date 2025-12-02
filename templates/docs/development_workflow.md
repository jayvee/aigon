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

| Command | Description |
|---------|-------------|
| `ff init` | Initialize the specs directory structure |
| `ff feature-prioritise <name>` | Move feature from inbox to backlog, assign ID |
| `ff feature-start <ID> <agent>` | Start feature, create worktree |
| `ff feature-eval <ID>` | Submit feature for evaluation |
| `ff feature-done <ID> <agent>` | Merge feature, cleanup worktree |
| `ff research-prioritise <name>` | Move research from inbox to backlog |
| `ff research-start <ID>` | Start research topic |
| `ff research-done <ID>` | Complete research topic |

## Key Rules

1. **Spec-Driven**: Never write code without a spec in `features/03-in-progress/`
2. **Worktree Isolation**: All code changes happen in worktrees, not the main repo
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **State-as-Location**: A task's status is determined by which folder it's in

## Multi-Agent Bake-offs

Multiple agents can compete on the same feature:

```bash
ff feature-start 55 cc   # Claude's worktree: ../feature-55-cc-description
ff feature-start 55 gg   # Gemini's worktree: ../feature-55-gg-description
```

After review, merge the winner and archive alternatives:

```bash
ff feature-done 55 cc    # Merge Claude's work, archive Gemini's log
ff cleanup 55            # Remove remaining worktrees
```
