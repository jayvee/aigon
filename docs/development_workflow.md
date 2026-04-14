# Development Workflow

This project uses **Aigon**, a spec-driven development workflow for AI agents.

For codebase structure and CLI module boundaries, read `docs/architecture.md`.

## Overview

Aigon enforces a structured **Research → Specification → Implementation** loop:

1. **Research Topics** explore the "why" before building
2. **Feature Specs** define the "what" to build

For feature implementation, Aigon supports multiple execution modes:
1. **Drive mode** — one agent, you guide each stage
2. **Fleet mode** — multiple agents implement in parallel, you evaluate and pick a winner

## Directory Structure

All workflow state lives in `./docs/specs/`. Folders are numbered for visual ordering:

```
docs/specs/
├── research-topics/
│   ├── 01-inbox/        # New research ideas
│   ├── 02-backlog/      # Prioritised research
│   ├── 03-in-progress/  # Active research
│   ├── 04-in-evaluation/# Comparing agent findings
│   ├── 05-done/         # Completed research
│   └── 06-paused/       # On hold
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

### Feature Commands (Unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec |
| `aigon feature-prioritise <name>` | Assign ID and move to backlog |
| `aigon feature-start <ID> [agents...]` | Setup for Drive (no agents) or Fleet (with agents) |
| `aigon feature-do <ID> [--iterate]` | Implement feature; `--iterate` runs Autopilot retry loop |
| `aigon feature-eval <ID>` | Create evaluation (code review for Drive, comparison for Fleet) |
| `aigon feature-push [ID] [agent]` | Push feature branch to origin for PR review |
| `aigon feature-close <ID> [agent]` | Merge and complete (specify agent in Fleet mode) |
| `aigon feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

## Key Rules

1. **Spec-Driven**: Never write code without resolving the active feature spec via `aigon feature-spec <ID>`
2. **Work in isolation**: Solo mode uses branches, arena mode uses worktrees
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **Feature lifecycle is engine-backed**: workflow-core is the authority for features, and visible spec folders are a projection of that state

## Feature State Model

For features, there are two relevant layers:

- The authoritative lifecycle state lives in `.aigon/workflows/features/{id}/` and is managed by `lib/workflow-core/`.
- The visible stage is still the spec folder under `docs/specs/features/`, but that folder is a projection of workflow state, not the authority.
- Active feature discovery should use `{{CMD_PREFIX}}feature-list --active` or workflow snapshot reads, not folder probes.

## Drive Mode Workflow

1. Run `aigon feature-start <ID>` to create branch and move spec to in-progress
2. Run `aigon feature-do <ID>` to begin implementation (add `--iterate` for Autopilot retry loop)
3. Read the spec path returned by `aigon feature-spec <ID>`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `aigon feature-close <ID>`

## Fleet Mode Workflow

1. Run `aigon feature-start <ID> cc gg cx cu` to create worktrees for each agent
2. **STOP** - Tell the user to open each worktree in a separate session
3. In each worktree session:
   - Run `aigon feature-do <ID>`
   - Read the spec path returned by `aigon feature-spec <ID>`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-close` from worktree
4. Return to main repo for evaluation: `aigon feature-eval <ID>`
5. Merge winner: `aigon feature-close <ID> cc`
6. Clean up losers: `aigon feature-cleanup <ID> --push` (to save branches) or `aigon feature-cleanup <ID>` (to delete)

## GitHub PR Workflow (Optional)

When the repo origin is GitHub and the `gh` CLI is installed, `feature-close` is PR-aware:

| PR state | What happens |
|----------|-------------|
| **No PR** | Normal local close — merge branch, clean up |
| **Open PR** | Blocks — merge or close the PR on GitHub first |
| **Draft PR** | Blocks — publish or close the draft first |
| **Merged PR** | Syncs local main from origin and finishes close |

Recommended workflow:

1. After implementation, push the branch: `/aigon:feature-push` (or `aigon feature-push`)
2. Create a PR on GitHub (web UI, `gh pr create`, etc.)
3. Get reviews, iterate, merge the PR
4. Run `/aigon:feature-close` — Aigon detects the merged PR and syncs

If you never push or create a PR, nothing changes — `feature-close` works locally as before.

## Before Completing a Feature

Before running `feature-close`, always:

1. **If you want GitHub PR review, publish the branch**:
   ```
   /aigon:feature-push
   ```
   Or from the CLI: `aigon feature-push`
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
