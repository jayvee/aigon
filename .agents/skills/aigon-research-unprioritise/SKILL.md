---
name: aigon-research-unprioritise
description: Move a backlog research topic back to inbox (slug filename)
---

# aigon-research-unprioritise

**CRITICAL:** Use the CLI below. Do not manually move specs out of backlog.

## Step 1: Run

```bash
aigon research-unprioritise $ARGUMENTS
```

`$ARGUMENTS` is the numeric research id. The research topic returns to inbox lifecycle state and the generated view is refreshed. Legacy-layout repos may still move the stage-folder file during the compatibility window.
