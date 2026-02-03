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
| `{{CMD_PREFIX}}worktree-open [ID] [agent]` | Open worktree in Warp with agent CLI |

## Research (unified for solo and arena modes)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritise a research topic |
| `{{CMD_PREFIX}}research-setup <ID> [agents...]` | Setup for solo or arena research |
| `{{CMD_PREFIX}}research-conduct <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-done <ID>` | Complete a research topic |

## CLI Commands (run in terminal)

| Command | Description |
|---------|-------------|
| `aigon config init` | Create global config at `~/.aigon/config.json` |

### Agent CLI Mappings (used by worktree-open)

| Code | Agent | Command | Auto-approve flag |
|------|-------|---------|-------------------|
| cc | Claude Code | `claude --dangerously-skip-permissions` | Bypasses all permissions |
| cu | Cursor | `agent --force` | Force allows commands |
| gg | Gemini | `gemini --yolo` | YOLO mode |
| cx | Codex | `codex --full-auto` | Sandboxed auto-execution |

Run `aigon help` in terminal for full CLI reference.
