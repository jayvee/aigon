<!-- description: Complete feature <ID> [agent] - merges branch and cleans up -->
# ff-feature-done

Complete a feature by merging and cleaning up.

## Before running this command

**Ask the user**: "Do you want to delete the local branch after merge?" (the CLI will delete it by default)

## Run the command

**Solo mode** - if you used `feature-start {{ARG_SYNTAX}}` (no agent):
```bash
ff feature-done {{ARG_SYNTAX}}
```

**Multi-agent mode** - if you used `feature-start {{ARG_SYNTAX}} {{AGENT_ID}}`:
```bash
ff feature-done {{ARG_SYNTAX}} {{AGENT_ID}}
```

## What happens

- **Pushes the feature branch to origin** (to save work remotely)
- Switches to main/master branch
- Merges the feature branch
- Moves spec to `05-done/`
- Moves implementation log to `logs/selected/`
- Deletes the local feature branch
- (Multi-agent only) Removes the worktree and moves other agent logs to `logs/alternatives/`
