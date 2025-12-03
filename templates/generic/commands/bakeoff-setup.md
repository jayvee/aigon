<!-- description: Setup bakeoff <ID> <agents...> - create worktrees for multiple agents -->
# aigon-bakeoff-setup

Setup a multi-agent bakeoff by creating isolated worktrees for each agent.

## Step 1: Run the CLI command

IMPORTANT: You MUST include the feature ID AND at least two agent codes.

```bash
aigon feature-start {{ARG_SYNTAX}}
```

Example: `aigon feature-start 55 cc gg cx`

This will:
- Move the spec from backlog to `03-in-progress`
- Commit the spec move so worktrees have access to it
- Create a git worktree for each agent (e.g., `../feature-55-cc-dark-mode`)
- Create implementation logs for each agent

## Step 2: STOP - Do not implement here

**IMPORTANT: Do NOT implement the feature in this session.**

The bakeoff requires each agent to work in isolation in their own worktree. You cannot implement from the main repository.

Tell the user:

---

**Bakeoff worktrees have been created.**

To start each agent's implementation:

1. Open each worktree in a separate VS Code/editor window:
   - `code ../feature-<ID>-cc-*`
   - `code ../feature-<ID>-gg-*`
   - etc.

2. In each window, run `{{CMD_PREFIX}}bakeoff-implement <ID>` to begin implementation

When all agents have finished, return to this main repository and run `{{CMD_PREFIX}}feature-eval <ID>` to compare implementations.

---

**Do NOT proceed with any implementation in this session.**
