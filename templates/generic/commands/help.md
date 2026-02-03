<!-- description: Show Aigon commands -->
# Aigon Commands

## Feature Commands (unified for solo and arena modes)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feature-create <name>` | Create a new feature spec |
| `{{CMD_PREFIX}}feature-prioritise <name>` | Assign ID and move to backlog |
| `{{CMD_PREFIX}}feature-setup <ID> [agents...]` | Setup for solo (branch) or arena (worktrees) |
| `{{CMD_PREFIX}}feature-implement <ID>` | Implement feature in current branch/worktree |
| `{{CMD_PREFIX}}feature-eval <ID>` | Create evaluation (code review or comparison) |
| `{{CMD_PREFIX}}feature-review <ID>` | Code review with fixes by a different agent |
| `{{CMD_PREFIX}}feature-done <ID> [agent]` | Merge and complete feature |
| `{{CMD_PREFIX}}feature-cleanup <ID>` | Clean up arena worktrees and branches |

## Research (unified for solo and arena modes)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritise a research topic |
| `{{CMD_PREFIX}}research-setup <ID> [agents...]` | Setup for solo or arena research |
| `{{CMD_PREFIX}}research-conduct <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-done <ID>` | Complete a research topic |

Run `aigon help` in terminal for full CLI reference.
