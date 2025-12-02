---
description: Complete feature <ID> [cc] - merges branch and cleans up
---
# ff-feature-done

Complete a feature by merging and cleaning up.

## Before running this command

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user**: "Do you want to delete the local branch after merge?" (the CLI will delete it by default)

## Run the command

**Solo mode** - if you used `feature-start {{args}}` (no agent):
```bash
ff feature-done {{args}}
```

**Multi-agent mode** - if you used `feature-start {{args}} cc`:
```bash
ff feature-done {{args}} cc
```

## What happens

- Switches to main/master branch
- Merges the feature branch
- Moves spec to `05-done/`
- Moves implementation log to `logs/selected/`
- Deletes the local feature branch
- (Multi-agent only) Removes the worktree and moves other agent logs to `logs/alternatives/`
