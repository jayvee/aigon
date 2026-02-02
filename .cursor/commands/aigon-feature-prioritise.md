# aigon-feature-prioritise

**CRITICAL:** You MUST use the CLI command below to prioritise. Do NOT manually rename or move spec files — the CLI handles ID assignment and file moves.

## Argument Resolution

If no name is provided, or the name doesn't match an existing feature in the inbox:
1. List all files in `./docs/specs/features/01-inbox/` matching `feature-*.md`
2. If a partial name was given, filter to files containing that text
3. Present the matching features and ask the user to choose one

## Step 1: Run the CLI command

```bash
aigon feature-prioritise <args>
```

This assigns an ID to the feature and moves it from `01-inbox/` to `02-backlog/`.

## Step 2: Next steps

Choose your mode:

**Solo (branch)** — work in the current repo:
```
/aigon-feature-setup <ID>
```

**Solo (worktree)** — isolated worktree for parallel development:
```
/aigon-feature-setup <ID> <agent>
```

**Arena** — multiple agents compete on the same feature:
```
/aigon-feature-setup <ID> <agent1> <agent2> [agent3...]
```

Example solo worktree: `/aigon-feature-setup 55 cc`
Example arena: `/aigon-feature-setup 55 cc gg cx cu`
