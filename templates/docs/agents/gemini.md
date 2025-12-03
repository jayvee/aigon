<!-- AIGON_START -->
# Gemini CLI Configuration

## Agent Identity
- **Agent ID**: `gg`
- **Worktree Pattern**: `../feature-NN-gg-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-gg-log.md`

## Commands

### Solo Mode
| Command | Description |
|---------|-------------|
| `/aigon:feature-create <name>` | Create a new feature spec |
| `/aigon:feature-prioritise <name>` | Prioritize a feature draft |
| `/aigon:feature-implement <ID>` | Implement feature (branch, code, complete) |
| `/aigon:feature-eval <ID>` | Submit feature for evaluation |
| `/aigon:feature-done <ID>` | Complete and merge feature |

### Bakeoff Mode
| Command | Description |
|---------|-------------|
| `/aigon:bakeoff-setup <ID> <agents>` | Create worktrees for multiple agents |
| `/aigon:bakeoff-implement <ID>` | Implement in current worktree |
| `/aigon:bakeoff-cleanup <ID>` | Clean up losing worktrees and branches |

### Research
| Command | Description |
|---------|-------------|
| `/aigon:research-create <name>` | Create a new research topic |
| `/aigon:research-start <ID>` | Start a research topic |
| `/aigon:help` | Show all Aigon commands |

## Modes

- **Solo mode**: `aigon feature-start <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `aigon feature-start <ID> gg` - Creates worktree for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `aigon feature-done <ID>` for solo, `aigon feature-done <ID> gg` for multi-agent

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->
