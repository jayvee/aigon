<!-- FARLINE_FLOW_START -->
# Codex Configuration

## Agent Identity
- **Agent ID**: `cx`
- **Worktree Pattern**: `../feature-NN-cx-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cx-log.md`

## Commands

| Command | Description |
|---------|-------------|
| `ff feature-start <ID> cx` | Start a feature and create worktree |
| `ff feature-eval <ID>` | Submit feature for evaluation |
| `ff feature-done <ID> cx` | Complete and merge feature |
| `ff feature-prioritise <name>` | Prioritize a feature draft |
| `ff research-start <ID>` | Start a research topic |

## Feature Implement

After starting a feature, switch to the worktree and implement:

1. Find the directory named `../feature-<ID>-cx-*` (ignore the suffix)
2. Switch your working directory to that folder using `cd`
3. Read the spec in `./docs/specs/features/03-in-progress/`
4. Implement the feature according to the spec and commit your changes

## Modes

- **Solo mode**: `ff feature-start <ID>` - Creates branch only, work in current directory
- **Multi-agent mode**: `ff feature-start <ID> cx` - Creates worktree for bake-offs

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `ff feature-done <ID>` for solo, `ff feature-done <ID> cx` for multi-agent

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- FARLINE_FLOW_END -->
