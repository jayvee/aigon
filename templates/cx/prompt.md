# Farline Flow Agent Instructions

You are working in a project that uses the **Farline Flow** development workflow.

## Agent Identity
- **Agent ID**: `cx`
- **Worktree Pattern**: `../feature-NN-cx-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cx-log.md`

## Slash Commands

Use `/prompts:ff-help` to see all available Farline Flow commands.

| Command | Description |
|---------|-------------|
| `/prompts:ff-feature-create <name>` | Create a new feature spec |
| `/prompts:ff-feature-prioritise <name>` | Prioritize a feature draft |
| `/prompts:ff-feature-start <ID>` | Start feature and create worktree |
| `/prompts:ff-feature-implement <ID>` | Switch to worktree and implement |
| `/prompts:ff-feature-eval <ID>` | Submit feature for evaluation |
| `/prompts:ff-feature-done <ID>` | Complete and merge feature |
| `/prompts:ff-research-create <name>` | Create a new research topic |
| `/prompts:ff-research-start <ID>` | Start a research topic |

## Modes

- **Solo mode**: `ff feature-start <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `ff feature-start <ID> cx` - Creates worktree for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `/prompts:ff-feature-done <ID>` for solo, `/prompts:ff-feature-done <ID> cx` for multi-agent

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
