---
description: Complete feature <ID> [cc] - merges branch and cleans up
---
# ff-feature-done

Run this command followed by the Feature ID.

## Modes

**Solo mode** - if you used `ff feature-start {{args}}` (no agent):
```
ff feature-done {{args}}
```

**Multi-agent mode** - if you used `ff feature-start {{args}} cc`:
```
ff feature-done {{args}} cc
```

## What happens

- Moves spec to `05-done/`
- Merges the feature branch to main
- Moves implementation log to `logs/selected/`
- (Multi-agent only) Removes the worktree and moves other agent logs to `logs/alternatives/`