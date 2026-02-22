<!-- AIGON_START -->
# {{AGENT_TITLE}}

## Agent Identity
- **Agent ID**: `{{AGENT_ID}}`
- **Worktree Pattern**: `../feature-NN-{{AGENT_ID}}-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-{{AGENT_ID}}-log.md`

## Commands

### Feature Commands (unified for solo and arena modes)
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

### Research Commands (unified for solo and arena modes)
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritise a research topic |
| `{{CMD_PREFIX}}research-setup <ID> [agents...]` | Setup for solo or arena research |
| `{{CMD_PREFIX}}research-open <ID>` | Open all arena agents side-by-side for parallel research |
| `{{CMD_PREFIX}}research-conduct <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-done <ID>` | Complete research topic |

### Feedback Commands
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feedback-create <title>` | Create a feedback item in inbox |
| `{{CMD_PREFIX}}feedback-list [filters]` | List feedback by status/type/severity/tag |
| `{{CMD_PREFIX}}feedback-triage <ID>` | Triage feedback with explicit apply confirmation |

### Utility Commands
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}help` | Show all Aigon commands |

## Modes

- **Solo mode**: `{{CMD_PREFIX}}feature-setup <ID>` - Creates branch only, work in current directory
- **Arena mode**: `{{CMD_PREFIX}}feature-setup <ID> <agents...>` - Creates worktrees for parallel implementation

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, arena mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `{{CMD_PREFIX}}feature-done <ID>` for solo, `{{CMD_PREFIX}}feature-done <ID> {{AGENT_ID}}` for arena
5. **Follow project instructions**: Check `AGENTS.md` for shared project build, test, and dependency commands

## Solo Mode Workflow

1. Run `{{CMD_PREFIX}}feature-setup <ID>` to create branch and move spec
2. Run `{{CMD_PREFIX}}feature-implement <ID>` to begin implementation
3. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `{{CMD_PREFIX}}feature-done <ID>`

## Arena Mode Workflow

1. Run `{{CMD_PREFIX}}feature-setup <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `{{CMD_PREFIX}}feature-implement <ID>`
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `{{CMD_PREFIX}}feature-eval <ID>`
5. Merge winner: `{{CMD_PREFIX}}feature-done <ID> cx`
6. Clean up losers: `{{CMD_PREFIX}}feature-cleanup <ID> --push` (to save branches) or `{{CMD_PREFIX}}feature-cleanup <ID>` (to delete)

{{PERMISSION_SAVE_NOTE}}
## Before Completing a Feature

Before running `{{CMD_PREFIX}}feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->
