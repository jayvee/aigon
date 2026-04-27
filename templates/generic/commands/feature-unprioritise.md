<!-- description: Move a backlog feature back to inbox (slug filename) -->
# aigon-feature-unprioritise

**CRITICAL:** Use the CLI below. Do not manually move specs out of backlog.

## Step 1: Run

```bash
aigon feature-unprioritise {{ARG_SYNTAX}}
```

`{{ARG_SYNTAX}}` is the numeric feature id (e.g. `42`). The spec moves from `02-backlog/` to `01-inbox/` and the workflow id re-keys to the slug until you `feature-prioritise` again.
