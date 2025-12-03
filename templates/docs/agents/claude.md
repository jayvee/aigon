<!-- AIGON_START -->
# Claude Code Configuration

## Agent Identity
- **Agent ID**: `cc`
- **Worktree Pattern**: `../feature-NN-cc-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cc-log.md`

## Slash Commands

### Solo Mode
| Command | Description |
|---------|-------------|
| `/aigon-feature-create <name>` | Create a new feature spec |
| `/aigon-feature-prioritise <name>` | Prioritize a feature draft |
| `/aigon-feature-implement <ID>` | Implement feature (branch, code, complete) |
| `/aigon-feature-eval <ID>` | Submit feature for evaluation |
| `/aigon-feature-done <ID>` | Complete and merge feature |

### Bakeoff Mode
| Command | Description |
|---------|-------------|
| `/aigon-bakeoff-setup <ID> <agents>` | Create worktrees for multiple agents |
| `/aigon-bakeoff-implement <ID>` | Implement in current worktree |
| `/aigon-bakeoff-cleanup <ID>` | Clean up losing worktrees and branches |

### Research
| Command | Description |
|---------|-------------|
| `/aigon-research-create <name>` | Create a new research topic |
| `/aigon-research-start <ID>` | Start a research topic |
| `/aigon-help` | Show all Aigon commands |

## Modes

- **Solo mode**: `aigon feature-start <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `aigon feature-start <ID> cc` - Creates worktree for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `/aigon-feature-done` for solo, `/aigon-feature-done <ID> cc` for multi-agent

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->
