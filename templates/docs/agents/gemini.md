<!-- FARLINE_FLOW_START -->
# Gemini CLI Configuration

## Agent Identity
- **Agent ID**: `gg`
- **Worktree Pattern**: `../feature-NN-gg-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-gg-log.md`

## Commands

| Command | Description |
|---------|-------------|
| `/feature-create <name>` | Create a new feature spec |
| `/feature-prioritise <name>` | Prioritize a feature draft |
| `/feature-start <ID>` | Start a feature and create worktree |
| `/feature-implement <ID>` | Switch to worktree and implement |
| `/feature-eval <ID>` | Submit feature for evaluation |
| `/feature-done <ID>` | Complete and merge feature |
| `/research-create <name>` | Create a new research topic |
| `/research-start <ID>` | Start a research topic |

## Modes

- **Solo mode**: `ff feature-start <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `ff feature-start <ID> gg` - Creates worktree for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `ff feature-done <ID>` for solo, `ff feature-done <ID> gg` for multi-agent

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- FARLINE_FLOW_END -->
