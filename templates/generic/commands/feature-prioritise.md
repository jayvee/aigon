<!-- description: Prioritise feature <name> - assigns ID, moves to backlog -->
# aigon-feature-prioritise

Run this command followed by the feature name.

```bash
aigon feature-prioritise {{ARG_SYNTAX}}
```

This assigns an ID to the feature and moves it from `01-inbox/` to `02-backlog/`.

Next step:
- **Solo mode**: `aigon feature-implement <ID>` (branch only)
- **Multi-agent mode**: 
-- `aigon bakeoff-setup <ID> <agents>` (in worktree)
-- `aigon bakeoff-implement <ID>` (in worktree)
