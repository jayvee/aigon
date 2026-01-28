# aigon-feature-cleanup

Remove all worktrees and branches for a feature. Useful after completing an arena or when canceling a feature.

## Usage

```bash
# Delete worktrees and local branches
aigon feature-cleanup <name>

# Push branches to origin before deleting
aigon feature-cleanup <name> --push
```

## What Gets Cleaned Up

This command removes:
- **All worktrees** for the feature (e.g., `../feature-55-cc-desc`, `../feature-55-gg-desc`)
- **All local branches** for the feature
- **Worktree permissions** from Claude settings

## Options

### --push Flag

Use `--push` to preserve branches on the remote before deleting locally:

```bash
aigon feature-cleanup 55 --push
```

This will:
1. Push each branch to `origin`
2. Delete local branches
3. Remove worktrees

Without `--push`, branches are only deleted locally.

## When to Use

### After Arena Completion
After running `aigon feature-done 55 <agent>` to merge the winning implementation, clean up the losing implementations:

```bash
aigon feature-cleanup 55
```

### Canceling a Feature
If you want to abandon a feature that was set up in arena mode:

```bash
aigon feature-cleanup 55 --push    # Preserve work on remote
# or
aigon feature-cleanup 55           # Delete everything
```

## Important Notes

- This command is **destructive** - deleted worktrees and branches cannot be easily recovered
- Use `--push` if you want to preserve the work on the remote repository
- The command will remove ALL branches matching `feature-<ID>-*`
- For solo mode features, this will delete the feature branch (use with caution)
- Logs and specs in `docs/specs/features/` are NOT deleted
