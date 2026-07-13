---
name: aigon-feature-start
description: Start feature <ID> [agents...] - create workspace and begin implementation
---

# aigon-feature-start

Prepare your workspace to implement a feature in Drive or Fleet mode.

**CRITICAL:** Use the CLI command below. Do NOT manually move spec files, lifecycle-view links, create branches, or create worktrees — the CLI records the workflow transition and prepares branch/worktree state.

## Argument Resolution
If no ID is provided or doesn't match a backlog entry, list `./docs/specs/features/02-backlog/feature-*.md`, filter to matches, and ask the user to choose.

## Step 1: Run the CLI

**Pass EXACTLY the args the user provided. Do NOT add agents that weren't specified.**

```bash
# Drive mode (branch in current repo) — ID only
aigon feature-start $1

# Drive worktree mode (parallel development) — ID + 1 agent
aigon feature-start $1 <agent>

# Fleet mode (competition) — ID + 2+ agents
aigon feature-start $1 <agent1> <agent2> [agent3...]
```

Mode is determined by arg count (0 / 1 / 2+ agents). The CLI transitions the feature from backlog to in-progress, refreshes the generated lifecycle view (stable layout), creates branch or worktree(s), and creates implementation log(s).

If the CLI reports errors while recording or publishing the workflow transition, resolve them before proceeding.

## Step 2: Confirm setup and next steps

`feature-start` creates the workspace AND opens agent terminals automatically — there is no separate "open" step.

- **Drive mode (branch):** you end up on the feature branch in your current terminal. Start implementation manually with `aigon-feature-do <ID>`. Close with `aigon-feature-close <ID>` when done.
- **Drive worktree:** agent terminal is already running. Wait for submit, then `aigon-feature-close <ID>` from the main repo.
- **Fleet:** all agent terminals are running and implementing. Wait for all to submit, then `aigon-feature-eval <ID>`.
- **Re-open a crashed session:** `aigon-feature-open <ID>` (or `aigon-feature-open <ID> <agent>` for a specific Fleet agent).

Worktrees are created in `../<repo>-worktrees/` to keep them grouped with the project.

## Prompt Suggestion

End your response with the next command on its own line:
- **Drive (branch, solo):** `aigon-feature-do <ID>`
- **Drive worktree:** `aigon-feature-close <ID>` (agent is already running in its terminal)
- **Fleet:** `aigon-feature-eval <ID>`
