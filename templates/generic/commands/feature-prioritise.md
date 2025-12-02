<!-- description: Prioritize feature <name> - assigns ID, moves to backlog -->
# ff-feature-prioritise

Run this command followed by the feature name.

```bash
ff feature-prioritise {{ARG_SYNTAX}}
```

This assigns an ID to the feature and moves it from `01-inbox/` to `02-backlog/`.

Next step:
- **Solo mode**: `ff feature-start <ID>` (branch only)
- **Multi-agent mode**: `ff feature-start <ID> {{AGENT_ID}}` (worktree)
