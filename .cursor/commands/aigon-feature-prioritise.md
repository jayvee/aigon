# aigon-feature-prioritise

Run this command followed by the feature name.

```bash
aigon feature-prioritise <args>
```

## Argument Resolution

If no name is provided, or the name doesn't match an existing feature in the inbox:
1. List all files in `./docs/specs/features/01-inbox/` matching `feature-*.md`
2. If a partial name was given, filter to files containing that text
3. Present the matching features and ask the user to choose one

This assigns an ID to the feature and moves it from `01-inbox/` to `02-backlog/`.

Next step - choose your mode:

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
