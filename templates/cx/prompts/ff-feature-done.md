---
description: Complete feature <ID> [agent] - merges branch and cleans up
args: feature_id [agent]
---
# ff-feature-done

Run this command followed by the Feature ID.

## Modes

**Solo mode** - if you used `ff feature-start $1` (no agent):
```
ff feature-done $ARGUMENTS
```

**Multi-agent mode** - if you used `ff feature-start $1 cx`:
```
ff feature-done $1 cx
```

## What happens

- **Pushes the feature branch to origin** (to save work remotely)
- Switches to main/master branch
- Merges the feature branch
- Moves spec to `05-done/`
- Moves implementation log to `logs/selected/`
- Deletes the local feature branch
- (Multi-agent only) Removes the worktree and moves other agent logs to `logs/alternatives/`
