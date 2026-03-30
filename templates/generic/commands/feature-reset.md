<!-- description: Reset feature <ID> - remove worktrees, branches, state, and move spec to backlog -->
# aigon-feature-reset

Fully reset a feature back to backlog state. Removes all worktrees, branches, manifest state files, and moves the spec back to backlog.

## Usage

```bash
aigon feature-reset {{ARG1_SYNTAX}}
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature:
1. Run `aigon feature-list --all`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## What Gets Reset

This command removes:
- **All worktrees** for the feature
- **All local branches** for the feature
- **Manifest state files** (`.aigon/state/feature-<ID>*.json`)
- **Worktree permissions** from Claude settings
- **Spec location** — moved back to `02-backlog/`

## When to Use

- Starting over on a feature after a failed attempt
- Resetting a demo/seed project back to clean state
- Canceling an in-progress feature and returning it to backlog

## Important Notes

- This command is **destructive** — all worktree work is lost
- The spec file is preserved (moved to backlog), not deleted
- Remote branches are NOT deleted — only local state is cleaned
