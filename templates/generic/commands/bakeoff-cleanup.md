<!-- description: Cleanup bakeoff <ID> - remove losing worktrees and branches -->
# ff-bakeoff-cleanup

Clean up after a bakeoff by removing losing agents' worktrees and branches.

## Step 1: Ask user about pushing branches

Before cleanup, ask the user:

**Would you like to push the losing branches to origin before deleting them?**

- **Yes (recommended)**: Branches will be saved on the remote for future reference
- **No**: Branches will only be deleted locally (lost forever)

## Step 2: Run the appropriate cleanup command

Based on user choice:

**If pushing to origin first:**
```bash
ff cleanup {{ARG1_SYNTAX}} --push
```

**If just deleting locally:**
```bash
ff cleanup {{ARG1_SYNTAX}}
```

## What this does

The cleanup command will:
1. Push branches to origin (if `--push` flag used)
2. Remove all worktrees for feature {{ARG1_SYNTAX}}
3. Delete all local branches for feature {{ARG1_SYNTAX}}
4. Clean up worktree permissions from `.claude/settings.json`

## After cleanup

Report to the user:
- Number of worktrees removed
- Number of branches deleted
- Whether branches were pushed to origin
