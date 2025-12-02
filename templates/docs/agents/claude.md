<!-- FARLINE_FLOW_START -->
# Claude Code Configuration

## Agent Identity
- **Agent ID**: `cc`
- **Worktree Pattern**: `../feature-NN-cc-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cc-log.md`

## Slash Commands

| Command | Description |
|---------|-------------|
| `/ff-feature-create <name>` | Create a new feature spec |
| `/ff-feature-prioritise <name>` | Prioritize a feature draft |
| `/ff-feature-start <ID>` | Start a feature and create worktree |
| `/ff-feature-implement <ID>` | Switch to worktree and implement |
| `/ff-feature-eval <ID>` | Submit feature for evaluation |
| `/ff-feature-done <ID>` | Complete and merge feature |
| `/ff-research-create <name>` | Create a new research topic |
| `/ff-research-start <ID>` | Start a research topic |
| `/ff-help` | Show all Farline Flow commands |

## Modes

- **Solo mode**: `ff feature-start <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `ff feature-start <ID> cc` - Creates worktree for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `/ff-feature-done` for solo, `/ff-feature-done <ID> cc` for multi-agent

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- FARLINE_FLOW_END -->
