<!-- description: Manage saved workflow definitions -->
# aigon-workflow

Manage saved workflow definitions that can be reused by `feature-start` and `feature-autonomous-start`.

## Commands

```bash
# Create a project workflow interactively or with flags
aigon workflow create <slug>
aigon workflow create <slug> --agents cc,gg --eval-agent gg --stop-after eval

# Save globally instead of in the current repo
aigon workflow create <slug> --global --agents cc --review-agent gg

# Inspect available workflows
aigon workflow list
aigon workflow show <slug>

# Delete a saved workflow
aigon workflow delete <slug>
aigon workflow delete <slug> --global
```

## Notes

- Definitions are resolved with precedence: built-in < global < project.
- Built-in workflows (`solo`, `solo-reviewed`, `arena`, `fleet`) are always available and read-only.
- `feature-start --workflow <slug>` uses the saved agent list.
- `feature-autonomous-start --workflow <slug>` uses saved agents plus any saved `eval-agent`, `review-agent`, and `stop-after` values.
- Explicit CLI agents/flags override the workflow definition for that run.
