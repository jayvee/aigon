<!-- description: Move a backlog feature back to inbox (slug filename) -->
# aigon-feature-unprioritise

**CRITICAL:** Use the CLI below. Do not manually move specs out of backlog.

## Step 1: Run

```bash
aigon feature-unprioritise {{ARG_SYNTAX}}
```

`{{ARG_SYNTAX}}` is the numeric feature id (e.g. `42`). The feature returns to inbox lifecycle state and the generated view is refreshed. Legacy-layout repos may still move the stage-folder file during the compatibility window.
