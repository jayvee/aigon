<!-- description: Prioritise feature <name> - assigns ID, moves to backlog -->
# aigon-feature-prioritise

Run this command followed by the feature name.

```bash
aigon feature-prioritise {{ARG_SYNTAX}}
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
{{CMD_PREFIX}}feature-setup <ID>
```

**Solo (worktree)** — isolated worktree for parallel development:
```
{{CMD_PREFIX}}feature-setup <ID> <agent>
```

**Arena** — multiple agents compete on the same feature:
```
{{CMD_PREFIX}}feature-setup <ID> <agent1> <agent2> [agent3...]
```

Example solo worktree: `{{CMD_PREFIX}}feature-setup 55 cc`
Example arena: `{{CMD_PREFIX}}feature-setup 55 cc gg cx cu`
