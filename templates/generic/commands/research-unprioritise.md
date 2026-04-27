<!-- description: Move a backlog research topic back to inbox (slug filename) -->
# aigon-research-unprioritise

**CRITICAL:** Use the CLI below. Do not manually move specs out of backlog.

## Step 1: Run

```bash
aigon research-unprioritise {{ARG_SYNTAX}}
```

`{{ARG_SYNTAX}}` is the numeric research id. The spec moves from `02-backlog/` to `01-inbox/` and the workflow id re-keys to the slug until you `research-prioritise` again.
