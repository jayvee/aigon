<!-- description: Show Aigon commands -->
# Aigon Commands

## Feature Commands (unified for solo and arena modes)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feature-create <name>` | Create a new feature spec |
| `{{CMD_PREFIX}}feature-now <name>` | Fast-track: inbox → prioritise → setup → implement, or create new + implement |
| `{{CMD_PREFIX}}feature-prioritise <name>` | Assign ID and move to backlog |
| `{{CMD_PREFIX}}feature-setup <ID> [agents...]` | Setup for solo (branch) or arena (worktrees) |
| `{{CMD_PREFIX}}feature-implement <ID>` | Implement feature in current branch/worktree |
| `{{CMD_PREFIX}}feature-submit` | Commit changes, write log, signal done for evaluation |
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
| `{{CMD_PREFIX}}research-open <ID>` | Open all arena agents side-by-side for parallel research |
| `{{CMD_PREFIX}}research-conduct <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-done <ID>` | Complete a research topic |

## Feedback

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feedback-create <title>` | Create feedback item in inbox with next ID |
| `{{CMD_PREFIX}}feedback-list [filters]` | List feedback items with status/type/severity/tag filters |
| `{{CMD_PREFIX}}feedback-triage <ID>` | Run triage preview and apply with explicit confirmation |

## CLI Commands (run in terminal)

| Command | Description |
|---------|-------------|
| `aigon config init` | Create global config at `~/.aigon/config.json` |

### Agent CLI Mappings (used by worktree-open)

| Code | Agent | Command | Mode |
|------|-------|---------|------|
| cc | Claude Code | `claude --permission-mode acceptEdits` | Auto-edits, prompts for risky Bash |
| cu | Cursor | `agent --force` | Auto-approves commands (yolo mode) |
| gg | Gemini | `gemini --yolo` | Auto-approves all |
| cx | Codex | `codex --full-auto` | Workspace-write, smart approval |

**Quick-allow when prompted:** Claude `Shift+Tab` • Gemini `2` for always • Cursor "Add to allowlist" • Codex "Allow and remember"

**Override defaults:** Set `agents.{id}.implementFlag` in `~/.aigon/config.json` to use stricter permissions (e.g., `""` to require manual approval). Project config (`.aigon/config.json`) takes precedence over global config.

Run `aigon help` in terminal for full CLI reference.
