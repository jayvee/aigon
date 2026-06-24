# Development Workflow

This project uses **Aigon**, a spec-driven development workflow for AI agents.

For grouping features into delivery units, read `.aigon/docs/feature-sets.md`.

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

### Customer feedback → research

Customer and user feedback is captured as **research**, not a separate lifecycle. Use `aigon research-create` and set optional frontmatter when the input came from a user or customer:

- `origin: customer-feedback` — distinguishes user voice from agent-initiated investigation
- `reporter` / `source` — who reported it and where it came from (channel, reference, optional url)
- `feedback_refs` — stable refs when migrating legacy `docs/specs/feedback/**` files

Research may recommend zero or more features via its `## Output` section. The old `docs/specs/feedback/` tree and `aigon feedback-*` commands are **legacy**; run `aigon feedback-migrate` (or `aigon doctor --fix`) to convert existing feedback files without duplicating research specs.

### Feature Commands (Unified for Solo and Arena modes)
| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec |
| `aigon feature-prioritise <name>` | Assign ID and move to backlog |
| `aigon feature-spec-review <ID>` | Pre-implementation review of the spec itself |
| `aigon feature-start <ID> [agents...]` | Setup for solo (no agents) or arena (with agents) |
| `aigon feature-do <ID> [--iterate]` | Implement feature; `--iterate` runs Autopilot retry loop |
| `aigon feature-status <ID>` | Deep status: session, progress, cost, spec criteria |
| `aigon feature-eval <ID>` | Create evaluation (code review for solo, comparison for arena) |
| `aigon feature-code-review <ID>` | Post-implementation code review with fixes by a different agent |
| `aigon feature-cancel-code-review <ID>` | Cancel an in-progress code review, stop the reviewer session, and return the feature to `ready` |
| `aigon feature-code-revise [ID]` | Implementer-side follow-up after a code review |
| `aigon feature-autonomous-stop <ID>` | Stop the AutoConductor and take over manually from the current workflow state |
| `aigon feature-push [ID] [agent]` | Push the feature branch to `origin` for PR review |
| `aigon feature-close <ID> [agent]` | Merge and complete (specify agent in arena mode) |
| `aigon feature-cleanup <ID>` | Clean up arena worktrees and branches |
| `aigon feature-reset <ID>` | Full reset back to backlog (sessions + worktrees + branches + state + spec move) |

## Key Rules

1. **Spec-Driven**: Never write code without resolving the active feature spec via `aigon feature-spec <ID>`
2. **Work in isolation**: Solo mode uses branches, arena mode uses worktrees
3. **Implementation Logs**: Document implementation decisions in `logs/` before completing
4. **Feature lifecycle is engine-backed**: Aigon's workflow engine is the authority for features, and visible spec folders are a projection of that state
5. **Spec creation**: never write spec files directly to `docs/specs/` — always use `aigon feature-create <name>`. Direct writes produce snapshotless specs that appear on the board but cannot be started, tracked, or closed correctly.

## Feature State Model

For features, there are two relevant layers:

- The authoritative lifecycle state lives in `.aigon/workflows/features/{id}/` and is managed by Aigon's workflow engine.
- The visible stage is still the spec folder under `docs/specs/features/`, but that folder is a projection of workflow state, not the authority.
- Active feature discovery should use `{{CMD_PREFIX}}feature-list --active` or workflow snapshot reads, not folder probes.

## Review Recovery

When a solo feature is under code review and the current run has gone bad, there are now two explicit recovery tools:

- `aigon feature-autonomous-stop <ID>` stops the AutoConductor and leaves the feature in its current workflow state so you can drive it manually.
- `aigon feature-cancel-code-review <ID>` cancels an in-progress code review, kills the reviewer session, and returns the feature to `ready`.

Typical recovery flow:

1. Stop autonomy if the feature is still under autonomous orchestration.
2. Cancel the bad review.
3. Re-run `aigon feature-code-review <ID>` with a different reviewer or model.

## Solo Mode Workflow

1. Run `aigon feature-start <ID>` to create branch and move spec to in-progress
2. Run `aigon feature-do <ID>` to begin implementation (add `--iterate` for Autopilot retry loop)
3. Read the spec path returned by `aigon feature-spec <ID>`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `aigon feature-close <ID>`

<!-- AIGON_LIGHT_OPTIONAL_START -->
## Arena Mode Workflow

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
<!-- AIGON_LIGHT_OPTIONAL_END -->

## Per-worktree setup (`worktreeSetup`)

Worktrees are fresh checkouts — they do not share dependency directories, virtualenvs, or any other build artefacts with the main repo. If your agents need those to exist before they start work, declare a setup command in `.aigon/config.json`:

```json
{ "worktreeSetup": "<your repo setup command>" }
```

or (faster, when your stack tolerates it):

```json
{ "worktreeSetup": "<your faster local setup command>" }
```

**When it runs:** after `git worktree add` writes `.env.local`, before the agent launches. One execution per worktree.

**Where to set it:** `.aigon/config.json` (project scope). Use `&&` to compose multiple commands on one line.

**Failure semantics:** runs with a 120-second timeout. Failure warns and continues — the agent still launches.

**Anti-pattern:** Aigon does not detect or guess your stack. There is no built-in `pnpm`/`yarn`/`bun`/`pip`/`cargo` fallback — if you need per-worktree setup, declare it via `worktreeSetup`.

## Before Completing a Feature

Before running `feature-close`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
