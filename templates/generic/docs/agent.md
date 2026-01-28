<!-- AIGON_START -->
# {{AGENT_TITLE}}

## Agent Identity
- **Agent ID**: `{{AGENT_ID}}`
- **Worktree Pattern**: `../feature-NN-{{AGENT_ID}}-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-{{AGENT_ID}}-log.md`

## CLI Commands

### Solo Mode
| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec |
| `aigon feature-prioritise <name>` | Prioritise a feature draft |
| `aigon feature-setup <ID>` | Setup feature branch |
| `aigon feature-implement <ID>` | Implement feature |
| `aigon feature-eval <ID>` | Create code review checklist |
| `aigon feature-done <ID>` | Complete and merge feature |

### Arena Mode
| Command | Description |
|---------|-------------|
| `aigon feature-setup <ID> <agents...>` | Create worktrees for multiple agents |
| `aigon feature-implement <ID>` | Implement feature in current worktree |
| `aigon feature-eval <ID>` | Compare implementations, propose winner |
| `aigon feature-done <ID> <agent>` | Merge winning agent's implementation |
| `aigon feature-cleanup <ID> [--push]` | Clean up losing worktrees and branches |

### Research
| Command | Description |
|---------|-------------|
| `aigon research-create <name>` | Create a new research topic |
| `aigon research-prioritise <name>` | Prioritise a research topic |
| `aigon research-setup <ID> [agents...]` | Setup for solo or arena research |
| `aigon research-conduct <ID>` | Conduct research (write findings) |
| `aigon research-done <ID>` | Complete research topic |
| `aigon help` | Show all Aigon commands |

## Modes

- **Solo mode**: `aigon feature-setup <ID>` - Creates branch only, work in current directory
- **Arena mode**: `aigon feature-setup <ID> <agents...>` - Creates worktrees for parallel implementation

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, arena mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `aigon feature-done` for solo, `aigon feature-done <ID> {{AGENT_ID}}` for arena

## Solo Mode Workflow

1. Run `aigon feature-setup <ID>` to create branch and move spec
2. Run `aigon feature-implement <ID>` to begin implementation
3. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `aigon feature-done <ID>`

## Arena Mode Workflow

1. Run `aigon feature-setup <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `aigon feature-implement <ID>`
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `aigon feature-eval <ID>`
5. Merge winner: `aigon feature-done <ID> cx`
6. Clean up losers: `aigon feature-cleanup <ID> --push` (to save branches) or `aigon feature-cleanup <ID>` (to delete)

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->
