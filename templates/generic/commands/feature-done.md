<!-- description: Complete feature <ID> [agent] - merges branch and cleans up -->
# aigon-feature-done

Complete a feature by merging the implementation and cleaning up.

## Before running this command

**Ask the user**: "Do you want to delete the local branch after merge?" (the CLI will delete it by default)

## Usage

### Solo mode (branch or worktree)
If you used `feature-setup {{ARG1_SYNTAX}}` or `feature-setup {{ARG1_SYNTAX}} <agent>`:
```bash
aigon feature-done {{ARG1_SYNTAX}}
```
The command auto-detects whether the feature uses a branch or a solo worktree.

### Arena mode
If you used `feature-setup {{ARG1_SYNTAX}} cc gg cx cu`:
```bash
aigon feature-done {{ARG1_SYNTAX}} <winning-agent>
```

Example: `aigon feature-done {{ARG1_SYNTAX}} cc` to merge Claude's implementation

## What happens

### Solo Mode

1. Pushes the feature branch to origin (to save work remotely)
2. Switches to main/master branch
3. Merges the feature branch with `--no-ff`
4. Moves spec to `05-done/`
5. Moves implementation log to `logs/selected/`
6. Deletes the local feature branch
7. Commits the spec and log moves

### Arena Mode

1. Pushes the winning agent's branch to origin
2. Switches to main/master branch
3. Merges the winning agent's branch with `--no-ff`
4. Moves spec to `05-done/`
5. Organizes logs:
   - Winning agent's log → `logs/selected/`
   - Other agents' logs → `logs/alternatives/`
6. Removes the winning agent's worktree
7. Deletes the winning agent's local branch
8. Commits the changes
9. Shows cleanup options for remaining worktrees/branches

### Cleanup after Arena

After merging the winner, you'll see cleanup options for the losing implementations:

```
{{CMD_PREFIX}}feature-cleanup {{ARG1_SYNTAX}}         # Delete locally
{{CMD_PREFIX}}feature-cleanup {{ARG1_SYNTAX}} --push  # Push to remote first
```

Use `--push` if you want to preserve the alternative implementations on the remote repository.

## Important Notes

- **Solo worktree**: The agent is auto-detected — no need to specify it
- **Arena mode**: The agent parameter is REQUIRED (e.g., `cc`, `gg`, `cx`, `cu`)
- **Do NOT run from a worktree**: Always run from the main repository
- The command uses `--no-ff` merge to preserve feature history
- Alternative implementations are preserved in `logs/alternatives/` for future reference
