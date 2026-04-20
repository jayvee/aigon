<!-- description: Start feature <ID> [agents...] - create workspace and begin implementation -->
# aigon-feature-start

Prepare your workspace to implement a feature in Drive or Fleet mode.

**CRITICAL:** Use the CLI command below. Do NOT manually move spec files, create branches, or create worktrees — the CLI commits the spec move before creating worktrees, which is essential for worktree modes.

## Argument Resolution
If no ID is provided or doesn't match a backlog entry, list `./docs/specs/features/02-backlog/feature-*.md`, filter to matches, and ask the user to choose.

## Step 1: Run the CLI

**Pass EXACTLY the args the user provided. Do NOT add agents that weren't specified.**

```bash
# Drive mode (branch in current repo) — ID only
aigon feature-start {{ARG1_SYNTAX}}

# Drive worktree mode (parallel development) — ID + 1 agent
aigon feature-start {{ARG1_SYNTAX}} <agent>

# Fleet mode (competition) — ID + 2+ agents
aigon feature-start {{ARG1_SYNTAX}} <agent1> <agent2> [agent3...]
```

Mode is determined by arg count (0 / 1 / 2+ agents). The CLI moves the spec from `02-backlog` to `03-in-progress`, commits the move (so worktrees inherit it), creates branch or worktree(s), and creates implementation log(s).{{SETUP_ENV_LOCAL_LINE}}

If the CLI reports errors about committing the spec move, resolve them before proceeding.

## Step 2: Confirm setup and next steps

`feature-start` creates the workspace AND opens agent terminals automatically — there is no separate "open" step.

- **Drive mode (branch):** you end up on the feature branch in your current terminal. Start implementation manually with `{{CMD_PREFIX}}feature-do <ID>`. Close with `{{CMD_PREFIX}}feature-close <ID>` when done.
- **Drive worktree:** agent terminal is already running. Wait for submit, then `{{CMD_PREFIX}}feature-close <ID>` from the main repo.
- **Fleet:** all agent terminals are running and implementing. Wait for all to submit, then `{{CMD_PREFIX}}feature-eval <ID>`.
- **Re-open a crashed session:** `{{CMD_PREFIX}}feature-open <ID>` (or `{{CMD_PREFIX}}feature-open <ID> <agent>` for a specific Fleet agent).

Worktrees are created in `../<repo>-worktrees/` to keep them grouped with the project.

## Prompt Suggestion

End your response with the next command on its own line:
- **Drive / Drive worktree:** `{{CMD_PREFIX}}feature-close <ID>`
- **Fleet:** `{{CMD_PREFIX}}feature-eval <ID>`
