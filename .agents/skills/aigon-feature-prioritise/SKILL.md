---
name: aigon-feature-prioritise
description: Prioritise feature <name> - assigns ID, moves to backlog
---

# aigon-feature-prioritise

**CRITICAL:** You MUST use the CLI command below to prioritise. Do NOT manually rename or move spec files — the CLI handles ID assignment and file moves.

## Argument Resolution

If no name is provided, or the name doesn't match an existing feature in the inbox:
1. List all files in `./docs/specs/features/01-inbox/` matching `feature-*.md`
2. If a partial name was given, filter to files containing that text
3. Present the matching features and ask the user to choose one

## Step 1: Run the CLI command

```bash
aigon feature-prioritise $ARGUMENTS
```

This assigns an ID to the feature and moves it from `01-inbox/` to `02-backlog/`.

## Step 2: Next steps

Choose your mode:

**Drive (branch)** — work in the current repo:
```
$aigon-feature-start <ID>
```

**Drive (worktree)** — isolated worktree for parallel development:
```
$aigon-feature-start <ID> <agent>
```

**Fleet** — multiple agents compete on the same feature:
```
$aigon-feature-start <ID> <agent1> <agent2> [agent3...]
```

Example Drive worktree: `$aigon-feature-start 55 cc`
Example Fleet: `$aigon-feature-start 55 cc gg cx cu`

## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual ID assigned by the CLI:

`$aigon-feature-start <ID>`
