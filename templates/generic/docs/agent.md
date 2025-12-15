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
| `aigon feature-implement <ID>` | Implement feature (branch, code, complete) |
| `aigon feature-eval <ID>` | Evaluate feature implementations in a bake-off, propose winner |
| `aigon feature-done <ID>` | Complete and merge feature |

### Bakeoff Mode
| Command | Description |
|---------|-------------|
| `aigon bakeoff-setup <ID> <agents>` | Create worktrees for multiple agents to implement feature  |
| `aigon bakeoff-implement <ID>` | Implement feature (branch, code) in current worktree |
| `aigon bakeoff-cleanup <ID> --push` | Clean up losing worktrees and branches |

### Research
| Command | Description |
|---------|-------------|
| `aigon research-create <name>` | Create a new research topic |
| `aigon research-prioritise <name>` | Prioritise a research topic |
| `aigon research-start <ID>` | Start a research topic |
| `aigon research-done <ID>` | Complete research topic |
| `aigon help` | Show all Aigon commands |

## Modes

- **Solo mode**: `aigon feature-implement <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `aigon bakeoff-setup <ID> <agents>` - Creates worktrees for the specified agents for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `aigon feature-done` for solo, `aigon feature-done <ID> {{AGENT_ID}}` for multi-agent

## Solo Mode Workflow

1. Run `aigon feature-implement <ID>` to create branch and move spec
2. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
3. Implement the feature according to the spec
4. Test your changes and wait for user confirmation
5. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
6. Update the implementation log in `./docs/specs/features/logs/`
7. **STOP** - Wait for user to approve before running `aigon feature-done <ID>`

## Bakeoff Mode Workflow

1. Run `aigon bakeoff-setup <ID> cc cx gg` Create worktrees for each agent in the bakeoff
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run  `aigon bakeoff-implement <ID>`
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `aigon feature-eval <ID>`
5. Merge winner: `aigon feature-done <ID> cx`
6. Clean up losers: `aigon bakeoff-cleanup <ID> --push` (to save branches) or `aigon bakeoff-cleanup <ID>` (to delete)

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->
