<!-- description: Show Aigon commands -->
# Aigon Commands

## Solo Mode (single agent)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feature-create <name>` | Create a new feature spec |
| `{{CMD_PREFIX}}feature-prioritise <name>` | Prioritize a feature draft |
| `{{CMD_PREFIX}}feature-implement <ID>` | Implement feature (branch, code, complete) |
| `{{CMD_PREFIX}}feature-eval <ID>` | Submit feature for evaluation |
| `{{CMD_PREFIX}}feature-done <ID>` | Complete and merge feature |

## Bakeoff Mode (multi-agent)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}bakeoff-setup <ID> <agents...>` | Create worktrees for multiple agents |
| `{{CMD_PREFIX}}bakeoff-implement <ID>` | Implement in current worktree (run in each worktree) |
| `{{CMD_PREFIX}}bakeoff-cleanup <ID>` | Clean up losing worktrees and branches after evaluation |

## Research

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritize a research topic |
| `{{CMD_PREFIX}}research-start <ID>` | Start a research topic |
| `{{CMD_PREFIX}}research-done <ID>` | Complete a research topic |

Run `aigon help` in terminal for full CLI reference.
